# JARVIS AI Technical Reference

This document explains how the JARVIS AI assistant works internally: the web interface, backend server, voice pipeline, memory and notes systems, search, remote computer control, Windows agent, database layer, and deployment model.

## 1. System Overview

JARVIS is a web-based voice assistant with a central server and optional Windows computer agents.

At a high level:

```text
Browser UI
  -> React HUD, microphone, live audio, transcript, notes, settings, devices

Backend API
  -> Express server, Gemini Live proxy, command router, memory, notes, search, devices

Database
  -> SQLite locally or PostgreSQL on the server

Gemini / Search APIs
  -> Live voice, text reasoning, structured command parsing, transcript repair fallback, web search

Windows Computer Agent
  -> Installed app on each PC, polls server, executes approved commands
```

The server is the command center. The browser talks to the server. Remote Windows computers do not accept inbound connections. Instead, each Windows agent connects outward to the server, polls for queued commands, executes them locally, and reports results back.

That design is important because most personal computers are behind NAT, firewalls, or changing networks. Polling keeps the agent reachable without opening ports on the PC.

## 2. Repository Layout

```text
jarvisfriend/
  backend/
    server.js       Main Express API and command orchestration
    gemini.js       Gemini Live WebSocket proxy, text, TTS, transcript repair
    parser.js       Primary AI structured command parser
    intent.js       Fallback AI intent classifier
    desktop.js      Local Windows app/site/media execution helpers
    devices.js      Device registration, approval, command queue, status updates
    db.js           SQLite/PostgreSQL adapter and schema creation
    memory.js       Short-term, long-term, episodic memory
    notes.js        Notes CRUD
    search.js       Tavily/SerpAPI web search integration
    settings.js     Runtime settings handling
    startup.js      Local Windows startup integration
    time.js         User timezone/time helpers

  frontend/
    src/App.jsx
    src/hooks/useJarvis.js    Main UI state, chat streaming, command dispatch
    src/hooks/useVoice.js     Microphone, Gemini Live audio, playback, barge-in
    src/components/           HUD, transcript, notes, settings, devices panels

  agent/windows/
    jarvis-agent.js           Installed Windows computer agent
    package.json

  deploy/
    server/                   Ubuntu/Nginx/systemd deployment helpers
    windows/                  Windows app and agent installer scripts

  release/
    installer/                Built Windows installers
```

## 3. Runtime Components

### 3.1 Frontend

The frontend is a React + Vite application. Its main responsibilities are:

- Render the JARVIS HUD interface.
- Keep the transcript, notes, status, settings, and devices visible.
- Capture microphone audio.
- Connect to Gemini Live through the backend WebSocket proxy.
- Send text commands to `/api/chat-stream`.
- Play assistant speech from Gemini Live or fallback TTS.
- Display web search results and controller responses.

Important files:

- `frontend/src/App.jsx`
- `frontend/src/hooks/useJarvis.js`
- `frontend/src/hooks/useVoice.js`
- `frontend/src/components/Transcript.jsx`
- `frontend/src/components/DevicesPanel.jsx`
- `frontend/src/components/SettingsPanel.jsx`

`useJarvis.js` is the main app state controller. It owns messages, notes, address preference, live status, search results, and chat submission.

`useVoice.js` owns the low-level audio behavior: microphone access, activity detection, live WebSocket messages, audio playback, speech queueing, and interruption behavior.

### 3.2 Backend

The backend is a Node.js + Express server. It exposes REST APIs, the Gemini Live WebSocket proxy, command streaming, memory, notes, search, and device control.

Important backend routes:

```text
GET  /api/health
GET  /api/session
GET  /api/memory
POST /api/memory/remember
POST /api/memory/forget
POST /api/session/summary

GET    /api/notes
POST   /api/notes
PATCH  /api/notes/append
DELETE /api/notes/:identifier

POST /api/search
POST /api/chat
POST /api/chat-stream

GET  /api/settings
PUT  /api/settings

GET   /api/devices
PATCH /api/devices/:id
POST  /api/devices/:id/approve
POST  /api/devices/:id/revoke
GET   /api/devices/:id/commands
POST  /api/devices/:id/commands

POST /api/agent/register
POST /api/agent/heartbeat
POST /api/agent/poll
POST /api/agent/commands/:id/status

WS /ws/gemini-live
```

### 3.3 Database

The database adapter supports two providers:

- SQLite for local/dev mode.
- PostgreSQL for server/production mode.

Provider selection:

```text
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://...
```

If `DATABASE_PROVIDER` is not set and `DATABASE_URL` exists, PostgreSQL is used. Otherwise SQLite is used.

Schema tables:

```text
memories
notes
conversations
devices
commands
audit_logs
```

The schema is initialized in `backend/db.js` at startup.

## 4. Voice Architecture

### 4.1 Gemini Live Flow

The browser does not connect directly to Gemini Live. It connects to the backend:

```text
Browser useVoice.js
  -> WebSocket /ws/gemini-live
  -> backend/gemini.js
  -> Gemini Live WebSocket API
```

The proxy exists so the Gemini API key stays on the server. The frontend sends microphone PCM frames to the server, and the server forwards them to Gemini Live.

Gemini Live returns:

- Input transcription: what Gemini heard from the user.
- Output transcription: what Gemini said.
- Audio chunks: assistant speech audio.

The frontend renders transcripts and plays audio.

### 4.2 Continuous Listening

The assistant is designed to monitor continuously instead of requiring a wake word.

In `useVoice.js`:

- `getUserMedia()` captures the microphone.
- Audio is analyzed frame-by-frame.
- When speech is detected, the frontend sends `activityStart`.
- PCM audio frames are sent while the user is speaking.
- After enough silence, the frontend sends `activityEnd`.

This creates passive listening with natural pauses.

### 4.3 Barge-In

Barge-in means the user can interrupt JARVIS while it is talking.

The frontend tracks whether assistant audio is playing. If the microphone level rises above the interruption threshold for enough frames, it calls `cancelSpeech()`.

`cancelSpeech()` stops:

- Browser speech synthesis.
- Gemini Live audio buffer playback.
- HTML audio fallback playback.
- Queued speech chunks.

### 4.4 Live Voice Policy

The live system prompt is built in `backend/gemini.js`.

The current policy tells Gemini Live:

- Support English, Uzbek, and Russian.
- Reply in the same language the user used most recently.
- Stay concise and in JARVIS personality.
- Do not claim device/app actions were completed.
- Only acknowledge controller actions briefly, because the backend controller sends the verified result later.
- Never claim that a song, video, app, or website was not found unless the controller explicitly reports an error.
- Repeat `VERIFIED_CONTROLLER_RESULT:` messages exactly so spoken feedback matches the backend's verified status.

This is why JARVIS may say:

```text
Checking the device controller, Sir.
```

Then the backend follows with:

```text
Done on My computer, Sir.
```

## 5. Chat And Command Pipeline

The command pipeline is the most important part of the system.

The intended pipeline is:

```text
Raw transcript
  -> AI structured command parser
  -> command plan
  -> device resolution
  -> execution
  -> verified JARVIS reply
```

If the structured parser times out or returns invalid JSON, the server falls back to the older pipeline:

```text
Raw transcript
  -> Gemini transcript repair
  -> local normalization
  -> fallback AI intent classification
  -> command plan
  -> execution
```

### 5.1 Raw Transcript

The raw transcript comes from Gemini Live or browser speech recognition. It can be imperfect:

```text
pla y musi c on my comp uter
o pen Te le gram on my se cond computer
close YouTube on my second computer
```

### 5.2 Primary Structured Parser

`backend/parser.js` is the primary command understanding layer.

It calls `GEMINI_INTENT_MODEL` with a short timeout controlled by:

```text
GEMINI_INTENT_TIMEOUT_MS=1800
```

The parser receives the raw transcript directly. It is responsible for:

- Repairing fragmented words.
- Understanding English, Uzbek, and Russian.
- Separating the action from the content.
- Separating the device target from the search query.
- Returning strict JSON only.

The returned shape is:

```json
{
  "action": "open",
  "appOrSite": "youtube",
  "searchQuery": null,
  "devices": ["default"],
  "language": "en",
  "rawIntent": "Open YouTube"
}
```

For a search command:

```json
{
  "action": "play",
  "appOrSite": "youtube",
  "searchQuery": "Mashxurbek Yuldashev Kapalagim",
  "devices": ["both"],
  "language": "uz",
  "rawIntent": "Play Mashxurbek Yuldashev Kapalagim on both computers"
}
```

The critical rule is that `searchQuery` must contain only search content. It must not contain:

- app names such as YouTube or Google
- device names such as my computer or computer 2
- action words such as open, play, search, find, google, or youtube
- filler words or speech artifacts

### 5.3 URL And App Resolution

`backend/server.js` builds the actual command from the parser JSON.

For YouTube:

```text
open YouTube
-> https://www.youtube.com

play Another Love on YouTube
-> https://www.youtube.com/results?search_query=Another%20Love
```

For Google:

```text
open Google
-> https://www.google.com

google weather in Uzbekistan
-> https://www.google.com/search?q=weather%20in%20Uzbekistan
```

Native app names are converted to structured desktop commands:

```text
telegram  -> open_app Telegram
explorer  -> open_app File Explorer
obs       -> open_app OBS Studio
```

Close commands become `close_app` or `close_url`. Media commands become `media_key`.

### 5.4 Device Resolution

The parser returns `devices` as an array. The server resolves those values against approved devices:

```text
["default"]      -> default approved computer
["my computer"]  -> device named my computer, or default computer
["computer 1"]   -> first approved computer
["computer 2"]   -> second approved computer
["both"]         -> first two approved computers
["all"]          -> all approved computers
```

If a named device cannot be found, JARVIS returns a deterministic missing-device message instead of pretending the command succeeded.

### 5.5 Fallback Transcript Repair

`backend/gemini.js` provides `geminiRepairTranscript()`.

It asks a lightweight Gemini model to repair broken speech transcripts without changing meaning. This is no longer the primary command understanding path. It is used only when `parseCommand()` returns `null`.

Examples:

```text
pla y musi c on se cond com puter
-> play music on second computer

clo se YouTube on my sec ond comp uter
-> close YouTube on my second computer
```

There are hard timeouts:

```text
GEMINI_REPAIR_TIMEOUT_MS=1800
GEMINI_INTENT_TIMEOUT_MS=1800
```

These prevent Gemini model overload from making JARVIS wait 30 seconds before falling back.

### 5.6 Fallback Local Normalization

`normalizeSpokenCommand()` in `backend/server.js` fixes common fragmented words and multilingual command shapes.

It handles patterns like:

```text
o pen -> open
te le gram -> telegram
you tube -> youtube
goo gle -> google
com puter -> computer
```

It also maps common Uzbek/Russian command phrases into canonical English controller language.

### 5.7 Fallback Intent Classification

`backend/intent.js` classifies user input into:

```text
desktop
web_search
device_status
none
```

The classifier returns structured JSON:

```json
{
  "type": "desktop",
  "confidence": 0.95,
  "normalizedText": "open telegram on my second computer",
  "query": "",
  "targetDevice": "my second computer"
}
```

Important rule: intent classification should understand the meaning, not simply match words.

### 5.8 Plan Execution

`backend/server.js` converts the intent into a plan:

```text
search
device_status
desktop
```

Then the server executes the plan.

Desktop execution has two modes:

- Local Windows execution if the backend itself is running on Windows.
- Remote execution through approved Windows agents if the backend is running on Linux/server.

## 6. Desktop Command System

`backend/desktop.js` is the allowlisted desktop execution module.

It understands:

- Open app.
- Close app.
- Open URL.
- Close website tab.
- Media keys.
- Generic installed app launching.

Supported aliases include:

```text
telegram
chrome
google
youtube
spotify
vscode
notepad
explorer
calculator
word
excel
obs
```

Actions include:

```text
open_url
open_app
close_app
close_url
media_key
```

### 6.1 Search Query vs Device Target

A key design rule:

```text
Search content and device target must be separated.
```

Example:

```text
play music on my computer
```

Should become:

```json
{
  "action": "open_url",
  "url": "https://www.youtube.com/results?search_query=music",
  "targetDevice": "My computer"
}
```

It should not search YouTube for:

```text
on My computer
```

The primary parser enforces this by returning a clean `searchQuery` and a separate `devices` array. `backend/desktop.js` still strips trailing device qualifiers with `stripDeviceQualifier()` as a defensive fallback for older command paths.

### 6.2 Structured Remote Commands

The server now prefers structured command types instead of sending raw text to agents.

Structured command examples:

```json
{
  "type": "open_url",
  "payload": {
    "url": "https://www.youtube.com/results?search_query=music",
    "label": "YouTube music search"
  }
}
```

```json
{
  "type": "close_url",
  "payload": {
    "label": "YouTube"
  }
}
```

This matters because raw speech can be misinterpreted twice. The server should decide the action once, then the agent should execute that exact action.

## 7. Remote Device System

Remote device control is handled by:

- `backend/devices.js`
- `agent/windows/jarvis-agent.js`
- `frontend/src/components/DevicesPanel.jsx`

### 7.1 Registration Flow

When the Windows agent starts:

```text
agent loads or creates device.json
  -> POST /api/agent/register
  -> server creates or updates device record
  -> status is pending or approved
```

The local device identity is stored at:

```text
%APPDATA%\JarvisComputerAgent\device.json
```

It contains:

```json
{
  "deviceKey": "...",
  "deviceSecret": "...",
  "name": "DESKTOP-NAME Windows"
}
```

The server stores only a hash of the device secret.

### 7.2 Approval Flow

New devices appear in the Devices panel as pending.

The admin can:

- Approve the device.
- Rename it.
- Mark it as default.
- Revoke it.

Only approved devices can receive commands.

### 7.3 Heartbeat And Polling

The agent runs two loops:

```text
heartbeat every 30 seconds
poll every 3 seconds
```

Current defaults:

```text
JARVIS_AGENT_POLL_MS=3000
JARVIS_AGENT_HEARTBEAT_MS=30000
```

The server treats poll activity as proof that the device is alive. Every authenticated agent poll/status update refreshes `last_seen_at`.

The server online window defaults to:

```text
DEVICE_ONLINE_WINDOW_MS=180000
```

That means a device is considered online if it has been seen within the last 180 seconds.

### 7.4 Command Queue

When the server wants a remote PC to do something:

```text
server inserts command row with status queued
agent polls /api/agent/poll
server marks command sent
agent marks running
agent executes command locally
agent marks success or error
server waits for completion
JARVIS reports result to user
```

Command statuses:

```text
queued
sent
running
success
error
cancelled
```

Command types:

```text
desktop_intent
open_url
open_app
close_app
close_url
media_key
```

### 7.5 Multi-Device Commands

The server can target:

- The default device.
- A named device.
- Multiple named devices.
- Both devices.
- All approved devices.

Examples:

```text
open Telegram on My computer
open YouTube on my second computer
open Telegram on both computers
pause music on all devices
```

If a requested device name does not exist, the server should report that clearly:

```text
I do not see a linked device named "my third computer", Sir.
```

## 8. Windows Agent

The Windows agent is installed separately from the web app.

Main file:

```text
agent/windows/jarvis-agent.js
```

Responsibilities:

- Create/load stable device identity.
- Register with the JARVIS server.
- Heartbeat to keep device online.
- Poll for commands.
- Execute only allowlisted command types.
- Report success/error.
- Write logs.

Logs and config:

```text
%APPDATA%\JarvisComputerAgent\agent.log
%APPDATA%\JarvisComputerAgent\launcher.log
%APPDATA%\JarvisComputerAgent\device.json
```

The agent currently reports:

```text
agentVersion: 0.2.0
```

### 8.1 Autostart

The Windows agent installer creates a Startup shortcut:

```text
{userstartup}\JARVIS Computer Agent
```

That shortcut launches:

```text
start-agent.cmd
```

Which calls:

```text
start-agent.ps1
```

That launcher starts the Node agent in the background. It also checks if the same agent is already running from the same install directory to avoid duplicate processes.

### 8.2 Installer Build

Build command:

```powershell
npm run build:agent-installer
```

Direct command:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\agent-installer\build_agent_installer.ps1
```

Output:

```text
release/installer/JarvisComputerAgent-Setup.exe
```

The installer bundles:

- `agent/windows/jarvis-agent.js`
- `backend/desktop.js`
- launcher scripts
- local `node.exe` runtime if Node exists on the build machine

## 9. Memory System

Memory is implemented in `backend/memory.js`.

There are three memory types:

```text
short-term
long-term
episodic
```

### 9.1 Short-Term Memory

Short-term memory is stored in the `conversations` table.

Current limit:

```text
SHORT_TERM_LIMIT=20
```

Only the most recent 20 conversation exchanges are kept.

### 9.2 Long-Term Memory

Long-term memory stores durable facts about the user.

Example:

```text
The user prefers being addressed as Sir.
The user lives in Uzbekistan.
The user is building a JARVIS remote computer control system.
```

Commands like “Remember that...” should eventually call:

```text
POST /api/memory/remember
```

### 9.3 Episodic Memory

Episodic memory stores session summaries.

When the browser unloads, it attempts to call:

```text
POST /api/session/summary
```

The summary is generated from the current short-term conversation.

### 9.4 System Prompt Injection

`buildSystemPrompt()` injects:

- JARVIS personality.
- Address preference.
- User timezone and current date/time.
- Long-term facts.
- Episodic summaries.
- Short-term conversation.

This prompt is used for text responses and live voice setup.

## 10. Notes System

Notes are implemented in `backend/notes.js`.

The `notes` table stores:

```text
id
title
content
tags
created_at
updated_at
```

Supported operations:

```text
GET    /api/notes
POST   /api/notes
PATCH  /api/notes/append
DELETE /api/notes/:identifier
```

Notes can be searched by:

- title
- content
- tags

The frontend sidebar loads notes and displays them persistently.

## 11. Web Search

Search is implemented in `backend/search.js`.

Provider priority:

```text
1. Tavily
2. SerpAPI
3. none
```

Environment variables:

```text
TAVILY_API_KEY=...
SERPAPI_KEY=...
SEARCH_TIMEOUT_MS=12000
```

For search requests, the flow is:

```text
user asks weather/news/latest/current question
  -> intent becomes web_search
  -> backend calls webSearch(query)
  -> result is returned to frontend
  -> JARVIS speaks concise verified answer
```

Search results are also placed on screen in the frontend.

## 12. Settings

Settings are exposed through:

```text
GET /api/settings
PUT /api/settings
```

Settings can include API keys, voice settings, search settings, and startup behavior.

On Windows local installs, startup can be controlled through:

```text
backend/startup.js
```

That module uses:

```text
HKCU\Software\Microsoft\Windows\CurrentVersion\Run
```

For the remote Windows computer agent, startup is handled by the installer Startup shortcut.

## 13. Deployment

### 13.1 Local Development

Install and run:

```powershell
npm install
npm run dev
```

This starts:

```text
backend on http://localhost:3001
frontend on http://localhost:5174
```

### 13.2 Production Server

The Ubuntu server uses:

- Node.js backend.
- Built frontend served by backend or Nginx.
- PostgreSQL.
- Nginx reverse proxy.
- Certbot SSL.
- systemd service.

Deployment helpers live in:

```text
deploy/server/
```

Important files:

```text
deploy/server/install_app.sh
deploy/server/setup_postgres.sh
deploy/server/nginx-jarvis.conf
deploy/server/jarvis.service
deploy/server/enable_admin_auth.sh
deploy/server/enable_agent_routes.sh
```

The systemd service runs the backend process and restarts it after server reboot.

### 13.3 Nginx And SSL

Nginx sits in front of the Node app:

```text
Browser
  -> HTTPS domain
  -> Nginx
  -> localhost:3001
```

Certbot provides HTTPS certificates.

Agent routes must remain reachable by Windows agents. Admin-facing routes should be protected.

## 14. Environment Variables

Core backend variables:

```text
PORT=3001
FRONTEND_ORIGIN=https://your-domain
DEFAULT_ADDRESS=Sir
USER_TIMEZONE=Asia/Tashkent
NODE_ENV=production
JARVIS_SERVE_FRONTEND=true
```

Database:

```text
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://...
DATABASE_SSL=false
SQLITE_PATH=./backend/database.sqlite
```

Gemini:

```text
GEMINI_API_KEY=...
GEMINI_TEXT_MODEL=gemini-2.5-flash
GEMINI_INTENT_MODEL=gemini-flash-lite-latest
GEMINI_REPAIR_MODEL=gemini-flash-lite-latest
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
GEMINI_LIVE_WS_URL=wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
GEMINI_VOICE=Charon
GEMINI_LIVE_SILENCE_MS=1200
GEMINI_REPAIR_TIMEOUT_MS=1800
GEMINI_INTENT_TIMEOUT_MS=1800
```

TTS:

```text
TTS_PROVIDER=live
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
ELEVENLABS_MODEL=eleven_flash_v2_5
```

Search:

```text
TAVILY_API_KEY=...
SERPAPI_KEY=...
SEARCH_TIMEOUT_MS=12000
```

Remote devices:

```text
DEVICE_ONLINE_WINDOW_MS=180000
REMOTE_COMMAND_WAIT_MS=9000
JARVIS_AGENT_POLL_MS=3000
JARVIS_AGENT_HEARTBEAT_MS=30000
```

Frontend:

```text
VITE_API_URL=http://localhost:3001
VITE_API_WS=ws://localhost:3001/ws/gemini-live
VITE_TTS_PROVIDER=live
VITE_ENABLE_LIVE_AUDIO=true
VITE_SPEECH_RECOGNITION_LANG=en-US
```

## 15. Security Model

### 15.1 API Keys

API keys must stay in `.env` and must not be hardcoded in frontend files.

The Gemini Live WebSocket proxy keeps the Gemini API key on the server.

### 15.2 Agent Authentication

Each agent has:

```text
deviceKey
deviceSecret
```

The server stores:

```text
device_key
secret_hash
```

The raw device secret remains on the Windows machine in `device.json`.

### 15.3 Approval Required

Devices start as `pending`.

Commands are rejected unless the device is `approved`.

### 15.4 Allowlisted Execution

The agent does not execute arbitrary shell text from the user.

It only executes allowlisted command types:

```text
desktop_intent
open_url
open_app
close_app
close_url
media_key
```

`open_url` only allows `http` and `https`.

This is safer than remote shell execution.

## 16. Observability And Debugging

### 16.1 Server Logs

On Ubuntu:

```bash
sudo journalctl -u jarvis -n 120 --no-pager
```

Useful log signals:

```text
Gemini Live heard: ...
Gemini Live said: ...
Transcript repair unavailable: ...
Intent classifier unavailable: ...
Gemini Live upstream closed: ...
```

### 16.2 Agent Logs

On Windows:

```text
%APPDATA%\JarvisComputerAgent\agent.log
%APPDATA%\JarvisComputerAgent\launcher.log
```

Useful log signals:

```text
JARVIS Windows Agent starting.
Registration status: approved.
Executing command <id>: open_url
Command <id> completed.
Agent loop warning: fetch failed
```

### 16.3 Database Inspection

Device state:

```sql
SELECT id, name, status, is_default, last_seen_at, updated_at
FROM devices
ORDER BY updated_at DESC;
```

Recent commands:

```sql
SELECT id, device_id, status, type, payload, error, created_at, updated_at
FROM commands
ORDER BY created_at DESC
LIMIT 20;
```

## 17. Known Design Tradeoffs

### 17.1 Gemini Live May Speak Before Controller Result

Gemini Live is fast and conversational. The backend controller result may arrive slightly later.

The prompt tells Gemini not to claim completion, only to acknowledge:

```text
Checking the device controller, Sir.
```

The backend then injects the verified result.

### 17.2 Structured Parsing Depends On External Model Availability

The primary command parser uses Gemini to turn raw speech into structured JSON. If that parser times out, returns invalid JSON, or the model is unavailable, the system falls back to transcript repair, local normalization, and `backend/intent.js`.

Timeouts keep the system responsive. The fallback path is useful, but it is less flexible than the structured parser and may not understand every fragmented Uzbek, Russian, or English phrase.

### 17.3 Old Agents Have Limited Command Types

Older agents can execute `open_url`, `open_app`, `close_app`, and `media_key`.

`close_url` requires the newer agent version.

For best behavior, install the latest `JarvisComputerAgent-Setup.exe`.

### 17.4 Browser Audio Is Sensitive To Echo

Because the assistant passively listens, speaker audio can leak back into the microphone.

The frontend uses:

- echo cancellation
- noise suppression
- assistant audio blocking
- barge-in thresholds

But hardware echo can still affect recognition.

## 18. Common Command Examples

Device control:

```text
Open Telegram on My computer.
Close YouTube on my second computer.
Play music on my computer.
Play Another Love on my second computer.
Open File Explorer on my computer.
Pause music on all computers.
Are my computers online?
What is the name of my default computer?
```

Web search:

```text
Tell me the weather in Uzbekistan.
Latest AI news right now.
Google weather information in Uzbekistan.
Look up current Nvidia news.
```

Notes:

```text
Create a note: finish the report.
Show my notes.
Search my notes for project.
Add to my project note: call John tomorrow.
Delete note project.
```

Memory:

```text
Remember that I prefer Uzbek for casual conversation.
Forget that preference.
```

General:

```text
What time is it?
Calculate 25 times 14.
Remind me to call John in 2 hours.
```

## 19. Recommended Future Improvements

1. Add a formal `command_plans` module.

Currently, command planning lives mostly inside `backend/server.js`. Moving it into a dedicated module would make testing and maintenance easier.

2. Add unit tests for intent and desktop parsing.

Important test cases:

```text
music on my computer -> YouTube query music
play another love on my second computer -> YouTube query another love
close youtube on my second computer -> close_url YouTube
google weather in Uzbekistan on my second computer -> Google query weather in Uzbekistan
```

3. Add agent auto-update.

The server can already see `agentVersion`. A future update channel could tell older agents to download and install the latest agent.

4. Add richer app detection on Windows.

The current generic app launcher searches Start Menu shortcuts and App Paths. It could be expanded to installed programs, Microsoft Store apps, and custom user aliases.

5. Add command audit UI.

The `commands` and `audit_logs` tables already contain useful history. A UI panel could show exactly what was sent, when it completed, and why it failed.

6. Add per-device permissions.

Future versions could allow some computers to accept only safe actions, while trusted computers accept broader app control.
