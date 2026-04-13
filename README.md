# JARVIS AI Assistant

A JARVIS-inspired web assistant with a React HUD, Express backend, SQLite memory, notes, reminders, web search hooks, voice controls, and a Gemini Live API WebSocket proxy.

## What It Does

- Responds in a formal, loyal JARVIS-style personality and addresses you as `Sir` by default.
- Uses SQLite for short-term conversation, long-term memory, episodic summaries, and notes.
- Supports continuous passive listening through browser speech recognition, VAD metering, SPACE push-to-talk as a manual override, and Gemini native text-to-speech for natural AI voice output.
- Proxies Gemini Live API WebSocket traffic through the backend so API keys stay server-side.
- Falls back to text chat when live audio or speech recognition is unavailable.
- Handles notes commands, memory commands, reminders, calculator requests, time/date, and optional Tavily or SerpAPI search.
- Can route safe local desktop intents on Windows, such as opening Telegram, YouTube, Google, Chrome, Spotify, VS Code, and media playback controls.
- Can link remote Windows computers through the JARVIS Computer Agent. New machines appear as pending devices, then you approve, rename, and optionally mark one as the default computer.

## Requirements

- Node.js 20 or newer recommended.
- A Gemini API key for model-backed answers and Live API voice.
- Optional Tavily or SerpAPI key for real-time search.

## Setup

1. Install dependencies:

```bash
npm install
```

The root `postinstall` installs backend and frontend dependencies as well.

2. Create your environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

3. Edit `.env` and add:

```bash
GEMINI_API_KEY=...
TAVILY_API_KEY=...
ELEVENLABS_API_KEY=...
```

Only one search key is needed. Tavily is checked first, SerpAPI second.

For real-time voice, Gemini Live Native Audio can be enabled with:

```env
TTS_PROVIDER=live
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
GEMINI_LIVE_SILENCE_MS=1200
VITE_ENABLE_LIVE_AUDIO=true
VITE_SPEECH_RECOGNITION_LANG=en-US
```

For fallback TTS, ElevenLabs is checked first when:

```env
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ELEVENLABS_MODEL=eleven_flash_v2_5
```

If ElevenLabs is not configured, the backend falls back to Gemini TTS.

4. Start the app:

```bash
npm run dev
```

5. Open:

```text
http://localhost:5174
```

The backend runs on `http://localhost:3001`.

## Settings Menu

Open `Settings` in the top bar to configure the local assistant without editing `.env` manually.

You can set:

- Preferred address and Uzbekistan time zone.
- Gemini API key, Live model, text model, voice, and sentence pause timing.
- Tavily or SerpAPI search key.
- ElevenLabs fallback key, voice ID, and model.
- Windows startup behavior.

Secret fields are not shown back in the browser. Leaving a secret field blank keeps the existing key. Use `Clear stored key` to remove one.

Most backend settings apply to new requests immediately. If you change Gemini Live voice credentials or models, refresh the app so the Live WebSocket reconnects cleanly.

## Windows Installable App

The project includes Windows installer build paths using Inno Setup.

Build the main local JARVIS app installer:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\installer\build_installer.ps1
```

If Inno Setup is installed somewhere custom:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\installer\build_installer.ps1 -InnoCompilerPath "C:\Users\FastTyper\AppData\Local\Programs\Inno Setup 6\ISCC.exe"
```

The build script:

- Builds the React frontend.
- Copies the backend, frontend build, launcher scripts, and local Node runtime into `release\jarvis-ai`.
- Excludes your SQLite database and `.env` secrets.
- Compiles `release\installer\JarvisAI-Setup.exe` when Inno Setup is available.

The installed app launches the local backend in the background and opens JARVIS in an Edge app window when available. The installer can add JARVIS to Windows startup, and the in-app Settings menu can toggle startup later.

For development without building an installer:

```powershell
npm run start:app
```

## Windows Computer Agent

The Computer Agent is the small app you install on any Windows computer you want the server-hosted JARVIS to control.

Build the agent installer:

```powershell
npm run build:agent-installer
```

The installer is created at:

```text
release\installer\JarvisComputerAgent-Setup.exe
```

When installed, the agent:

- Starts automatically when that Windows user logs in.
- Creates its own private device key under the user's AppData folder.
- Registers with `https://jarvis12345.duckdns.org` as a pending device.
- Shows no API keys, device tokens, or secrets in a settings screen.
- Executes only allowlisted desktop actions after you approve the device.

Open `Devices` in the JARVIS admin UI to approve a new computer. Set a friendly name such as `My computer`, mark it as default if desired, and save it. Then commands like `open Telegram` go to the default computer, while `open Telegram on second computer` targets the named computer.

## Voice Notes

Browser speech recognition works best in Chrome or Edge. The app supports:

- Say: `Create a note: reactor diagnostics at 9`
- Hold SPACE for push-to-talk.
- Click `Activate microphone`.
- Interrupt JARVIS while he speaks; speech synthesis is cancelled when VAD detects your voice.
- No wake word is required. The assistant starts in a listening state and resumes listening after each response unless you pause monitoring.
- In Live mode, spoken replies come directly from Gemini Live Native Audio. `/api/tts` is disabled when `TTS_PROVIDER=live` so `gemini-2.5-flash-tts` is not used.
- `GEMINI_LIVE_SILENCE_MS` controls how long Gemini waits after you pause before treating the sentence as complete. Increase it if JARVIS interrupts too quickly; lower it if responses feel sluggish.
- In Live mode, current-information questions can use the backend `web_search` tool and display sources when Tavily or SerpAPI is configured.
- In fallback TTS mode, spoken replies use `/api/tts`, with ElevenLabs as the primary provider and Gemini TTS as fallback.
- `VITE_SPEECH_RECOGNITION_LANG` controls the browser caption recognizer. Use `en-US` or `en-GB` if Chrome starts guessing the wrong language.
- For ElevenLabs, change `ELEVENLABS_VOICE_ID` in `.env` to use a different British or JARVIS-style voice.
- The default Gemini fallback voice is `Charon` with a British JARVIS-style speaking instruction. Try `Rasalgethi`, `Schedar`, or `Algieba` if you use Gemini fallback and want a different formal tone.
- `VITE_ENABLE_LIVE_AUDIO=false` keeps the Live socket available but prevents experimental always-on mic streaming from talking over the text/TTS path. Leave it off unless you are testing full Live API audio.

The backend includes a `/ws/gemini-live` proxy for Gemini Live API. Google model names and Live API endpoints can differ by account and product surface, so `.env` includes `GEMINI_LIVE_MODEL` and `GEMINI_LIVE_WS_URL` overrides.

## Commands

```text
Remember that I prefer concise technical summaries
Forget that concise technical summaries
JARVIS, create a note: calibrate the workshop cameras
JARVIS, show my notes
JARVIS, delete note 1
JARVIS, search my notes for workshop
JARVIS, add to my workshop note: check audio gain
Remind me to call John in 2 hours
What is 42 * 19?
What's the latest AI news?
What is the current time and date?
```

## Project Structure

```text
jarvis-ai/
├── backend/
│   ├── server.js
│   ├── gemini.js
│   ├── memory.js
│   ├── notes.js
│   ├── search.js
│   ├── db.js
│   └── database.sqlite
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── ArcReactor.jsx
│   │   │   ├── Transcript.jsx
│   │   │   ├── NotesPanel.jsx
│   │   │   └── StatusBar.jsx
│   │   └── hooks/
│   │       ├── useVoice.js
│   │       └── useJarvis.js
├── .env.example
└── README.md
```

## API Overview

- `GET /api/health`
- `GET /api/session`
- `POST /api/chat`
- `GET /api/memory`
- `POST /api/memory/remember`
- `POST /api/memory/forget`
- `POST /api/session/summary`
- `GET /api/notes`
- `POST /api/notes`
- `PATCH /api/notes/append`
- `DELETE /api/notes/:identifier`
- `POST /api/search`
- `POST /api/desktop/intent`
- `WS /ws/gemini-live`

## Data

SQLite is stored at `backend/database.sqlite` by default. It is ignored by git and created automatically on first server start.
