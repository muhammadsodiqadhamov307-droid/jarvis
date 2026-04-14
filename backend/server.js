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
import { parseCommand } from './parser.js';
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
      reply = await geminiText(commandResult.chatPrompt || message, address);
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
      const chatPrompt = commandResult.chatPrompt || message;
      for await (const delta of geminiTextStream(chatPrompt, address)) {
        reply += delta;
        writeStreamEvent(res, 'delta', { text: delta });
      }
    }

    if (!reply.trim()) {
      reply = await geminiText(commandResult.chatPrompt || message, address);
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
  const parsed = await parseCommand(message);
  if (parsed) {
    const parsedResult = await handleParsedCommand(message, parsed, address);
    if (parsedResult) return parsedResult;
    if (shouldPassParsedCommandToChat(parsed)) {
      return {
        command: `parser:${parsed.action}`,
        payload: { parsed },
        chatPrompt: parsed.rawIntent || message
      };
    }
  }

  const text = await normalizeIncomingCommand(message);

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

  const analysis = await analyzeCommand(text, address);
  if (analysis?.plan) {
    return executeCommandPlan(analysis.plan, address);
  }

  return {};
}

async function handleParsedCommand(rawText, parsed, address) {
  const devices = await safeListDevices();
  const plan = buildPlanFromParsedCommand(rawText, parsed, devices);
  if (!plan) return null;
  return executeCommandPlan(plan, address);
}

function shouldPassParsedCommandToChat(parsed) {
  return ['remember', 'forget', 'notes', 'time', 'calculate', 'none'].includes(parsed.action);
}

function buildPlanFromParsedCommand(rawText, parsed, devices) {
  if (!parsed || parsed.action === 'none') return null;

  if (['weather', 'news'].includes(parsed.action) || (parsed.action === 'search' && !parsed.appOrSite)) {
    return {
      kind: 'search',
      query: parsed.searchQuery || parsed.rawIntent || rawText,
      originalText: rawText,
      meta: { source: 'parser', parser: parsed }
    };
  }

  if (parsed.action === 'status') {
    return {
      kind: 'device_status',
      text: parsed.rawIntent || rawText,
      meta: { source: 'parser', parser: parsed }
    };
  }

  const desktopIntent = buildDesktopIntentFromParsed(parsed);
  if (!desktopIntent) return null;

  const approved = (devices || []).filter((device) => device.status === 'approved');
  const selection = resolveParsedTargetDevices(parsed.devices, approved);
  return {
    kind: 'desktop',
    text: parsed.rawIntent || rawText,
    desktopIntent,
    meta: { source: 'parser', parser: parsed },
    targets: selection.targets,
    requestedNames: selection.requestedNames
  };
}

function buildDesktopIntentFromParsed(parsed) {
  const app = parsed.appOrSite || (parsed.action === 'play' ? 'youtube' : null);
  const query = String(parsed.searchQuery || '').trim();

  if (app === 'youtube' && ['open', 'play', 'search'].includes(parsed.action)) {
    return {
      action: 'open_url',
      label: 'YouTube',
      url: query
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
        : 'https://www.youtube.com'
    };
  }

  if (app === 'google' && ['open', 'search'].includes(parsed.action)) {
    return {
      action: 'open_url',
      label: query ? 'Google search' : 'Google',
      url: query
        ? `https://www.google.com/search?q=${encodeURIComponent(query)}`
        : 'https://www.google.com'
    };
  }

  if (parsed.action === 'close' && (app === 'youtube' || app === 'google')) {
    return {
      action: 'close_url',
      label: app === 'youtube' ? 'YouTube' : 'Google'
    };
  }

  if (isNativeParsedApp(app)) {
    return {
      action: parsed.action === 'close' ? 'close_app' : 'open_app',
      app,
      label: nativeAppLabel(app)
    };
  }

  if (parsed.action === 'media') {
    return resolveDesktopIntent(parsed.rawIntent || 'play pause') || {
      action: 'media_key',
      key: 'play_pause',
      label: 'Toggling playback'
    };
  }

  return null;
}

function isNativeParsedApp(app) {
  return ['telegram', 'chrome', 'spotify', 'vscode', 'notepad', 'explorer', 'calculator', 'word', 'excel', 'obs'].includes(app);
}

function nativeAppLabel(app) {
  const labels = {
    telegram: 'Telegram',
    chrome: 'Chrome',
    spotify: 'Spotify',
    vscode: 'VS Code',
    notepad: 'Notepad',
    explorer: 'File Explorer',
    calculator: 'Calculator',
    word: 'Microsoft Word',
    excel: 'Microsoft Excel',
    obs: 'OBS Studio'
  };
  return labels[app] || app;
}

function resolveParsedTargetDevices(parsedDevices = [], approvedDevices = []) {
  const tokens = (Array.isArray(parsedDevices) && parsedDevices.length ? parsedDevices : ['default'])
    .map((device) => String(device || '').trim())
    .filter(Boolean);
  const requestedNames = [];
  const matched = new Map();
  const defaultDevice = approvedDevices.find((device) => device.is_default) || approvedDevices[0] || null;

  const addDevice = (device) => {
    if (device) matched.set(device.id, device);
  };

  for (const token of tokens) {
    const normalized = normalizeDeviceText(token);
    if (!normalized || normalized === 'default') {
      addDevice(defaultDevice);
      continue;
    }
    if (normalized === 'all') {
      approvedDevices.forEach(addDevice);
      continue;
    }
    if (normalized === 'both') {
      approvedDevices.slice(0, 2).forEach(addDevice);
      requestedNames.push(token);
      continue;
    }
    if (normalized === 'my computer') {
      addDevice(findDeviceByName(token, approvedDevices) || defaultDevice);
      requestedNames.push(token);
      continue;
    }

    const ordinal = normalized.match(/^computer ([1-9]\d*)$/);
    if (ordinal) {
      addDevice(findDeviceByName(token, approvedDevices) || approvedDevices[Number(ordinal[1]) - 1]);
      requestedNames.push(token);
      continue;
    }

    requestedNames.push(token);
    addDevice(findDeviceByName(token, approvedDevices));
  }

  return {
    targets: [...matched.values()],
    requestedNames: requestedNames.filter((name) => !findDeviceByName(name, approvedDevices))
  };
}

async function normalizeIncomingCommand(message) {
  const raw = String(message || '').trim();
  if (!raw) return '';
  try {
    const repaired = await geminiRepairTranscript(raw);
    const normalized = normalizeSpokenCommand(repaired);
    return normalized || normalizeSpokenCommand(raw);
  } catch (error) {
    console.warn(`Transcript repair unavailable: ${error.message}`);
    return normalizeSpokenCommand(raw);
  }
}

async function analyzeCommand(text, address) {
  const devices = await safeListDevices();
  const intent = await classifyIntent(text, { devices, address });
  const minimumConfidence = Number(process.env.INTENT_CONFIDENCE_THRESHOLD || 0.62);
  const confidentIntent = intent && intent.type !== 'none' && intent.confidence >= minimumConfidence;

  if (confidentIntent) {
    const commandText = normalizeIntentCommandText(intent, text);
    if (intent.type === 'web_search') {
      const explicitSiteIntent = resolveDesktopIntent(commandText);
      if (explicitSiteIntent?.action === 'open_url' && isExplicitWebsiteCommand(commandText)) {
        return {
          text,
          plan: buildDesktopPlan(commandText, explicitSiteIntent, devices, {
            source: 'nlp',
            intent,
            explicitTargetDevice: intent.targetDevice
          })
        };
      }
      return {
        text,
        plan: {
          kind: 'search',
          query: intent.query || stripSearchTrigger(commandText),
          originalText: text,
          meta: { source: 'nlp', intent }
        }
      };
    }

    if (intent.type === 'device_status') {
      return {
        text,
        plan: {
          kind: 'device_status',
          text: commandText,
          meta: { source: 'nlp', intent }
        }
      };
    }

    if (intent.type === 'desktop') {
      const desktopIntent = resolveDesktopIntent(commandText);
      if (desktopIntent) {
        return {
          text,
          plan: buildDesktopPlan(commandText, desktopIntent, devices, {
            source: 'nlp',
            intent,
            explicitTargetDevice: intent.targetDevice
          })
        };
      }
    }
  }

  const explicitLocalDesktopIntent = resolveDesktopIntent(text);
  if (explicitLocalDesktopIntent?.action === 'open_url' && isExplicitWebsiteCommand(text)) {
    return {
      text,
      plan: buildDesktopPlan(text, explicitLocalDesktopIntent, devices, { source: 'local' })
    };
  }

  if (isSearchRequest(text)) {
    return {
      text,
      plan: {
        kind: 'search',
        query: stripSearchTrigger(text),
        originalText: text,
        meta: { source: 'local' }
      }
    };
  }

  if (isDeviceStatusRequest(text)) {
    return {
      text,
      plan: {
        kind: 'device_status',
        text,
        meta: { source: 'local' }
      }
    };
  }

  const localDesktopIntent = resolveDesktopIntent(text);
  if (localDesktopIntent) {
    return {
      text,
      plan: buildDesktopPlan(text, localDesktopIntent, devices, { source: 'local' })
    };
  }

  return null;
}

async function executeCommandPlan(plan, address) {
  if (!plan) return {};
  if (plan.kind === 'search') {
    return handleSearchCommand(plan.query, plan.originalText, address, plan.meta);
  }
  if (plan.kind === 'device_status') {
    return handleDeviceStatusCommand(plan.text, address, plan.meta);
  }
  if (plan.kind === 'desktop') {
    if (plan.errorReply) {
      return {
        command: plan.command || 'desktop:target-missing',
        payload: plan.payload || null,
        reply: plan.errorReply
      };
    }
    return handleDesktopCommand(plan.text, plan.desktopIntent, address, plan.meta, plan.targets, plan.requestedNames);
  }
  return {};
}

async function handleSearchCommand(query, originalText, address, meta = {}) {
  const searchQuery = String(query || originalText || '').trim();
  let results;
  try {
    results = await webSearch(searchQuery || originalText);
  } catch (error) {
    return {
      command: meta.source === 'nlp' ? 'search:nlp-error' : 'search:error',
      payload: { query: searchQuery || originalText, error: error.message, intent: meta.intent || null, parser: meta.parser || null },
      reply: `I could not complete the web search just now, ${address}: ${error.message}. The network appears to be behaving like it has opinions.`
    };
  }

  if (results.provider !== 'none') {
    const first = results.answer || results.results?.[0]?.snippet || 'I found results, but they are being coy.';
    return {
      command: 'search',
      payload: { ...results, intent: meta.intent || null, parser: meta.parser || null },
      reply: `${first} I have placed the sources on screen, ${address}.`
    };
  }
  return {
    command: 'search:unconfigured',
    payload: { ...results, intent: meta.intent || null, parser: meta.parser || null },
    reply: `Web search is not configured yet, ${address}. Add a Tavily or SerpAPI key and I shall stop pretending the internet is a rumour.`
  };
}

async function handleDeviceStatusCommand(text, address, meta = {}) {
  const devices = await listDevices();
  const approved = devices.filter((device) => device.status === 'approved');
  const parsedDeviceTokens = Array.isArray(meta.parser?.devices) ? meta.parser.devices : [];
  const parsedWantsSpecificDevice = parsedDeviceTokens.some((token) => {
    const normalized = normalizeDeviceText(token);
    return normalized && normalized !== 'default';
  });

  if (parsedWantsSpecificDevice) {
    const selection = resolveParsedTargetDevices(parsedDeviceTokens, approved);
    if (!selection.targets.length) {
      return {
        command: 'devices:target-missing',
        payload: { requested: selection.requestedNames, devices: approved, intent: meta.intent || null, parser: meta.parser || null },
        reply: buildMissingDeviceReply(selection.requestedNames, address)
      };
    }
    return {
      command: 'devices:parser-status',
      payload: { devices: selection.targets, intent: meta.intent || null, parser: meta.parser || null },
      reply: buildDeviceStatusReply(selection.targets, address, selection.targets.length === 1)
    };
  }

  const requestedName = resolveRequestedDeviceName(text, meta.intent?.targetDevice || '');
  const selected = requestedName
    ? findDeviceByName(requestedName, approved)
    : chooseRemoteDevice(text, approved, { allowDefault: false });
  if (requestedName && !selected) {
    return {
      command: 'devices:target-missing',
      payload: { requested: requestedName, devices: approved, intent: meta.intent || null },
      reply: `I do not see a linked device named "${requestedName}", ${address}.`
    };
  }
  const relevantDevices = selected ? [selected] : devices;
  const nameReply = buildDeviceNameReply(text, relevantDevices, address, Boolean(selected));
  return {
    command: meta.source === 'nlp' ? 'devices:nlp-status' : 'devices:status',
    payload: { devices: relevantDevices, intent: meta.intent || null },
    reply: nameReply || buildDeviceStatusReply(relevantDevices, address, Boolean(selected))
  };
}

async function handleDesktopCommand(text, desktopIntent, address, meta = {}, targetOverrides = [], requestedNames = []) {
  if (os.platform() !== 'win32') {
    const devices = (await listDevices()).filter((device) => device.status === 'approved');
    if (!devices.length) {
      return {
        command: 'desktop:remote-unavailable',
        payload: { intent: meta.intent || null },
        reply: `No approved computer is linked yet, ${address}. Install the Windows agent, approve it in Devices, and I shall stop gesturing helplessly at the cloud.`
      };
    }
    const targets = targetOverrides?.length ? targetOverrides : [chooseRemoteDevice(text, devices)].filter(Boolean);
    if (!targets.length) {
      if (requestedNames.length) {
        return {
          command: 'desktop:target-missing',
          payload: { requested: requestedNames, devices, intent: meta.intent || null },
          reply: buildMissingDeviceReply(requestedNames, address)
        };
      }
      return {
        command: 'desktop:choose-device',
        payload: { devices, intent: meta.intent || null },
        reply: `Which computer shall I use, ${address}? I see ${devices.map((device) => device.name).join(', ')}. Set one as default in Devices and I shall stop asking obvious questions.`
      };
    }
    const executions = await Promise.all(targets.map((device) => executeRemoteDesktopCommand(device, text, desktopIntent, meta)));
    const summary = summarizeRemoteExecutions(executions, address, meta);
    return {
      command: summary.command,
      payload: { executions, intent: meta.intent || null },
      reply: summary.reply
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

function buildDesktopPlan(text, desktopIntent, devices, { source = 'local', intent = null, explicitTargetDevice = '' } = {}) {
  const approved = (devices || []).filter((device) => device.status === 'approved');
  const selection = resolveTargetDevices(text, approved, explicitTargetDevice);

  return {
    kind: 'desktop',
    text,
    desktopIntent,
    meta: { source, intent },
    targets: selection.targets,
    requestedNames: selection.requestedNames
  };
}

function resolveRequestedDeviceName(text, explicitTargetDevice = '') {
  const explicit = String(explicitTargetDevice || '').trim();
  if (explicit) return explicit;
  const value = String(text || '').trim();
  if (!value || /\bdefault\b/i.test(value)) return '';

  const patterns = [
    /\b(?:on|in|at|for)\s+(?:my\s+)?([\p{L}\p{N}][\p{L}\p{N}\s-]{0,40}?)\s+(?:computer|pc|laptop|desktop|device)\b/iu,
    /\b(?:my\s+)?([\p{L}\p{N}][\p{L}\p{N}\s-]{0,40}?)\s+(?:computer|pc|laptop|desktop|device)\b/iu,
    /\b(ikkinchi|birinchi|uchinchi|to['‘’`]?rtinchi|beshinchi)\s+kompyuter\b/iu,
    /\b(второй|втором|первый|первом|третий|третьем)\s+компьютер(?:е)?\b/iu
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const candidate = (match[1] || match[0] || '').trim();
    if (candidate) return candidate;
  }

  return '';
}

function findDeviceByName(requestedName, devices) {
  const normalizedRequested = normalizeDeviceText(requestedName);
  if (!normalizedRequested) return null;
  return devices.find((device) => {
    const names = [device.name, device.metadata?.hostname, device.metadata?.username].filter(Boolean);
    return names.some((name) => {
      const target = normalizeDeviceText(name);
      return target && normalizedRequested === target;
    });
  }) || null;
}

function resolveTargetDevices(text, devices, explicitTargetDevice = '') {
  const requestedNames = [];
  const matched = new Map();
  const sourceText = String(text || '');

  for (const name of splitRequestedDeviceNames(explicitTargetDevice)) {
    requestedNames.push(name);
    const match = findDeviceByName(name, devices);
    if (match) matched.set(match.id, match);
  }

  for (const device of devices) {
    const names = [device.name, device.metadata?.hostname, device.metadata?.username].filter(Boolean);
    if (names.some((name) => deviceMentionedInText(sourceText, name))) {
      matched.set(device.id, device);
    }
  }

  const explicitSingle = resolveRequestedDeviceName(sourceText, explicitTargetDevice);
  if (explicitSingle && !requestedNames.some((name) => normalizeDeviceText(name) === normalizeDeviceText(explicitSingle))) {
    requestedNames.push(explicitSingle);
    const match = findDeviceByName(explicitSingle, devices);
    if (match) matched.set(match.id, match);
  }

  if (isAllDevicesRequest(sourceText)) {
    return { targets: devices, requestedNames: devices.map((device) => device.name) };
  }

  if (isBothDevicesRequest(sourceText)) {
    if (matched.size >= 2) return { targets: [...matched.values()], requestedNames };
    if (devices.length === 2) return { targets: devices, requestedNames: devices.map((device) => device.name) };
  }

  if (matched.size) {
    return { targets: [...matched.values()], requestedNames };
  }

  return { targets: [], requestedNames };
}

function splitRequestedDeviceNames(value) {
  return String(value || '')
    .split(/\s*(?:,| and | & | hamda | va | и )\s*/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function deviceMentionedInText(text, deviceName) {
  const normalizedText = normalizeDeviceText(text);
  const normalizedName = normalizeDeviceText(deviceName);
  return Boolean(normalizedText && normalizedName && normalizedText.includes(normalizedName));
}

function isAllDevicesRequest(text) {
  return /\b(all|every|each|hammasi|barchasi|все)\b/i.test(String(text || ''))
    && /\b(device|devices|computer|computers|pc|pcs|laptop|laptops|machine|machines|kompyuter|компьютер)\b/i.test(String(text || ''));
}

function isBothDevicesRequest(text) {
  return /\b(both|ikkalasi|оба)\b/i.test(String(text || ''))
    && /\b(device|devices|computer|computers|pc|pcs|laptop|laptops|machine|machines|kompyuter|компьютер)\b/i.test(String(text || ''));
}

async function executeRemoteDesktopCommand(device, text, desktopIntent, meta) {
  const reachability = getDeviceReachability(device);
  if (!reachability.online) {
    return {
      status: 'offline',
      device,
      reachability
    };
  }

  const command = buildRemoteCommand(device, desktopIntent, text, meta);
  const queued = await queueCommand(device.id, command.type, command.payload);
  const completed = await waitForCommandCompletion(queued.id, Number(process.env.REMOTE_COMMAND_WAIT_MS || 9000));
  return {
    status: completed?.status || 'queued',
    device,
    queued,
    completed,
    reachability
  };
}

function buildRemoteCommand(device, desktopIntent, text, meta = {}) {
  if (!desktopIntent || !desktopIntent.action) {
    return {
      type: 'desktop_intent',
      payload: { message: meta.intent?.normalizedText || meta.parser?.rawIntent || text, intent: meta.intent || null, parser: meta.parser || null }
    };
  }

  if (desktopIntent.action === 'open_url') {
    const openIntent = meta.parser ? desktopIntent : normalizeOpenUrlIntent(desktopIntent);
    return {
      type: 'open_url',
      payload: {
        url: openIntent.url,
        label: openIntent.label,
        intent: meta.intent || null,
        parser: meta.parser || null
      }
    };
  }

  if (desktopIntent.action === 'close_url') {
    if (!supportsStructuredRemote(device)) {
      return {
        type: 'desktop_intent',
        payload: { message: meta.intent?.normalizedText || meta.parser?.rawIntent || text, intent: meta.intent || null, parser: meta.parser || null }
      };
    }
    return {
      type: 'close_url',
      payload: {
        label: desktopIntent.label,
        intent: meta.intent || null,
        parser: meta.parser || null
      }
    };
  }

  if (desktopIntent.action === 'open_app') {
    return {
      type: 'open_app',
      payload: {
        app: desktopIntent.app,
        label: desktopIntent.label,
        appName: desktopIntent.appName,
        intent: meta.intent || null,
        parser: meta.parser || null
      }
    };
  }

  if (desktopIntent.action === 'close_app') {
    return {
      type: 'close_app',
      payload: {
        app: desktopIntent.app,
        label: desktopIntent.label,
        appName: desktopIntent.appName,
        intent: meta.intent || null,
        parser: meta.parser || null
      }
    };
  }

  if (desktopIntent.action === 'media_key') {
    return {
      type: 'media_key',
      payload: {
        key: desktopIntent.key,
        label: desktopIntent.label,
        intent: meta.intent || null,
        parser: meta.parser || null
      }
    };
  }

  return {
    type: 'desktop_intent',
    payload: { message: meta.intent?.normalizedText || meta.parser?.rawIntent || text, intent: meta.intent || null, parser: meta.parser || null }
  };
}

function normalizeOpenUrlIntent(desktopIntent) {
  const url = String(desktopIntent?.url || '').trim();
  if (!url) return desktopIntent;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const rawQuery = parsed.searchParams.get('search_query') || '';
      if (parsed.pathname === '/results' || rawQuery) {
        const query = cleanRemoteSearchQuery(rawQuery, 'youtube');
        return {
          ...desktopIntent,
          label: desktopIntent.label || 'YouTube',
          url: query
            ? `https://www.youtube.com/results?${new URLSearchParams({ search_query: query }).toString()}`
            : 'https://www.youtube.com'
        };
      }
    }

    if (host === 'google.com') {
      const rawQuery = parsed.searchParams.get('q') || '';
      if (parsed.pathname === '/search' || rawQuery) {
        const query = cleanRemoteSearchQuery(rawQuery, 'google');
        return {
          ...desktopIntent,
          label: query ? (desktopIntent.label || 'Google search') : 'Google',
          url: query
            ? `https://www.google.com/search?${new URLSearchParams({ q: query }).toString()}`
            : 'https://www.google.com'
        };
      }
    }
  } catch {
    return desktopIntent;
  }

  return desktopIntent;
}

function cleanRemoteSearchQuery(query, site = '') {
  let value = String(query || '')
    .replace(/\b(?:on|in|at|for)\s+(?:my\s+)?(?:computer|pc|laptop|desktop|device)\s*(?:\d+|one|two|three|four|five)?\b/gi, ' ')
    .replace(/\b(?:on|in|at|for)\s+(?:my\s+)?(?:default\s+)?(?:first|second|third|fourth|fifth|another)\s+(?:computer|pc|laptop|desktop|device)\b/gi, ' ')
    .replace(/\b(?:on|in|at|for)\s+[\p{L}\p{N}\s-]{1,30}\s+(?:computer|pc|laptop|desktop|device)\b/giu, ' ')
    .replace(/\b(search the web for|search for|find me|look for|show me)\b/gi, ' ')
    .replace(/\b(open|play|put on|search|find|show|watch|google|youtube|you tube)\b/gi, ' ')
    .replace(/\bweather information\b/gi, 'weather')
    .replace(/\s+/g, ' ')
    .trim();
  if (site === 'youtube') value = value.toLowerCase();
  return value;
}

function supportsStructuredRemote(device) {
  const version = String(device?.metadata?.agentVersion || '').trim();
  if (!version) return false;
  return compareVersions(version, '0.2.0') >= 0;
}

function compareVersions(left, right) {
  const parse = (value) => String(value || '0')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function summarizeRemoteExecutions(executions, address, meta = {}) {
  const successes = executions.filter((item) => item.status === 'success');
  const offline = executions.filter((item) => item.status === 'offline');
  const errors = executions.filter((item) => item.status === 'error' || item.status === 'cancelled');
  const queued = executions.filter((item) => item.status === 'queued');

  if (successes.length === executions.length) {
    return {
      command: successes.length > 1 ? 'desktop:remote-multi-success' : 'desktop:remote-success',
      reply: buildRemoteSuccessReply(successes, address, meta)
    };
  }

  const parts = [];
  if (successes.length) parts.push(stripAddress(buildRemoteSuccessReply(successes, address, meta), address));
  if (offline.length) parts.push(`${joinDeviceNames(offline.map((item) => item.device.name))} ${offline.length === 1 ? 'is' : 'are'} offline`);
  if (queued.length) parts.push(`still waiting on ${joinDeviceNames(queued.map((item) => item.device.name))}`);
  if (errors.length) {
    parts.push(errors.map((item) => `Could not complete that on ${item.device.name}`).join('; '));
  }

  return {
    command: 'desktop:remote-mixed',
    reply: `${parts.join('. ')}, ${address}.`
  };
}

function buildRemoteSuccessReply(executions, address, meta = {}) {
  if (!executions.length) return `Done, ${address}.`;

  const phrases = executions.map((execution) => buildRemoteSuccessPhrase(execution, meta));
  const first = phrases[0];
  const samePhrase = phrases.every((phrase) => phrase === first);

  if (samePhrase) {
    return `${first} on ${joinDeviceNames(executions.map((item) => item.device.name))}, ${address}.`;
  }

  const fragments = executions.map((execution, index) => `${phrases[index]} on ${execution.device.name}`);
  return `${fragments.join('. ')}, ${address}.`;
}

function buildRemoteSuccessPhrase(execution, meta = {}) {
  const type = execution.queued?.type;
  const payload = execution.queued?.payload || {};
  const parsed = payload.parser || meta.parser || null;

  if (type === 'open_url') {
    const details = describeUrlCommand(payload.url, payload.label, parsed);
    if (details.site === 'YouTube') return details.query ? `Searching YouTube for ${details.query}` : 'Opening YouTube';
    if (details.site === 'Google') return details.query ? `Searching Google for ${details.query}` : 'Opening Google';
    return `Opening ${details.label || 'the requested page'}`;
  }

  if (type === 'open_app') return `Opening ${parsed?.appOrSite ? nativeAppLabel(parsed.appOrSite) : (payload.label || payload.appName || payload.app || 'the requested app')}`;
  if (type === 'close_app') return `Closing ${parsed?.appOrSite ? nativeAppLabel(parsed.appOrSite) : (payload.label || payload.appName || payload.app || 'the requested app')}`;
  if (type === 'close_url') return `Closing ${payload.label || (parsed?.appOrSite ? nativeAppLabel(parsed.appOrSite) : '') || 'the requested page'}`;
  if (type === 'media_key') return 'Done';

  return 'Done';
}

function describeUrlCommand(url, fallbackLabel = '', parsed = null) {
  try {
    const parsedUrl = new URL(String(url || ''));
    const host = parsedUrl.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      return {
        site: 'YouTube',
        label: 'YouTube',
        query: parsed?.searchQuery || parsedUrl.searchParams.get('search_query') || ''
      };
    }
    if (host === 'google.com') {
      return {
        site: 'Google',
        label: 'Google',
        query: parsed?.searchQuery || parsedUrl.searchParams.get('q') || ''
      };
    }
  } catch {
    // The fallback label is still useful if the URL is malformed.
  }
  return { site: '', label: fallbackLabel, query: parsed?.searchQuery || '' };
}

function stripAddress(reply, address) {
  const suffix = new RegExp(`,\\s*${escapeRegExp(address)}\\.$`, 'i');
  return String(reply || '').replace(suffix, '').replace(/\.$/, '');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function joinDeviceNames(names) {
  const items = Array.from(new Set((names || []).filter(Boolean)));
  if (!items.length) return 'no devices';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function buildMissingDeviceReply(requestedNames, address) {
  const names = Array.from(new Set((requestedNames || []).filter(Boolean)));
  if (!names.length) return `I do not see the requested device, ${address}.`;
  if (names.length === 1) {
    return `I do not see a linked device named "${names[0]}", ${address}.`;
  }
  return `I do not see linked devices named ${names.map((name) => `"${name}"`).join(', ')}, ${address}.`;
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
  const merged = mergeSpelledOutWords(String(text || ''));
  return repairFragmentedCommandWords(normalizeMultilingualCommand(merged))
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

function mergeSpelledOutWords(text) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let buffer = [];

  const flush = () => {
    if (!buffer.length) return;
    if (buffer.length >= 3) {
      out.push(buffer.join(''));
    } else {
      out.push(...buffer);
    }
    buffer = [];
  };

  for (const token of tokens) {
    if (/^\p{L}$/u.test(token)) {
      buffer.push(token);
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out.join(' ');
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
    .replace(/\b(youtube|you tube|yutub|ютуб)(ni)?\s+(yop|yoping|o['‘’`]?chir|to['‘’`]?xtat|yopib qo['‘’`]?y)\b/giu, 'close youtube')
    .replace(/\b(yop|yoping|o['‘’`]?chir|to['‘’`]?xtat|yopib qo['‘’`]?y)\s+(youtube|you tube|yutub|ютуб)\b/giu, 'close youtube')
    .replace(/\b(google|гугл)(ni)?\s+(och|oching|ochib ber|ishga tushir|yoq)\b/giu, 'open google')
    .replace(/\b(och|oching|ochib ber|ishga tushir|yoq)\s+(google|гугл)\b/giu, 'open google')
    .replace(/\b(google|гугл)(ni)?\s+(yop|yoping|o['‘’`]?chir|to['‘’`]?xtat|yopib qo['‘’`]?y)\b/giu, 'close google')
    .replace(/\b(yop|yoping|o['‘’`]?chir|to['‘’`]?xtat|yopib qo['‘’`]?y)\s+(google|гугл)\b/giu, 'close google')
    .replace(/\b(xabar yoz|xabar yubor|yozib yubor|telegramdan yoz|sms yoz|sms yubor)\b/giu, 'message on telegram')
    .replace(/\b(musiqa|qo['‘’`]?shiq|ashula)\s+(qo['‘’`]?y|yoq|ijro et)\b/giu, 'play music')
    .replace(/\b(.{2,80}?)\s+(qo['‘’`]?y|ijro et)\b/giu, (_match, query) => `play ${query}`);

  value = value
    .replace(/(?:^|\s)(открой|запусти|включи)\s+(телеграм|телеграмм|telegram)(?=\s|$)/giu, ' open telegram')
    .replace(/(?:^|\s)(закрой|выключи|останови)\s+(телеграм|телеграмм|telegram)(?=\s|$)/giu, ' close telegram')
    .replace(/(?:^|\s)(открой|запусти|включи)\s+(ютуб|youtube)(?=\s|$)/giu, ' open youtube')
    .replace(/(?:^|\s)(закрой|выключи|останови)\s+(ютуб|youtube)(?=\s|$)/giu, ' close youtube')
    .replace(/(?:^|\s)(открой|запусти|включи)\s+(гугл|google)(?=\s|$)/giu, ' open google')
    .replace(/(?:^|\s)(закрой|выключи|останови)\s+(гугл|google)(?=\s|$)/giu, ' close google')
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

function isExplicitWebsiteCommand(message) {
  const lower = String(message || '').toLowerCase();
  return /^google\b/.test(lower)
    || /\b(?:open|play|watch|look for|search|find|show)\b.*\b(?:youtube|you tube|google)\b/.test(lower)
    || /\b(?:youtube|you tube|google)\b.*\b(?:open|play|watch|look for|search|find|show)\b/.test(lower);
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
  const onlineWindowMs = Number(process.env.DEVICE_ONLINE_WINDOW_MS || 180000);
  if (ageMs <= onlineWindowMs) return { online: true, label: 'online' };
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
