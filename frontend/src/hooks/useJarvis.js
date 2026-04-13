import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../config.js';
import { useVoice } from './useVoice.js';
const makeId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export function useJarvis() {
  const [status, setStatus] = useState('LISTENING');
  const [address, setAddress] = useState(localStorage.getItem('jarvis-address') || 'Sir');
  const [messages, setMessages] = useState([
    {
      id: makeId(),
      role: 'assistant',
      content: 'Systems online, Sir. I am passively monitoring audio and ready when spoken to.'
    }
  ]);
  const [notes, setNotes] = useState([]);
  const [input, setInput] = useState('');
  const [liveReady, setLiveReady] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const autoStartedRef = useRef(false);
  const liveTranscriptRef = useRef({ userId: null, userText: '', assistantId: null, assistantText: '' });
  const lastLocalIntentRef = useRef({ text: '', at: 0 });
  const liveIntentTimerRef = useRef(null);

  const appendMessage = useCallback((role, content) => {
    const id = makeId();
    setMessages((current) => [...current, { id, role, content }]);
    return id;
  }, []);

  const updateMessage = useCallback((id, content) => {
    setMessages((current) => current.map((message) => (
      message.id === id ? { ...message, content } : message
    )));
  }, []);

  const refreshNotes = useCallback(async (q = '') => {
    const response = await fetch(`${API_URL}/api/notes${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    setNotes(await response.json());
  }, []);

  const handleLiveTranscript = useCallback((role, text) => {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return;

    const transcript = liveTranscriptRef.current;
    if (role === 'user') {
      transcript.assistantId = null;
      transcript.assistantText = '';
      if (!transcript.userId) {
        transcript.userId = appendMessage('user', cleaned);
        transcript.userText = cleaned;
      } else if (!isDuplicateTranscript(transcript.userText, cleaned)) {
        transcript.userText = `${transcript.userText} ${cleaned}`.trim();
        updateMessage(transcript.userId, transcript.userText);
      }
      clearTimeout(liveIntentTimerRef.current);
      liveIntentTimerRef.current = window.setTimeout(() => {
        handleLiveFinalText(liveTranscriptRef.current.userText);
      }, 1400);
      return;
    }

    transcript.userId = null;
    transcript.userText = '';
    if (!transcript.assistantId) {
      transcript.assistantId = appendMessage('assistant', cleaned);
      transcript.assistantText = cleaned;
    } else if (!isDuplicateTranscript(transcript.assistantText, cleaned)) {
      transcript.assistantText = `${transcript.assistantText} ${cleaned}`.trim();
      updateMessage(transcript.assistantId, transcript.assistantText);
    }
  }, [appendMessage, updateMessage]);

  const voice = useVoice({
    onFinalText: (text) => sendMessage(text),
    onSpeechStart: () => setStatus('LISTENING'),
    onSpeechEnd: () => setStatus((current) => (current === 'LISTENING' ? 'LISTENING' : current)),
    onLiveStatus: (ready) => setLiveReady(ready),
    onLiveTranscript: handleLiveTranscript,
    onLiveFinalText: (text) => handleLiveFinalText(text),
    onLiveToolResult: (type, payload) => {
      if (type === 'search') setSearchResults(payload);
    }
  });

  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    voice.startListening();
  }, [voice]);

  useEffect(() => {
    localStorage.setItem('jarvis-address', address);
  }, [address]);

  useEffect(() => {
    refreshNotes();
    fetch(`${API_URL}/api/session?address=${encodeURIComponent(address)}`).catch(() => setLiveReady(false));
  }, [address, refreshNotes]);

  useEffect(() => {
    const summarize = () => {
      navigator.sendBeacon?.(`${API_URL}/api/session/summary`, new Blob(['{}'], { type: 'application/json' }));
    };
    window.addEventListener('beforeunload', summarize);
    return () => {
      clearTimeout(liveIntentTimerRef.current);
      window.removeEventListener('beforeunload', summarize);
    };
  }, []);

  useEffect(() => {
    const down = (event) => {
      if (event.code === 'Space' && !event.repeat && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault();
        voice.startListening();
      }
    };
    const up = (event) => {
      if (event.code === 'Space' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault();
        voice.stopListening();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [voice]);

  const handleReminder = useCallback((text) => {
    const match = text.match(/remind me to\s+(.+?)\s+in\s+(\d+)\s+(second|seconds|minute|minutes|hour|hours)/i);
    if (!match) return false;
    const [, task, amountRaw, unit] = match;
    const amount = Number(amountRaw);
    const multiplier = unit.startsWith('hour') ? 3600000 : unit.startsWith('minute') ? 60000 : 1000;
    const delay = amount * multiplier;

      const confirm = `Reminder armed, ${address}: ${task}. I shall be insufferably punctual.`;
      appendMessage('assistant', confirm);
      setStatus('SPEAKING');
      voice.speak(confirm, { onEnd: () => setStatus('LISTENING') });

    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
    window.setTimeout(() => {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('JARVIS reminder', { body: task });
      }
      voice.speak(`Reminder, ${address}: ${task}`);
      appendMessage('assistant', `Reminder, ${address}: ${task}`);
    }, delay);
    return true;
  }, [address, appendMessage, voice]);

  async function handleLiveFinalText(raw) {
    const text = normalizeSpokenCommand(String(raw || '').trim());
    if (!text) return;
    const normalized = normalizeTranscript(text);
    const now = Date.now();
    if (lastLocalIntentRef.current.text === normalized && now - lastLocalIntentRef.current.at < 6000) return;

    if (shouldUseTextSearchIntent(text)) {
      lastLocalIntentRef.current = { text: normalized, at: now };
      await sendMessage(text, { appendUser: false });
      return;
    }

    if (shouldUseDesktopIntent(text)) {
      lastLocalIntentRef.current = { text: normalized, at: now };
      await sendMessage(text, { appendUser: false });
      return;
    }

    if (shouldUseDeviceStatusIntent(text)) {
      lastLocalIntentRef.current = { text: normalized, at: now };
      await sendMessage(text, { appendUser: false });
    }
  }

  const sendMessage = useCallback(async (raw, options = {}) => {
    const text = String(raw || '').trim();
    if (!text) return;
    setInput('');
    setSearchResults(null);
    if (options.appendUser !== false) appendMessage('user', text);

    if (handleReminder(text)) return;

    setStatus('THINKING');
    try {
      const response = await fetch(`${API_URL}/api/chat-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, address })
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Request failed');
      }

      let reply = '';
      let ttsBuffer = '';
      let meta = null;
      const assistantId = appendMessage('assistant', '');
      const speechQueue = voice.createSpeechQueue({
        onStart: () => setStatus('SPEAKING'),
        onEnd: () => setStatus('LISTENING')
      });
      setStatus('SPEAKING');

      for await (const event of readNdjson(response.body)) {
        if (event.type === 'meta') {
          meta = event;
          continue;
        }
        if (event.type === 'ack') {
          speechQueue.enqueue(event.text);
          continue;
        }
        if (event.type === 'delta') {
          reply += event.text || '';
          ttsBuffer += event.text || '';
          updateMessage(assistantId, reply);
          const readyChunks = takeReadySpeechChunks(ttsBuffer);
          ttsBuffer = readyChunks.remaining;
          readyChunks.chunks.forEach((chunk) => speechQueue.enqueue(chunk));
        }
        if (event.type === 'done') {
          reply = event.reply || reply;
          updateMessage(assistantId, reply);
        }
        if (event.type === 'error') throw new Error(event.error || 'Stream failed');
      }

      if (ttsBuffer.trim()) speechQueue.enqueue(ttsBuffer);
      await speechQueue.close();
      if (meta?.command?.startsWith('notes')) refreshNotes();
      if (meta?.command === 'search') {
        setSearchResults(meta.payload);
        voice.sendLiveText?.(`Read this verified web result to ${address} in one concise JARVIS response. Do not mention that this is a prompt. ${reply}`);
      }
      if (reply && (meta?.command?.startsWith('desktop') || meta?.command?.startsWith('devices'))) {
        voice.sendLiveText?.(`Report this completed controller result to ${address} in one concise JARVIS response. Do not mention that this is a prompt. ${reply}`);
      }
    } catch (error) {
      const reply = `A fault has occurred, ${address}: ${error.message}. I remain composed, naturally.`;
      appendMessage('assistant', reply);
      setStatus('ERROR');
      voice.speak(reply, { onEnd: () => setStatus('LISTENING') });
    }
  }, [address, appendMessage, handleReminder, refreshNotes, updateMessage, voice]);

  const deleteNote = useCallback(async (id) => {
    await fetch(`${API_URL}/api/notes/${id}`, { method: 'DELETE' });
    refreshNotes();
  }, [refreshNotes]);

  return useMemo(() => ({
    status,
    address,
    setAddress,
    messages,
    notes,
    input,
    setInput,
    sendMessage,
    refreshNotes,
    deleteNote,
    liveReady,
    searchResults,
    voice
  }), [address, deleteNote, input, liveReady, messages, notes, refreshNotes, searchResults, sendMessage, status, voice]);
}

function isDuplicateTranscript(existing, incoming) {
  const current = normalizeTranscript(existing);
  const next = normalizeTranscript(incoming);
  if (!current || !next) return false;
  return current.endsWith(next) || next.endsWith(current) || current.includes(next) || next.includes(current);
}

function normalizeTranscript(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldUseDesktopIntent(text) {
  const lower = String(text || '').toLowerCase();
  if (shouldUseTextSearchIntent(text) && !/\b(open|launch|start|run|close|quit|exit)\s+(?:the\s+)?weather\s+(?:app|application|program)\b/i.test(lower)) {
    return false;
  }
  return (
    /\b(telegram|youtube|you tube|google|chrome|spotify|vs code|vscode|code editor|notepad|file explorer|explorer|files|folder|calculator|calc|word|excel|obs|obs studio)\b/.test(lower) ||
    /\b(open|launch|start|run|close|quit|exit)\s+(?:the\s+)?[a-z0-9 ._-]{2,}$/i.test(lower) ||
    /\b(i need|bring up|pull up)\s+(?:the\s+)?[a-z0-9 ._-]{2,}$/i.test(lower) ||
    /\b(message|text|dm|chat|contact|send\s+(?:a\s+)?message|send\s+(?:a\s+)?text|write\s+to|talk\s+to)\b/i.test(lower) ||
    /\b(play|put on)\s+.{2,}$/i.test(lower) ||
    /\b(play|pause|resume|stop|skip|next|previous|mute|unmute|volume up|volume down|louder|quieter)\b.*\b(music|song|audio|video|media)\b/.test(lower) ||
    /\b(i need|bring up|pull up|show me|open|close|quit|exit)\b/.test(lower) && /\b(app|browser|telegram|youtube|google|music|chrome)\b/.test(lower)
  );
}

function shouldUseDeviceStatusIntent(text) {
  const lower = String(text || '').toLowerCase();
  const mentionsDevices = /\b(device|devices|computer|computers|pc|pcs|laptop|laptops|agent|agents|machine|machines)\b/i.test(lower);
  const asksStatus = /\b(connected|linked|available|online|offline|status|see|detect|detected|reachable|running|active|alive|working|registered)\b/i.test(lower);
  const asksList = /\b(show|list|what|which|any|how many|do you see|can you see)\b/i.test(lower);
  return mentionsDevices && (asksStatus || asksList);
}

function shouldUseTextSearchIntent(text) {
  const lower = String(text || '').toLowerCase();
  return /\b(latest|news|weather|forecast|temperature|current|today|search|web search|online|internet|look up|google this|find information|what happened)\b/.test(lower);
}

function normalizeSpokenCommand(text) {
  return normalizeMultilingualCommand(String(text || ''))
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

async function* readNdjson(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed);
    }
  }

  const final = buffer.trim();
  if (final) yield JSON.parse(final);
}

function takeReadySpeechChunks(buffer) {
  const chunks = [];
  let remaining = buffer;
  const sentencePattern = /^(.{4,}?[.!?;:])\s+/;
  const clausePattern = /^(.{90,}?,)\s+/;

  while (true) {
    const match = remaining.match(sentencePattern) || remaining.match(clausePattern);
    if (!match) break;
    chunks.push(match[1].trim());
    remaining = remaining.slice(match[0].length);
  }

  if (remaining.length > 180) {
    const splitAt = Math.max(
      remaining.lastIndexOf(',', 165),
      remaining.lastIndexOf(' ', 165)
    );
    if (splitAt > 80) {
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
  }

  return { chunks, remaining };
}
