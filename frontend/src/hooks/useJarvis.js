import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVoice } from './useVoice.js';

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);
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
    const text = String(raw || '').trim();
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
      await executeDesktopIntent(text);
    }
  }

  async function executeDesktopIntent(text) {
    setStatus('THINKING');
    try {
      const response = await fetch(`${API_URL}/api/desktop/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, address })
      });
      const payload = await response.json();
      if (payload.handled && payload.reply) {
        appendMessage('assistant', payload.reply);
      }
      setStatus('LISTENING');
    } catch (error) {
      appendMessage('assistant', `Desktop control fault, ${address}: ${error.message}.`);
      setStatus('ERROR');
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
    /\b(play|pause|resume|stop|skip|next|previous|mute|unmute|volume up|volume down|louder|quieter)\b.*\b(music|song|audio|video|media)\b/.test(lower) ||
    /\b(i need|bring up|pull up|show me|open|close|quit|exit)\b/.test(lower) && /\b(app|browser|telegram|youtube|google|music|chrome)\b/.test(lower)
  );
}

function shouldUseTextSearchIntent(text) {
  const lower = String(text || '').toLowerCase();
  return /\b(latest|news|weather|forecast|temperature|current|today|search|web search|online|internet|look up|google this|find information|what happened)\b/.test(lower);
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
