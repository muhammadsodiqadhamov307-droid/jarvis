import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { attachGeminiLiveProxy, geminiText, geminiTextStream, geminiTts } from './gemini.js';
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
import { formatUserDateTime, getUserTimeContext } from './time.js';
import { getSettingsForClient, updateSettings } from './settings.js';
import { getStartupStatus, setStartupEnabled } from './startup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3001);

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

attachGeminiLiveProxy(server);

app.get('/api/health', (_req, res) => {
  const time = getUserTimeContext();
  res.json({
    ok: true,
    time: time.dateTime,
    timeZone: time.timeZone,
    liveVoiceConfigured: Boolean(process.env.GEMINI_API_KEY),
    ttsProvider: process.env.TTS_PROVIDER || 'gemini',
    elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
    searchConfigured: Boolean(process.env.TAVILY_API_KEY || process.env.SERPAPI_KEY)
  });
});

app.get('/api/session', (req, res) => {
  const address = req.query.address || process.env.DEFAULT_ADDRESS || 'Sir';
  const time = getUserTimeContext();
  res.json({
    systemPrompt: buildSystemPrompt(address),
    memories: getRelevantMemories(),
    time: time.dateTime,
    timeZone: time.timeZone
  });
});

app.get('/api/memory', (req, res) => {
  res.json(getRelevantMemories(req.query.q || ''));
});

app.post('/api/memory/remember', (req, res) => {
  const id = rememberFact(req.body.content, req.body.key, req.body.metadata);
  res.status(201).json({ id });
});

app.post('/api/memory/forget', (req, res) => {
  res.json({ deleted: forgetMemory(req.body.query) });
});

app.post('/api/session/summary', (_req, res) => {
  const id = summarizeSession();
  res.json({ id });
});

app.get('/api/notes', (req, res) => {
  res.json(listNotes(req.query.q || ''));
});

app.post('/api/notes', (req, res) => {
  res.status(201).json(createNote(req.body));
});

app.patch('/api/notes/append', (req, res) => {
  res.json(appendToNote(req.body.topic, req.body.content));
});

app.delete('/api/notes/:identifier', (req, res) => {
  res.json({ deleted: deleteNote(req.params.identifier) });
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

app.post('/api/chat', async (req, res, next) => {
  try {
    const address = req.body.address || process.env.DEFAULT_ADDRESS || 'Sir';
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    addExchange('user', message);
    const commandResult = await handleCommand(message, address);
    let reply = commandResult.reply;

    if (!reply) {
      reply = await geminiText(message, address);
    }

    if (!reply) {
      reply = localJarvisReply(message, address);
    }

    addExchange('assistant', reply);
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

    addExchange('user', message);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    if (isSlowLookup(message)) {
      writeStreamEvent(res, 'ack', { text: `Checking now, ${address}.` });
    }

    const commandResult = await handleCommand(message, address);
    if (commandResult.reply) {
      addExchange('assistant', commandResult.reply);
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

    addExchange('assistant', reply.trim());
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
  res.status(500).json({
    error: error.message || 'A regrettable malfunction occurred.'
  });
});

server.listen(PORT, () => {
  console.log(`JARVIS backend listening on http://localhost:${PORT}`);
});

async function handleCommand(message, address) {
  const text = message.trim();
  const lower = text.toLowerCase();

  if (isSearchRequest(text)) {
    const query = text
      .replace(/^(jarvis[, ]*)?(search online for|search the web for|web search for|search for|search|look up|google)\s+/i, '')
      .trim();
    let results;
    try {
      results = await webSearch(query || text);
    } catch (error) {
      return {
        command: 'search:error',
        payload: { query: query || text, error: error.message },
        reply: `I could not complete the web search just now, ${address}: ${error.message}. The network appears to be behaving like it has opinions.`
      };
    }

    if (results.provider !== 'none') {
      const first = results.answer || results.results?.[0]?.snippet || 'I found results, but they are being coy.';
      return {
        command: 'search',
        payload: results,
        reply: `${first} I have placed the sources on screen, ${address}.`
      };
    }
    return {
      command: 'search:unconfigured',
      payload: results,
      reply: `Web search is not configured yet, ${address}. Add a Tavily or SerpAPI key and I shall stop pretending the internet is a rumour.`
    };
  }

  const desktopIntent = resolveDesktopIntent(text);
  if (desktopIntent) {
    const result = await executeDesktopIntent(desktopIntent);
    return {
      command: 'desktop',
      payload: result,
      reply: desktopReply(result, address)
    };
  }

  const remember = text.match(/remember that\s+(.+)/i);
  if (remember) {
    const content = remember[1].trim();
    rememberFact(content, null, { source: 'voice-command' });
    return {
      command: 'remember',
      reply: `Committed to memory, ${address}. A rare pleasure to store something intentionally.`
    };
  }

  const forget = text.match(/forget that\s+(.+)/i);
  if (forget) {
    const deleted = forgetMemory(forget[1]);
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
    const note = createNote({ content: create[1], title: create[1].slice(0, 44) });
    return {
      command: 'notes:create',
      payload: note,
      reply: `Note created, ${address}: ${note.title}. Shall I keep the quill warm?`
    };
  }

  if (/show my notes/i.test(text)) {
    const notes = listNotes();
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
    const deleted = deleteNote(deleteMatch[1]);
    return {
      command: 'notes:delete',
      payload: { deleted },
      reply: deleted ? `Deleted, ${address}.` : `No matching note found, ${address}.`
    };
  }

  const searchNotes = text.match(/search my notes for\s+(.+)/i);
  if (searchNotes) {
    const notes = listNotes(searchNotes[1]);
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
    const note = appendToNote(append[1], append[2]);
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

  return {};
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
  return /^search\s+/i.test(message) || /latest|news|weather|current|today/i.test(message);
}

function isSearchRequest(message) {
  return /^(search|web search|search online|look up|google)\b/i.test(message)
    || /\b(latest|news|weather|forecast|temperature|current|today|online|internet|what happened)\b/i.test(message);
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
