import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { attachGeminiLiveProxy, geminiRepairTranscript, geminiText, geminiTextStream, geminiTts } from './gemini.js';
import { elevenLabsTts } from './elevenlabs.js';
import {
  addExchange,
  buildSystemPrompt,
  forgetMemory,
  getRelevantMemories,
  rememberFact,
  summarizeSession
} from './memory.js';
import { appendToNote, createNote, deleteNote, listNotes } from './notes.js';
import { webSearch } from './search.js';
import { desktopReply, executeDesktopIntent, resolveDesktopIntent } from './desktop.js';
import { classifyIntent } from './intent.js';
import { formatUserDateTime, getUserTimeContext } from './time.js';
import { getSettingsForClient, updateSettings } from './settings.js';
import { getStartupStatus, setStartupEnabled } from './startup.js';
import { dbProvider, initDatabase } from './db.js';
import {
  approveDevice,
  getCommand,
  heartbeatDevice,
  listCommands,
  listDevices,
  pollCommands,
  queueCommand,
  registerDevice,
  revokeDevice,
  updateCommandStatus,
  updateDevice
} from './devices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3001);

app.disable('x-powered-by');
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5174' }));
app.use(express.json({ limit: '10mb' }));
app.use(securityHeaders);

attachGeminiLiveProxy(server);

app.get('/api/health', (_req, res) => {
  const time = getUserTimeContext();
  res.json({
    ok: true,
    database: dbProvider(),
    time: time.dateTime,
    timeZone: time.timeZone,
    liveVoiceConfigured: Boolean(process.env.GEMINI_API_KEY),
    ttsProvider: process.env.TTS_PROVIDER || 'gemini',
    elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
    searchConfigured: Boolean(process.env.TAVILY_API_KEY || process.env.SERPAPI_KEY)
  });
});

app.get('/api/session', async (req, res, next) => {
  try {
    const address = req.query.address || process.env.DEFAULT_ADDRESS || 'Sir';
    const time = getUserTimeContext();
    res.json({
      systemPrompt: await buildSystemPrompt(address),
      memories: await getRelevantMemories(),
      time: time.dateTime,
      timeZone: time.timeZone
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/memory', async (req, res, next) => {
  try {
    res.json(await getRelevantMemories(req.query.q || ''));
  } catch (error) {
    next(error);
  }
});

app.post('/api/memory/remember', async (req, res, next) => {
  try {
    const id = await rememberFact(req.body.content, req.body.key, req.body.metadata);
    res.status(201).json({ id });
  } catch (error) {
    next(error);
  }
});

app.post('/api/memory/forget', async (req, res, next) => {
  try {
    res.json({ deleted: await forgetMemory(req.body.query) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/session/summary', async (_req, res, next) => {
  try {
    const id = await summarizeSession();
    res.json({ id });
  } catch (error) {
    next(error);
  }
});

app.get('/api/notes', async (req, res, next) => {
  try {
    res.json(await listNotes(req.query.q || ''));
  } catch (error) {
    next(error);
  }
});

app.post('/api/notes', async (req, res, next) => {
  try {
    res.status(201).json(await createNote(req.body));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/notes/append', async (req, res, next) => {
  try {
    res.json(await appendToNote(req.body.topic, req.body.content));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/notes/:identifier', async (req, res, next) => {
  try {
    res.json({ deleted: await deleteNote(req.params.identifier) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/search', async (req, res, next) => {
  try {
    res.json(await webSearch(req.body.query));
  } catch (error) {
    next(error);
  }
});

app.get('/api/settings', async (_req, res, next) => {
  try {
    res.json({
      settings: getSettingsForClient(),
      startup: await getStartupStatus()
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings', async (req, res, next) => {
  try {
    const settings = updateSettings(req.body.settings || {}, req.body.clearSecrets || []);
    let startup = await getStartupStatus();
    if (typeof req.body.startupEnabled === 'boolean') {
      startup = await setStartupEnabled(req.body.startupEnabled);
    }
    res.json({
      settings,
      startup,
      message: 'Settings saved. Restart JARVIS or refresh the app to reconnect live voice with updated credentials.'
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/desktop/intent', async (req, res, next) => {
  try {
    const address = req.body.address || process.env.DEFAULT_ADDRESS || 'Sir';
    const message = String(req.body.message || '').trim();
    const intent = resolveDesktopIntent(message);
    if (!intent) {
      return res.json({
        handled: false,
        reply: `I do not see a safe desktop action in that request, ${address}.`
      });
    }

    const result = await executeDesktopIntent(intent);
    res.json({
      handled: Boolean(result?.ok),
      command: 'desktop',
      payload: result,
      reply: desktopReply(result, address)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/agent/register', async (req, res, next) => {
  try {
    const device = await registerDevice(req.body || {});
    res.status(device.status === 'pending' ? 202 : 200).json({
      device,
      message: device.status === 'approved'
        ? 'Device registered and approved.'
        : 'Device registered and awaiting admin approval.'
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/agent/heartbeat', async (req, res, next) => {
  try {
    res.json({ device: await heartbeatDevice(req.body || {}) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/agent/poll', async (req, res, next) => {
  try {
    res.json(await pollCommands(req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.post('/api/agent/commands/:id/status', async (req, res, next) => {
  try {
    const command = await updateCommandStatus({
      ...(req.body || {}),
      commandId: req.params.id
    });
    if (!command) return res.status(404).json({ error: 'Command not found for this device.' });
    res.json({ command });
  } catch (error) {
    next(error);
  }
});

app.get('/api/devices', async (_req, res, next) => {
  try {
    res.json(await listDevices());
  } catch (error) {
    next(error);
  }
});

app.post('/api/devices/:id/approve', async (req, res, next) => {
  try {
    const device = await approveDevice(req.params.id, req.body || {});
    if (!device) return res.status(404).json({ error: 'Device not found.' });
    res.json(device);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/devices/:id', async (req, res, next) => {
  try {
    const device = await updateDevice(req.params.id, req.body || {});
    if (!device) return res.status(404).json({ error: 'Device not found.' });
    res.json(device);
  } catch (error) {
    next(error);
  }
});

app.post('/api/devices/:id/revoke', async (req, res, next) => {
  try {
    const device = await revokeDevice(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found.' });
    res.json(device);
  } catch (error) {
    next(error);
  }
});

app.get('/api/devices/:id/commands', async (req, res, next) => {
  try {
    res.json(await listCommands(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/devices/:id/commands', async (req, res, next) => {
  try {
    const command = await queueCommand(req.params.id, req.body.type, req.body.payload || {});
    res.status(201).json(command);
  } catch (error) {
    next(error);
  }
});

app.post('/api/chat', async (req, res, next) => {
  try {
    const address = req.body.address || process.env.DEFAULT_ADDRESS || 'Sir';
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    await addExchange('user', message);
    const commandResult = await handleCommand(message, address);
    let reply = commandResult.reply;

    if (!reply) {
      reply = await geminiText(message, address);
    }

    if (!reply) {
      reply = localJarvisReply(message, address);
    }

    await addExchange('assistant', reply);
    res.json({
      reply,
      command: commandResult.command || null,
      payload: commandResult.payload || null
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/chat-stream', async (req, res, next) => {
  try {
    const address = req.body.address || process.env.DEFAULT_ADDRESS || 'Sir';
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    await addExchange('user', message);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    if (isSlowLookup(message)) {
      writeStreamEvent(res, 'ack', { text: `Checking now, ${address}.` });
    }

    const commandResult = await handleCommand(message, address);
    if (commandResult.reply) {
      await addExchange('assistant', commandResult.reply);
      writeStreamEvent(res, 'meta', {
        command: commandResult.command || null,
        payload: commandResult.payload || null
      });
      writeStreamEvent(res, 'delta', { text: commandResult.reply });
      writeStreamEvent(res, 'done', { reply: commandResult.reply });
      res.end();
      return;
    }

    let reply = '';
    if (process.env.GEMINI_API_KEY) {
      for await (const delta of geminiTextStream(message, address)) {
        reply += delta;
        writeStreamEvent(res, 'delta', { text: delta });
      }
    }

    if (!reply.trim()) {
      reply = await geminiText(message, address);
      if (reply) writeStreamEvent(res, 'delta', { text: reply });
    }

    if (!reply?.trim()) {
      reply = localJarvisReply(message, address);
      writeStreamEvent(res, 'delta', { text: reply });
    }

    await addExchange('assistant', reply.trim());
    writeStreamEvent(res, 'done', { reply: reply.trim() });
    res.end();
  } catch (error) {
    if (res.headersSent) {
      writeStreamEvent(res, 'error', { error: error.message || 'Streaming failed.' });
      res.end();
      return;
    }
    next(error);
  }
});

app.post('/api/tts', async (req, res, next) => {
  try {
    if ((process.env.TTS_PROVIDER || '').toLowerCase() === 'live') {
      return res.status(409).json({
        error: 'TTS endpoint disabled because Gemini Live Native Audio is the active voice provider.',
        liveVoice: true
      });
    }
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Text is required.' });
    const audio = await synthesizeSpeech(text);
    if (!audio) return res.status(503).json({ error: 'Gemini TTS is not configured.' });
    res.json(audio);
  } catch (error) {
    console.warn(error.message || error);
    res.status(error.status === 429 ? 429 : 502).json({
      error: error.message || 'Gemini TTS failed.',
      quotaExhausted: error.status === 429
    });
  }
});

if (process.env.JARVIS_SERVE_FRONTEND === 'true' || process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || error.statusCode || 500).json({
    error: error.message || 'A regrettable malfunction occurred.'
  });
});

initDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`JARVIS backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });

async function handleCommand(message, address) {
  const text = await normalizeIncomingCommand(message);

  if (isSearchRequest(text)) {
    return handleSearchCommand(stripSearchTrigger(text), text, address);
  }

  if (isDeviceStatusRequest(text)) {
    return handleDeviceStatusCommand(text, address);
  }

  const desktopIntent = resolveDesktopIntent(text);
  if (desktopIntent) {
    return handleDesktopCommand(text, desktopIntent, address);
  }

  const remember = text.match(/remember that\s+(.+)/i);
  if (remember) {
    const content = remember[1].trim();
    await rememberFact(content, null, { source: 'voice-command' });
    return {
      command: 'remember',
      reply: `Committed to memory, ${address}. A rare pleasure to store something intentionally.`
    };
  }

  const forget = text.match(/forget that\s+(.+)/i);
  if (forget) {
    const deleted = await forgetMemory(forget[1]);
    return {
      command: 'forget',
      payload: { deleted },
      reply: deleted
        ? `Forgotten, ${address}. The relevant memory has been discreetly vaporized.`
        : `I found nothing matching that memory, ${address}. Evidently, my mind was already clean on that subject.`
    };
  }

  const create = text.match(/create a note:?\s+(.+)/i);
  if (create) {
    const note = await createNote({ content: create[1], title: create[1].slice(0, 44) });
    return {
      command: 'notes:create',
      payload: note,
      reply: `Note created, ${address}: ${note.title}. Shall I keep the quill warm?`
    };
  }

  if (/show my notes/i.test(text)) {
    const notes = await listNotes();
    const summary = notes.length
      ? notes.map((note, index) => `${index + 1}. ${note.title}`).join('; ')
      : 'No notes yet.';
    return {
      command: 'notes:list',
      payload: notes,
      reply: `${summary} ${notes.length ? `Displayed as requested, ${address}.` : `An admirably uncluttered mind, ${address}.`}`
    };
  }

  const deleteMatch = text.match(/delete note\s+(.+)/i);
  if (deleteMatch) {
    const deleted = await deleteNote(deleteMatch[1]);
    return {
      command: 'notes:delete',
      payload: { deleted },
      reply: deleted ? `Deleted, ${address}.` : `No matching note found, ${address}.`
    };
  }

  const searchNotes = text.match(/search my notes for\s+(.+)/i);
  if (searchNotes) {
    const notes = await listNotes(searchNotes[1]);
    return {
      command: 'notes:search',
      payload: notes,
      reply: notes.length
        ? `I found ${notes.length} relevant note${notes.length === 1 ? '' : 's'}, ${address}.`
        : `No matching notes, ${address}. Tragic, but tidy.`
    };
  }

  const append = text.match(/add to my\s+(.+?)\s+note:?\s+(.+)/i);
  if (append) {
    const note = await appendToNote(append[1], append[2]);
    return {
      command: 'notes:append',
      payload: note,
      reply: `Added to ${note.title}, ${address}.`
    };
  }

  const math = tryMath(text);
  if (math) {
    return {
      command: 'calculator',
      payload: math,
      reply: `${math.expression} equals ${math.result}, ${address}. Arithmetic survives another day.`
    };
  }

  const nlpResult = await handleNlpIntent(text, address);
  if (nlpResult?.reply) return nlpResult;

  return {};
}

async function normalizeIncomingCommand(message) {
  const normalized = normalizeSpokenCommand(String(message || '').trim());
  if (!looksLikeFragmentedSpeech(normalized)) return normalized;
  try {
    const repaired = normalizeSpokenCommand(await geminiRepairTranscript(normalized));
    return repaired || normalized;
  } catch (error) {
    console.warn(`Transcript repair unavailable: ${error.message}`);
    return normalized;
  }
}

async function handleNlpIntent(text, address) {
  const devices = await safeListDevices();
  const intent = await classifyIntent(text, { devices, address });
  const minimumConfidence = Number(process.env.INTENT_CONFIDENCE_THRESHOLD || 0.62);
  if (!intent || intent.type === 'none' || intent.confidence < minimumConfidence) return null;

  const commandText = normalizeIntentCommandText(intent, text);

  if (intent.type === 'web_search') {
    return handleSearchCommand(intent.query || stripSearchTrigger(commandText), text, address, {
      source: 'nlp',
      intent
    });
  }

  if (intent.type === 'device_status') {
    return handleDeviceStatusCommand(commandText, address, { source: 'nlp', intent });
  }

  if (intent.type === 'desktop') {
    const desktopIntent = resolveDesktopIntent(commandText);
    if (!desktopIntent) return null;
    return handleDesktopCommand(commandText, desktopIntent, address, { source: 'nlp', intent });
  }

  return null;
}

async function handleSearchCommand(query, originalText, address, meta = {}) {
  const searchQuery = String(query || originalText || '').trim();
  let results;
  try {
    results = await webSearch(searchQuery || originalText);
  } catch (error) {
    return {
      command: meta.source === 'nlp' ? 'search:nlp-error' : 'search:error',
      payload: { query: searchQuery || originalText, error: error.message, intent: meta.intent || null },
      reply: `I could not complete the web search just now, ${address}: ${error.message}. The network appears to be behaving like it has opinions.`
    };
  }

  if (results.provider !== 'none') {
    const first = results.answer || results.results?.[0]?.snippet || 'I found results, but they are being coy.';
    return {
      command: 'search',
      payload: { ...results, intent: meta.intent || null },
      reply: `${first} I have placed the sources on screen, ${address}.`
    };
  }
  return {
    command: 'search:unconfigured',
    payload: { ...results, intent: meta.intent || null },
    reply: `Web search is not configured yet, ${address}. Add a Tavily or SerpAPI key and I shall stop pretending the internet is a rumour.`
  };
}

async function handleDeviceStatusCommand(text, address, meta = {}) {
  const devices = await listDevices();
  const selected = chooseRemoteDevice(text, devices, { allowDefault: false });
  const relevantDevices = selected ? [selected] : devices;
  const nameReply = buildDeviceNameReply(text, relevantDevices, address, Boolean(selected));
  return {
    command: meta.source === 'nlp' ? 'devices:nlp-status' : 'devices:status',
    payload: { devices: relevantDevices, intent: meta.intent || null },
    reply: nameReply || buildDeviceStatusReply(relevantDevices, address, Boolean(selected))
  };
}

async function handleDesktopCommand(text, desktopIntent, address, meta = {}) {
  if (os.platform() !== 'win32') {
    const devices = (await listDevices()).filter((device) => device.status === 'approved');
    if (!devices.length) {
      return {
        command: 'desktop:remote-unavailable',
        payload: { intent: meta.intent || null },
        reply: `No approved computer is linked yet, ${address}. Install the Windows agent, approve it in Devices, and I shall stop gesturing helplessly at the cloud.`
      };
    }
    const targetDevice = chooseRemoteDevice(text, devices);
    if (!targetDevice) {
      return {
        command: 'desktop:choose-device',
        payload: { devices, intent: meta.intent || null },
        reply: `Which computer shall I use, ${address}? I see ${devices.map((device) => device.name).join(', ')}. Set one as default in Devices and I shall stop asking obvious questions.`
      };
    }
    const reachability = getDeviceReachability(targetDevice);
    if (!reachability.online) {
      return {
        command: 'desktop:remote-offline',
        payload: { device: targetDevice, reachability, intent: meta.intent || null },
        reply: `${targetDevice.name} is not reachable at the moment, ${address}. It is ${reachability.label}. I will not pretend to control a sleeping machine.`
      };
    }
    const queued = await queueCommand(targetDevice.id, 'desktop_intent', { message: text, intent: meta.intent || null });
    const completed = await waitForCommandCompletion(queued.id, Number(process.env.REMOTE_COMMAND_WAIT_MS || 9000));
    if (completed?.status === 'success') {
      return {
        command: meta.source === 'nlp' ? 'desktop:nlp-remote-success' : 'desktop:remote-success',
        payload: { device: targetDevice, queued, completed, intent: meta.intent || null },
        reply: `Done on ${targetDevice.name}, ${address}.`
      };
    }
    if (completed?.status === 'error') {
      return {
        command: meta.source === 'nlp' ? 'desktop:nlp-remote-error' : 'desktop:remote-error',
        payload: { device: targetDevice, queued, completed, intent: meta.intent || null },
        reply: `I could not complete that on ${targetDevice.name}, ${address}: ${completed.error || 'the agent reported an unspecified fault'}.`
      };
    }
    return {
      command: meta.source === 'nlp' ? 'desktop:nlp-remote-queued' : 'desktop:remote-queued',
      payload: { device: targetDevice, queued, intent: meta.intent || null },
      reply: `Command sent to ${targetDevice.name}, ${address}. I have not received the final report yet, which is inconvenient but not fatal.`
    };
  }
  const result = await executeDesktopIntent(desktopIntent);
  return {
    command: meta.source === 'nlp' ? 'desktop:nlp' : 'desktop',
    payload: { result, intent: meta.intent || null },
    reply: desktopReply(result, address)
  };
}

function stripSearchTrigger(text) {
  return String(text || '')
    .replace(/^(jarvis[, ]*)?(search online for|search the web for|web search for|search for|search|look up|google)\s+/i, '')
    .trim();
}

function normalizeIntentCommandText(intent, fallbackText) {
  const parts = [intent.normalizedText || fallbackText];
  if (intent.targetDevice && !String(intent.normalizedText || fallbackText).toLowerCase().includes(intent.targetDevice.toLowerCase())) {
    parts.push(`on ${intent.targetDevice}`);
  }
  return normalizeSpokenCommand(parts.join(' '));
}

async function safeListDevices() {
  try {
    return await listDevices();
  } catch {
    return [];
  }
}

function tryMath(text) {
  const expression = text
    .replace(/what is|calculate|equals|please|jarvis|sir|boss/gi, '')
    .replace(/plus/gi, '+')
    .replace(/minus/gi, '-')
    .replace(/times|multiplied by/gi, '*')
    .replace(/divided by|over/gi, '/')
    .trim();

  if (!/^[\d\s+\-*/().%]+$/.test(expression) || !/[+\-*/%]/.test(expression)) return null;
  try {
    // Safe after strict expression whitelist above.
    const result = Function(`"use strict"; return (${expression})`)();
    return Number.isFinite(result) ? { expression, result } : null;
  } catch {
    return null;
  }
}

function normalizeSpokenCommand(text) {
  return repairFragmentedCommandWords(normalizeMultilingualCommand(String(text || '')))
    .replace(/\bo\s+pen\b/gi, 'open')
    .replace(/\bte\s+le\s*gram\b/gi, 'telegram')
    .replace(/\byou\s+tube\b/gi, 'youtube')
    .replace(/\bgoo\s+gle\b/gi, 'google')
    .replace(/\bde\s+fault\b/gi, 'default')
    .replace(/\bde\s+vice(?:s)?\b/gi, 'device')
    .replace(/\bcom\s+puter(?:s)?\b/gi, 'computer')
    .replace(/\bla\s+test\b/gi, 'latest')
    .replace(/\b(news|weather|search|look up)\s+(uh|um|erm)\b/gi, '$1')
    .replace(/\b(uh|um|erm)\s+(ai|weather|news|right now|today)\b/gi, '$1')
    .replace(/\bright\s+now\b/gi, 'current')
    .replace(/\bcon\s+nect(?:ed|s|ing)?\b/gi, (match) => match.toLowerCase().includes('ed') ? 'connected' : 'connect')
    .replace(/\s+/g, ' ')
    .trim();
}

function repairFragmentedCommandWords(text) {
  const replacements = [
    'open', 'close', 'play', 'pause', 'resume', 'stop', 'skip', 'next', 'previous',
    'google', 'weather', 'information', 'search', 'latest', 'current', 'news',
    'forecast', 'temperature', 'default', 'device', 'devices', 'computer', 'computers',
    'telegram', 'youtube', 'chrome', 'spotify', 'explorer', 'calculator',
    'message', 'connected', 'online', 'offline', 'name', 'names'
  ];

  return replacements.reduce((current, word) => {
    const pattern = new RegExp(`\\b${word.split('').join('\\s*')}\\b`, 'gi');
    return current.replace(pattern, word);
  }, String(text || ''));
}

function looksLikeFragmentedSpeech(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const singleLetterSplits = value.match(/\b(?:[a-z]\s+){1,}[a-z]{1,2}\b/gi) || [];
  const suspiciousWords = value.match(/\b[a-z]{1,2}\s+[a-z]{1,3}\b/gi) || [];
  return singleLetterSplits.length > 0 || suspiciousWords.length >= 2;
}

function normalizeMultilingualCommand(text) {
  let value = String(text || '').replace(/\s+/g, ' ').trim();

  value = value
    .replace(/\b(telegram|telegramm|телеграм|телеграмм)(ni)?\s+(och|oching|ochib ber|ishga tushir|yoq)\b/giu, 'open telegram')
    .replace(/\b(och|oching|ochib ber|ishga tushir|yoq)\s+(telegram|telegramm|телеграм|телеграмм)\b/giu, 'open telegram')
    .replace(/\b(telegram|telegramm|телеграм|телеграмм)(ni)?\s+(yop|yoping|o['‘’`]?chir|to['‘’`]?xtat)\b/giu, 'close telegram')
    .replace(/\b(yop|yoping|o['‘’`]?chir|to['‘’`]?xtat)\s+(telegram|telegramm|телеграм|телеграмм)\b/giu, 'close telegram')
    .replace(/\b(youtube|you tube|yutub|ютуб)(ni)?\s+(och|oching|ochib ber|ishga tushir|yoq)\b/giu, 'open youtube')
    .replace(/\b(och|oching|ochib ber|ishga tushir|yoq)\s+(youtube|you tube|yutub|ютуб)\b/giu, 'open youtube')
    .replace(/\b(google|гугл)(ni)?\s+(och|oching|ochib ber|ishga tushir|yoq)\b/giu, 'open google')
    .replace(/\b(och|oching|ochib ber|ishga tushir|yoq)\s+(google|гугл)\b/giu, 'open google')
    .replace(/\b(xabar yoz|xabar yubor|yozib yubor|telegramdan yoz|sms yoz|sms yubor)\b/giu, 'message on telegram')
    .replace(/\b(musiqa|qo['‘’`]?shiq|ashula)\s+(qo['‘’`]?y|yoq|ijro et)\b/giu, 'play music')
    .replace(/\b(.{2,80}?)\s+(qo['‘’`]?y|ijro et)\b/giu, (_match, query) => `play ${query}`);

  value = value
    .replace(/(?:^|\s)(открой|запусти|включи)\s+(телеграм|телеграмм|telegram)(?=\s|$)/giu, ' open telegram')
    .replace(/(?:^|\s)(закрой|выключи|останови)\s+(телеграм|телеграмм|telegram)(?=\s|$)/giu, ' close telegram')
    .replace(/(?:^|\s)(открой|запусти|включи)\s+(ютуб|youtube)(?=\s|$)/giu, ' open youtube')
    .replace(/(?:^|\s)(открой|запусти|включи)\s+(гугл|google)(?=\s|$)/giu, ' open google')
    .replace(/(?:^|\s)(напиши|отправь)\s+(сообщение|смс|sms)(?=\s|$)/giu, ' message on telegram')
    .replace(/(?:^|\s)(включи|поставь|проиграй)\s+(музыку|песню)(?=\s|$)/giu, ' play music')
    .replace(/(?:^|\s)(включи|поставь|проиграй)\s+(.{2,80})/giu, (_match, _verb, query) => ` play ${query}`);

  return value.replace(/\s+/g, ' ').trim();
}

function localJarvisReply(message, address) {
  if (/time|date/i.test(message)) {
    return `It is ${formatUserDateTime()}, ${address}. Time, as ever, is refusing to slow down.`;
  }
  return process.env.GEMINI_API_KEY
    ? `Understood, ${address}. Gemini did not return a usable response, so I am answering locally for the moment. Dignity preserved, mostly.`
    : `Understood, ${address}. I am operating in local mode until the Gemini key is configured. I can still manage notes, memory, reminders, calculations, and a fair amount of dignity.`;
}

function writeStreamEvent(res, type, payload = {}) {
  res.write(`${JSON.stringify({ type, ...payload })}\n`);
}

function isSlowLookup(message) {
  const text = normalizeSpokenCommand(message);
  return /^search\s+/i.test(text) || /latest|news|weather|current|today/i.test(text);
}

function isSearchRequest(message) {
  return /^(search|web search|search online|look up|google)\b/i.test(message)
    || /\b(latest|news|weather|forecast|temperature|current|today|online|internet|what happened)\b/i.test(message);
}

function isDeviceStatusRequest(message) {
  const lower = String(message || '').toLowerCase();
  const mentionsDevices = /\b(device|devices|computer|computers|pc|pcs|laptop|laptops|agent|agents|machine|machines)\b/i.test(lower);
  const asksStatus = /\b(connected|linked|available|online|offline|status|see|detect|detected|reachable|running|active|alive|working|registered|name|names|called)\b/i.test(lower);
  const asksList = /\b(show|list|what|which|any|how many|do you see|can you see)\b/i.test(lower);
  return mentionsDevices && (asksStatus || asksList);
}

function buildDeviceStatusReply(devices, address = 'Sir', specific = false) {
  if (!devices.length) {
    return `I do not see any registered computers yet, ${address}. Install the Computer Agent and I shall begin keeping a proper inventory.`;
  }

  const summaries = devices.slice(0, 5).map((device) => {
    const reachability = getDeviceReachability(device);
    const defaultText = device.is_default ? 'default, ' : '';
    const commandsText = device.active_commands ? `, ${device.active_commands} active command${device.active_commands === 1 ? '' : 's'}` : '';
    return `${device.name}: ${defaultText}${device.status}, ${reachability.label}${commandsText}`;
  });

  if (specific) {
    return `${summaries[0]}, ${address}.`;
  }

  const extra = devices.length > summaries.length ? ` I see ${devices.length - summaries.length} more beyond that.` : '';
  return `I see ${devices.length} registered computer${devices.length === 1 ? '' : 's'}, ${address}: ${summaries.join('; ')}.${extra}`;
}

function buildDeviceNameReply(message, devices, address = 'Sir', specific = false) {
  if (!isDeviceNameRequest(message) || !devices.length) return null;
  if (specific || devices.length === 1) {
    return `The device name is ${devices[0].name}, ${address}.`;
  }
  return `The registered device names are ${devices.map((device) => device.name).join(', ')}, ${address}.`;
}

function isDeviceNameRequest(message) {
  const lower = String(message || '').toLowerCase();
  return /\b(name|names|called|call it)\b/i.test(lower)
    && /\b(device|devices|computer|computers|pc|laptop|machine)\b/i.test(lower);
}

async function waitForCommandCompletion(commandId, timeoutMs = 9000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const command = await getCommand(commandId);
    if (command && ['success', 'error', 'cancelled'].includes(command.status)) return command;
    await wait(350);
  }
  return null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDeviceReachability(device) {
  if (!device.last_seen_at) return { online: false, label: 'not yet seen' };
  const ageMs = Date.now() - new Date(device.last_seen_at).getTime();
  if (!Number.isFinite(ageMs)) return { online: false, label: 'last seen time unknown' };
  if (ageMs <= 90_000) return { online: true, label: 'online' };
  const minutes = Math.max(1, Math.round(ageMs / 60000));
  return { online: false, label: `last seen ${minutes} minute${minutes === 1 ? '' : 's'} ago` };
}

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "connect-src 'self' ws: wss:",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "font-src 'self' data:"
    ].join('; ')
  );
  next();
}

function chooseRemoteDevice(text, devices, { allowDefault = true } = {}) {
  if (devices.length === 1) return devices[0];
  const normalized = normalizeDeviceText(text);
  const namedDevice = devices.find((device) => {
    const names = [
      device.name,
      device.metadata?.hostname,
      device.metadata?.username
    ].filter(Boolean);
    return names.some((name) => {
      const target = normalizeDeviceText(name);
      return target && normalized.includes(target);
    });
  });
  if (namedDevice) return namedDevice;
  return allowDefault ? devices.find((device) => device.is_default) || null : null;
}

function normalizeDeviceText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\b(my|computer|pc|laptop|desktop|windows|kompyuter|noutbuk)\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function synthesizeSpeech(text) {
  const provider = (process.env.TTS_PROVIDER || 'gemini').toLowerCase();

  if (provider === 'live') return null;

  if (provider === 'elevenlabs') {
    try {
      const audio = await elevenLabsTts(text);
      if (audio) return audio;
    } catch (error) {
      console.warn(error.message || error);
      if (error.status === 429 || error.status === 401) throw error;
    }
  }

  return geminiTts(text);
}
