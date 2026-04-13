import WebSocket, { WebSocketServer } from 'ws';
import { buildSystemPrompt } from './memory.js';

const DEFAULT_LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export function attachGeminiLiveProxy(server) {
  const wss = new WebSocketServer({ server, path: '/ws/gemini-live' });

  wss.on('connection', (client) => {
    if (!process.env.GEMINI_API_KEY) {
      client.send(JSON.stringify({ type: 'error', message: 'GEMINI_API_KEY is not configured. Text mode remains available.' }));
      client.close(1011, 'Missing Gemini API key');
      return;
    }

    const model = process.env.GEMINI_LIVE_MODEL || 'gemini-live-2.5-flash-native-audio';
    const baseUrl = process.env.GEMINI_LIVE_WS_URL || DEFAULT_LIVE_WS_URL;
    const separator = baseUrl.includes('?') ? '&' : '?';
    const upstreamUrl = `${baseUrl}${separator}key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const upstream = new WebSocket(upstreamUrl);
    let configured = false;
    let setupComplete = false;
    const pendingClientMessages = [];
    let clientAudioFrames = 0;
    let clientMessages = 0;
    let liveAudioFrames = 0;

    upstream.on('open', async () => {
      try {
        configured = true;
        const systemPrompt = await buildLiveSystemPrompt(process.env.DEFAULT_ADDRESS || 'Sir');
        upstream.send(JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              temperature: 0.7,
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: process.env.GEMINI_VOICE || 'Kore'
                  }
                }
              }
            },
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: true,
                silenceDurationMs: Number(process.env.GEMINI_LIVE_SILENCE_MS || 1200)
              }
            }
          }
        }));
        console.log(`Gemini Live upstream connected with model ${model}`);
        client.send(JSON.stringify({ type: 'live-ready', model }));
      } catch (error) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'error', message: error.message }));
        }
        upstream.close(1011, error.message);
      }
    });

    client.on('message', (message) => {
      clientMessages += 1;
      if (clientMessages === 1 || clientMessages % 100 === 0) {
        console.log(`Browser messages received by Live proxy: ${clientMessages}`);
      }
      if (upstream.readyState === WebSocket.OPEN && setupComplete) {
        logClientAudioFrame(message);
        upstream.send(message);
      } else if (upstream.readyState === WebSocket.OPEN) {
        pendingClientMessages.push(message);
      } else if (!configured) {
        client.send(JSON.stringify({ type: 'status', message: 'Connecting to Gemini Live.' }));
      }
    });

    upstream.on('message', (message) => {
      const text = message.toString();
      try {
        const payload = JSON.parse(text);
        const keys = Object.keys(payload);
        if (!payload.serverContent && !payload.setupComplete && !payload.error) {
          console.log(`Gemini Live message keys: ${keys.join(', ')}`);
        }
        if (payload.error) console.warn('Gemini Live error:', JSON.stringify(payload.error));
        const inputTranscript = payload.serverContent?.inputTranscription?.text;
        const outputTranscript = payload.serverContent?.outputTranscription?.text;
        if (inputTranscript) console.log(`Gemini Live heard: ${inputTranscript}`);
        if (outputTranscript) console.log(`Gemini Live said: ${outputTranscript}`);
        const parts = payload.serverContent?.modelTurn?.parts || payload.serverContent?.modelTurn?.content?.parts || [];
        if (parts.some((part) => part.inlineData || part.inline_data)) {
          liveAudioFrames += 1;
          if (liveAudioFrames === 1 || liveAudioFrames % 25 === 0) {
            console.log(`Gemini Live audio frames received: ${liveAudioFrames}`);
          }
        }
        if (payload.setupComplete || payload.setup_complete) {
          setupComplete = true;
          console.log('Gemini Live setup complete');
          while (pendingClientMessages.length) {
            const pending = pendingClientMessages.shift();
            logClientAudioFrame(pending);
            upstream.send(pending);
          }
        }
      } catch {
        // Upstream frames may not always be JSON.
      }
      if (client.readyState === WebSocket.OPEN) client.send(text);
    });

    upstream.on('error', (error) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'error', message: error.message }));
      }
    });

    upstream.on('close', (code, reason) => {
      console.warn(`Gemini Live upstream closed: ${code} ${reason.toString()}`);
      if (client.readyState === WebSocket.OPEN) client.close(code, reason.toString());
    });

    client.on('close', () => {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
    });

    function logClientAudioFrame(message) {
      try {
        const payload = JSON.parse(message.toString());
        if (payload.realtimeInput?.audio || payload.realtimeInput?.mediaChunks) {
          clientAudioFrames += 1;
          if (clientAudioFrames === 1 || clientAudioFrames % 100 === 0) {
            console.log(`Browser audio frames forwarded to Gemini Live: ${clientAudioFrames}`);
          }
        }
      } catch {
        // Ignore non-JSON messages.
      }
    }
  });
}

async function buildLiveSystemPrompt(address) {
  return `${await buildSystemPrompt(address)}

Live voice policy:
- The user may speak English, Uzbek, or Russian. Listen for all three naturally.
- Reply in the same language the user used most recently: English to English, Uzbek to Uzbek, Russian to Russian.
- Uzbek may arrive in Latin script or Cyrillic script. Preserve the user's style when practical.
- Russian should be answered in natural Russian Cyrillic.
- If the user's language is mixed, answer in the language that carries the main request.
- If the phrase is unclear, ask for clarification in the same likely language.
- Keep the JARVIS personality in every language: formal, precise, loyal, subtly witty, and concise.
- Do not claim that you opened, closed, launched, played, paused, checked, detected, or controlled local computer apps or linked devices. A separate local device controller handles those actions and will confirm them.
- If the user asks to open, close, launch, play, pause, control, check, list, detect, or inspect a computer/device, give only a brief acknowledgement such as "Checking the device controller, ${address}." The verified controller result may be injected immediately afterwards.
- For weather, news, latest, current, search, online, or internet questions, do not guess from memory. Briefly acknowledge that you are checking; a separate verified web-search response may be provided.
- Short greetings such as "Jarvis", "hi Jarvis", "salom Jarvis", and "privet Jarvis" are valid commands and should receive a brief acknowledgement.
- Address the user as "${address}" unless the user asks for a different address.`;
}

export async function geminiText(prompt, address = 'Sir') {
  if (!process.env.GEMINI_API_KEY) return null;
  const model = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const systemPrompt = await buildSystemPrompt(address, prompt);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 800
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini text request failed: ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || null;
}

export async function geminiRepairTranscript(transcript) {
  if (!process.env.GEMINI_API_KEY) return String(transcript || '').trim();
  const input = String(transcript || '').trim();
  if (!input) return input;

  const model = process.env.GEMINI_REPAIR_MODEL || process.env.GEMINI_INTENT_MODEL || 'gemini-flash-lite-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{
            text: [
              'Repair this speech transcript.',
              'Fix accidental spaces split inside words, light ASR breakage, mistaken spacing inside names, and obvious letter fragmentation across the whole sentence.',
              'Preserve the user intent exactly. Never flip open into close, close into open, play into stop, or change the target device.',
              'Do not add new intent, new facts, or extra commentary.',
              'Keep the same language as the user.',
              'If a device name is partially broken, repair it as naturally as possible.',
              'Examples:',
              '- "pla y musi c on se cond com puter" -> "play music on second computer"',
              '- "clo se YouTube on my sec ond comp uter" -> "close YouTube on my second computer"',
              '- "o pen te le gram on my se cond com puter" -> "open telegram on my second computer"',
              '- "ik kinchi kom pyut erda YouTube ni yopib qo y" -> "ikkinchi kompyuterda YouTube ni yopib qo y"',
              '- "ob ha vo ma lu moti ni o zbe kis tonda top" -> "ob havo malumotini ozbekistonda top"',
              '- "от крой те ле грам на вто ром ком пью те ре" -> "открой телеграм на втором компьютере"',
              '- "за крой ю туб на вто ром ком пью те ре" -> "закрой ютуб на втором компьютере"',
              'Return only the corrected sentence, with no quotes or explanation.',
              `Transcript: ${JSON.stringify(input)}`
            ].join('\n')
          }]
        }
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 120
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini repair request failed: ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || input;
}

export async function* geminiTextStream(prompt, address = 'Sir') {
  if (!process.env.GEMINI_API_KEY) return;
  const model = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const systemPrompt = await buildSystemPrompt(address, prompt);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.65,
        maxOutputTokens: 500
      }
    })
  });

  if (!response.ok || !response.body) throw new Error(`Gemini stream request failed: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventLines = [];

  const parseEvent = function* (lines) {
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s*/, ''))
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') return;
    const json = JSON.parse(data);
    const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
    if (text) yield text;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? '' : lines.pop() || '';

    for (const line of lines) {
      if (line.trim() === '') {
        if (eventLines.length) {
          yield* parseEvent(eventLines);
          eventLines = [];
        }
      } else {
        eventLines.push(line);
      }
    }

    if (done) break;
  }

  if (buffer.trim()) eventLines.push(buffer);
  if (eventLines.length) {
    yield* parseEvent(eventLines);
  }
}

export async function geminiTts(text) {
  if (!process.env.GEMINI_API_KEY) return null;
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
  const voiceName = process.env.GEMINI_VOICE || 'Puck';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `Read this as JARVIS in polished British English with a refined British accent: calm, precise, natural, quietly witty, formal, and not robotic. Keep the delivery crisp and confident. ${text}`
            }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName
            }
          }
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`Gemini TTS request failed: ${response.status}${body ? ` ${body.slice(0, 500)}` : ''}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  const data = await response.json();
  const inline = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
  if (!inline?.data) throw new Error('Gemini TTS returned no audio.');
  return {
    data: inline.data,
    mimeType: inline.mimeType || 'audio/pcm;rate=24000',
    voiceName,
    model
  };
}
