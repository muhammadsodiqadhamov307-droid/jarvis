import { useCallback, useEffect, useRef, useState } from 'react';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);
const LIVE_AUDIO_ENABLED = import.meta.env.VITE_ENABLE_LIVE_AUDIO === 'true';
const LIVE_VOICE_MODE = import.meta.env.VITE_TTS_PROVIDER === 'live' || LIVE_AUDIO_ENABLED;
const SPEECH_RECOGNITION_LANG = import.meta.env.VITE_SPEECH_RECOGNITION_LANG || 'en-US';
const ttsCache = new Map();
let ttsDisabledUntil = 0;

export function useVoice({ onFinalText, onSpeechStart, onSpeechEnd, onLiveStatus, onLiveTranscript, onLiveFinalText, onLiveToolResult }) {
  const [supported, setSupported] = useState(Boolean(SpeechRecognition));
  const [listening, setListening] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const recognitionRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const liveUnmountedRef = useRef(false);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const activeSourceRef = useRef(null);
  const liveSourcesRef = useRef(new Set());
  const activeAudioRef = useRef(null);
  const livePlaybackTimeRef = useRef(0);
  const speakingRef = useRef(false);
  const monitoringRef = useRef(false);
  const listeningRef = useRef(false);
  const speechQueueRef = useRef(Promise.resolve());
  const speechRunRef = useRef(0);
  const playbackSerialRef = useRef(0);
  const bargeInFramesRef = useRef(0);
  const sentLiveFramesRef = useRef(0);
  const intentionallyStoppedRef = useRef(false);
  const startingRef = useRef(false);
  const assistantAudioBlockUntilRef = useRef(0);
  const callbacksRef = useRef({ onFinalText, onSpeechStart, onSpeechEnd, onLiveStatus, onLiveTranscript, onLiveFinalText, onLiveToolResult });

  useEffect(() => {
    setSupported(Boolean(SpeechRecognition));
  }, []);

  useEffect(() => {
    callbacksRef.current = { onFinalText, onSpeechStart, onSpeechEnd, onLiveStatus, onLiveTranscript, onLiveFinalText, onLiveToolResult };
  }, [onFinalText, onLiveFinalText, onLiveStatus, onLiveToolResult, onLiveTranscript, onSpeechEnd, onSpeechStart]);

  const connectLive = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = import.meta.env.VITE_API_WS || (
      import.meta.env.DEV
        ? `${protocol}//${window.location.hostname}:3001/ws/gemini-live`
        : `${protocol}//${window.location.host}/ws/gemini-live`
    );
    const ws = new WebSocket(host);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => callbacksRef.current.onLiveStatus?.(true);
    ws.onclose = () => {
      callbacksRef.current.onLiveStatus?.(false);
      if (!liveUnmountedRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => connectLive(), 1200);
      }
    };
    ws.onerror = () => callbacksRef.current.onLiveStatus?.(false);
    ws.onmessage = async (event) => {
      try {
        const payload = await parseLivePayload(event.data);
        if (payload.type === 'error') callbacksRef.current.onLiveStatus?.(false, payload.message);
        if (payload.type === 'search-results') {
          callbacksRef.current.onLiveToolResult?.('search', payload.payload);
          return;
        }
        handleLiveTranscripts(payload, callbacksRef.current, assistantAudioBlockUntilRef);
        playLiveAudio(payload, audioContextRef.current, livePlaybackTimeRef, activeSourceRef, liveSourcesRef, assistantAudioBlockUntilRef, {
          onStart: () => {
            speakingRef.current = true;
            callbacksRef.current.onSpeechEnd?.();
          },
          onEnd: () => {
            speakingRef.current = false;
          }
        });
      } catch (error) {
        console.warn('JARVIS Live frame decode failed:', error);
      }
    };

    return ws;
  }, []);

  useEffect(() => {
    liveUnmountedRef.current = false;
    const ws = connectLive();
    return () => {
      liveUnmountedRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      ws.close();
      if (wsRef.current && wsRef.current !== ws) wsRef.current.close();
    };
  }, [connectLive]);

  const cancelSpeech = useCallback(() => {
    window.speechSynthesis?.cancel();
    speakingRef.current = false;
    speechRunRef.current += 1;
    bargeInFramesRef.current = 0;
    assistantAudioBlockUntilRef.current = 0;
    livePlaybackTimeRef.current = audioContextRef.current?.currentTime || 0;
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch {
        // Already stopped.
      }
      activeSourceRef.current = null;
    }
    liveSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    });
    liveSourcesRef.current.clear();
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.src = '';
      activeAudioRef.current = null;
    }
  }, []);

  const playAudioBase64 = useCallback((base64, mimeType = 'audio/pcm;rate=24000') => {
    if (/audio\/mpeg|audio\/mp3/i.test(mimeType)) {
      return new Promise((resolve, reject) => {
        const audio = new Audio(`data:${mimeType};base64,${base64}`);
        activeAudioRef.current = audio;
        audio.onended = () => {
          if (activeAudioRef.current === audio) activeAudioRef.current = null;
          resolve();
        };
        audio.onerror = () => reject(new Error('Audio playback failed.'));
        audio.play().catch(reject);
      });
    }

    const audioContext = audioContextRef.current || new AudioContext();
    audioContextRef.current = audioContext;
    const rateMatch = mimeType.match(/rate=(\d+)/i);
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const samples = new Int16Array(bytes.buffer);
    const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) {
      channel[i] = samples[i] / 0x8000;
    }

    return new Promise((resolve) => {
      playbackSerialRef.current += 1;
      const source = audioContext.createBufferSource();
      activeSourceRef.current = source;
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        if (activeSourceRef.current === source) {
          activeSourceRef.current = null;
        }
        resolve();
      };
      source.start();
    });
  }, []);

  const beginMetering = useCallback(async () => {
    if (mediaStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = stream;
      const audioContext = new AudioContext();
      await audioContext.resume();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      analyser.fftSize = 256;
      source.connect(analyser);
      source.connect(processor);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      processorRef.current = processor;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      processor.onaudioprocess = (event) => {
        if (!LIVE_AUDIO_ENABLED) return;
        if (speakingRef.current || Date.now() < assistantAudioBlockUntilRef.current) return;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || intentionallyStoppedRef.current) return;
        const pcm = downsampleToPcm16(event.inputBuffer.getChannelData(0), audioContext.sampleRate, 16000);
        sentLiveFramesRef.current += 1;
        if (sentLiveFramesRef.current === 1) {
          console.info('JARVIS Live audio: sending microphone PCM frames.');
        }
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              mimeType: 'audio/pcm;rate=16000',
              data: arrayBufferToBase64(pcm.buffer)
            }
          }
        }));
      };

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const average = data.reduce((sum, value) => sum + value, 0) / data.length;
        const level = Math.min(1, average / 90);
        setAudioLevel(level);
        if (level > 0.18) {
          if (speakingRef.current && level > 0.55) {
            bargeInFramesRef.current += 1;
            if (bargeInFramesRef.current > 14) {
              callbacksRef.current.onSpeechStart?.();
              cancelSpeech();
            }
          } else if (!speakingRef.current) {
            bargeInFramesRef.current = 0;
            callbacksRef.current.onSpeechStart?.();
          }
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => callbacksRef.current.onSpeechEnd?.(), 1000);
        } else {
          bargeInFramesRef.current = 0;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setSupported(Boolean(SpeechRecognition));
    }
  }, [cancelSpeech]);

  const stopMetering = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    processorRef.current?.disconnect();
    processorRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setAudioLevel(0);
  }, []);

  const startListening = useCallback(() => {
    intentionallyStoppedRef.current = false;
    monitoringRef.current = true;
    setMonitoring(true);
    beginMetering();
    if (LIVE_AUDIO_ENABLED && !SpeechRecognition) {
      callbacksRef.current.onSpeechStart?.();
      return;
    }
    if (listeningRef.current || startingRef.current) return;
    startingRef.current = true;
    if (!SpeechRecognition) {
      setSupported(false);
      startingRef.current = false;
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = SPEECH_RECOGNITION_LANG;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      startingRef.current = false;
      listeningRef.current = true;
      setListening(true);
      callbacksRef.current.onSpeechStart?.();
    };
    recognition.onend = () => {
      startingRef.current = false;
      listeningRef.current = false;
      setListening(false);
      if (speakingRef.current || Date.now() < assistantAudioBlockUntilRef.current) {
        window.setTimeout(() => {
          if (monitoringRef.current && !intentionallyStoppedRef.current) startListening();
        }, 500);
        return;
      }
      if (intentionallyStoppedRef.current) {
        callbacksRef.current.onSpeechEnd?.();
        stopMetering();
        return;
      }
      window.setTimeout(() => startListening(), 250);
    };
    recognition.onerror = () => {
      startingRef.current = false;
      listeningRef.current = false;
      setListening(false);
      if (speakingRef.current || Date.now() < assistantAudioBlockUntilRef.current) {
        window.setTimeout(() => {
          if (monitoringRef.current && !intentionallyStoppedRef.current) startListening();
        }, 700);
        return;
      }
      if (!intentionallyStoppedRef.current) {
        window.setTimeout(() => startListening(), 600);
      } else {
        callbacksRef.current.onSpeechEnd?.();
      }
    };
    recognition.onresult = (event) => {
      let finalText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
      }
      const cleaned = finalText.trim();
      if (!cleaned) return;
      if (speakingRef.current || Date.now() < assistantAudioBlockUntilRef.current) return;

      const normalized = cleaned.replace(/^hey\s+jarvis[:,]?\s*/i, '');
      if (LIVE_AUDIO_ENABLED) {
        callbacksRef.current.onLiveTranscript?.('user', normalized);
        callbacksRef.current.onLiveFinalText?.(normalized);
        return;
      }
      callbacksRef.current.onFinalText?.(normalized);
    };

    try {
      recognition.start();
    } catch {
      startingRef.current = false;
    }
  }, [beginMetering, stopMetering]);

  const stopListening = useCallback(() => {
    intentionallyStoppedRef.current = true;
    monitoringRef.current = false;
    setMonitoring(false);
    recognitionRef.current?.stop();
    stopMetering();
    listeningRef.current = false;
    setListening(false);
    cancelSpeech();
  }, [cancelSpeech, stopMetering]);

  const sendLiveText = useCallback((text) => {
    if (!LIVE_AUDIO_ENABLED) return false;
    const cleaned = String(text || '').trim();
    const ws = wsRef.current;
    if (!cleaned || !ws || ws.readyState !== WebSocket.OPEN || intentionallyStoppedRef.current) return false;
    ws.send(JSON.stringify({
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: cleaned }]
          }
        ],
        turnComplete: true
      }
    }));
    return true;
  }, []);

  const speak = useCallback(async (text, { onStart, onEnd } = {}) => {
    if (LIVE_VOICE_MODE) {
      onEnd?.();
      return;
    }
    cancelSpeech();
    const runId = speechRunRef.current;
    speakingRef.current = true;
    try {
      recognitionRef.current?.abort?.();
    } catch {
      recognitionRef.current?.stop?.();
    }
    setListening(false);
    onStart?.();
    try {
      const chunks = chunkForSpeech(text);
      let nextJob = chunks.length ? fetchTtsChunk(chunks[0]) : null;
      for (let index = 0; index < chunks.length; index += 1) {
        if (!speakingRef.current || speechRunRef.current !== runId) break;
        const currentJob = nextJob;
        nextJob = index + 1 < chunks.length ? fetchTtsChunk(chunks[index + 1]) : null;
        const payload = await currentJob;
        if (!speakingRef.current || speechRunRef.current !== runId) break;
        await playAudioBase64(payload.data, payload.mimeType);
      }
    } catch (error) {
      console.warn('TTS unavailable:', error);
    } finally {
      speakingRef.current = false;
      activeSourceRef.current = null;
      onEnd?.();
      if (monitoringRef.current && !intentionallyStoppedRef.current) {
        window.setTimeout(() => startListening(), 250);
      }
    }
  }, [cancelSpeech, playAudioBase64, startListening]);

  const preloadSpeech = useCallback((phrases = []) => {
    if (LIVE_VOICE_MODE) return;
    phrases.forEach((phrase) => {
      const text = String(phrase || '').trim();
      if (!text || ttsCache.has(text)) return;
      fetchTtsChunk(text).catch((error) => {
        console.warn('Gemini TTS preload failed:', error);
      });
    });
  }, []);

  const createSpeechQueue = useCallback(({ onStart, onEnd } = {}) => {
    if (LIVE_VOICE_MODE) {
      return {
        enqueue: () => {},
        close: async () => onEnd?.(),
        cancel: () => {}
      };
    }
    cancelSpeech();
    const runId = speechRunRef.current;
    let closed = false;
    const pending = [];
    let draining = false;

    speakingRef.current = true;
    speechQueueRef.current = Promise.resolve();
    try {
      recognitionRef.current?.abort?.();
    } catch {
      recognitionRef.current?.stop?.();
    }
    setListening(false);
    onStart?.();

    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        let currentText = pending.shift() || null;
        let currentJob = currentText ? fetchTtsChunk(currentText) : null;

        while (currentJob && speakingRef.current && speechRunRef.current === runId) {
          try {
            const payload = await currentJob;
            if (!speakingRef.current || speechRunRef.current !== runId) break;

            const nextText = pending.shift();
            const nextJob = nextText ? fetchTtsChunk(nextText) : null;
            await playAudioBase64(payload.data, payload.mimeType);
            currentJob = nextJob;
          } catch (error) {
            console.warn('Gemini TTS chunk failed:', error);
            currentText = pending.shift() || null;
            currentJob = currentText ? fetchTtsChunk(currentText) : null;
          }
        }
      } finally {
        draining = false;
        if (pending.length && speakingRef.current && speechRunRef.current === runId) {
          speechQueueRef.current = speechQueueRef.current.then(drain);
        }
      }
    };

    return {
      enqueue: (text) => {
        const chunk = String(text || '').trim();
        if (!chunk || closed || !speakingRef.current || speechRunRef.current !== runId) return;
        pending.push(chunk);
        speechQueueRef.current = speechQueueRef.current
          .then(drain)
          .catch((error) => console.warn('Gemini TTS chunk failed:', error));
      },
      close: async () => {
        closed = true;
        await speechQueueRef.current;
        if (speechRunRef.current !== runId) return;
        speakingRef.current = false;
        activeSourceRef.current = null;
        onEnd?.();
        if (monitoringRef.current && !intentionallyStoppedRef.current) {
          window.setTimeout(() => startListening(), 250);
        }
      },
      cancel: cancelSpeech
    };
  }, [cancelSpeech, playAudioBase64, startListening]);

  return {
    supported,
    listening,
    monitoring,
    audioLevel,
    startListening,
    stopListening,
    sendLiveText,
    speak,
    createSpeechQueue,
    preloadSpeech
  };
}

async function fetchTtsChunk(text) {
  const key = text.trim();
  if (Date.now() < ttsDisabledUntil) {
    throw new Error('Gemini TTS quota is cooling down.');
  }
  if (ttsCache.has(key)) return ttsCache.get(key);
  const job = requestTtsWithRetry(key);
  ttsCache.set(key, job);
  return job;
}

async function requestTtsWithRetry(text) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${API_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload.error || 'Gemini TTS failed');
        error.status = response.status;
        error.quotaExhausted = payload.quotaExhausted || response.status === 429;
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (error.quotaExhausted || error.status === 429) {
        ttsDisabledUntil = Date.now() + 60 * 60 * 1000;
        break;
      }
      await wait(350 + attempt * 500);
    }
  }
  ttsCache.delete(text);
  throw lastError;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function chunkForSpeech(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const sentences = cleaned.match(/[^.!?;:]+[.!?;:]?/g) || [cleaned];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const next = `${current} ${sentence}`.trim();
    if (next.length > 180 && current) {
      chunks.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function downsampleToPcm16(input, inputRate, outputRate) {
  if (outputRate === inputRate) return floatToPcm16(input);
  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    output[i] = input[Math.floor(i * ratio)];
  }
  return floatToPcm16(output);
}

function floatToPcm16(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function parseLivePayload(data) {
  if (typeof data === 'string') return JSON.parse(data);
  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(data));
  }
  if (data instanceof Blob) {
    return JSON.parse(await data.text());
  }
  throw new Error(`Unsupported Live frame type: ${Object.prototype.toString.call(data)}`);
}

function handleLiveTranscripts(payload, callbacks = {}, assistantAudioBlockUntilRef = null) {
  const server = payload.serverContent || payload.server_content || {};
  const input = server.inputTranscription || server.input_transcription || payload.inputTranscription || payload.input_transcription;
  const output = server.outputTranscription || server.output_transcription || payload.outputTranscription || payload.output_transcription;

  const inputText = cleanEnglishTranscript(input?.text);
  const outputText = cleanEnglishTranscript(output?.text);

  if (inputText && Date.now() >= (assistantAudioBlockUntilRef?.current || 0)) {
    callbacks.onLiveTranscript?.('user', inputText);
  }
  if (outputText) callbacks.onLiveTranscript?.('assistant', outputText);
}

function cleanEnglishTranscript(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const letters = cleaned.match(/\p{L}/gu) || [];
  if (!letters.length) return cleaned;

  const latinLetters = cleaned.match(/\p{Script=Latin}/gu) || [];
  const latinRatio = latinLetters.length / letters.length;
  if (latinRatio < 0.8) return '';

  return cleaned;
}

function playLiveAudio(payload, audioContext, livePlaybackTimeRef, activeSourceRef, liveSourcesRef, assistantAudioBlockUntilRef, callbacks = {}) {
  if (!audioContext) return;
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  const parts = payload?.serverContent?.modelTurn?.parts || payload?.serverContent?.modelTurn?.content?.parts || [];
  let started = false;

  parts.forEach((part) => {
    const inline = part.inlineData || part.inline_data;
    const mimeType = inline?.mimeType || inline?.mime_type || '';
    if (!inline?.data || !/audio\/pcm/i.test(mimeType)) return;
    const bytes = Uint8Array.from(atob(inline.data), (char) => char.charCodeAt(0));
    const samples = new Int16Array(bytes.buffer);
    const rateMatch = mimeType.match(/rate=(\d+)/i);
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) {
      channel[i] = samples[i] / 0x8000;
    }
    const source = audioContext.createBufferSource();
    activeSourceRef.current = source;
    liveSourcesRef.current.add(source);
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      liveSourcesRef.current.delete(source);
      if (activeSourceRef.current === source) activeSourceRef.current = null;
      if (audioContext.currentTime >= livePlaybackTimeRef.current - 0.05) callbacks.onEnd?.();
    };

    const startAt = Math.max(audioContext.currentTime + 0.02, livePlaybackTimeRef.current || 0);
    livePlaybackTimeRef.current = startAt + buffer.duration;
    const remainingPlaybackMs = Math.max(0, (livePlaybackTimeRef.current - audioContext.currentTime) * 1000);
    assistantAudioBlockUntilRef.current = Math.max(
      assistantAudioBlockUntilRef.current,
      Date.now() + remainingPlaybackMs + 900
    );
    if (!started) {
      callbacks.onStart?.();
      started = true;
    }
    source.start(startAt);
  });
}
