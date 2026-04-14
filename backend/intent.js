const INTENT_TYPES = new Set(['desktop', 'web_search', 'device_status', 'none']);

export async function classifyIntent(message, { devices = [], address = 'Sir' } = {}) {
  if (!process.env.GEMINI_API_KEY) return null;
  const text = String(message || '').trim();
  if (!text) return null;

  const prompt = buildIntentPrompt(text, devices, address);

  for (const model of getIntentModels()) {
    try {
      const result = await classifyWithModel(model, prompt);
      if (result) return result;
    } catch (error) {
      console.warn(`Intent classifier unavailable on ${model}: ${error.message}`);
    }
  }

  return null;
}

async function classifyWithModel(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const controller = new AbortController();
  const timeoutMs = Number(process.env.GEMINI_INTENT_TIMEOUT_MS || 1800);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 350,
        responseMimeType: 'application/json'
      }
    })
  }).finally(() => clearTimeout(timer));

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`request failed: ${response.status}${detail ? ` ${detail.slice(0, 180)}` : ''}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!raw) return null;
  try {
    return normalizeIntent(JSON.parse(cleanJson(raw)));
  } catch (error) {
    console.warn(`Intent classifier returned invalid JSON: ${error.message}`);
    return null;
  }
}

function getIntentModels() {
  const configured = [
    process.env.GEMINI_INTENT_MODEL,
    'gemini-flash-lite-latest',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite',
    process.env.GEMINI_TEXT_MODEL,
    ...(process.env.GEMINI_INTENT_FALLBACK_MODELS || '').split(','),
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.0-flash'
  ];
  return [...new Set(configured.map((model) => String(model || '').trim()).filter(Boolean))];
}

function cleanJson(raw) {
  return String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function buildIntentPrompt(message, devices, address) {
  const deviceSummary = devices.map((device) => ({
    name: device.name,
    status: device.status,
    isDefault: Boolean(device.is_default)
  }));

  return `You are the intent parser for a JARVIS computer-control assistant.
Return ONLY compact JSON. Do not answer the user.

The user may speak English, Uzbek Latin, Uzbek Cyrillic, or Russian.
The input may be a broken speech transcript with split words, missing letters, filler words, or misheard pieces.
Examples:
- "o pen Te legram on de fault de vice" means "open telegram on default device"
- "pen telegram" can mean "open telegram"
- "I need Telegram" / "I want Telegram" / "bring Telegram up" means "open telegram"
- "I need to message someone" / "I want to text someone" means "open telegram"
- "telegramni och" means "open telegram"
- "открой телеграм" means "open telegram"
- "xabar yoz" / "напиши сообщение" means open Telegram for messaging
- "musiqa qo'y" / "включи музыку" means play music on YouTube
- "la test news uh AI right now" means latest AI news

Classify into one of:
- desktop: open/close/control apps, websites, music/media, messaging, volume, local computer actions
- web_search: latest/current/weather/news/search/look up/realtime questions
- device_status: asking what computers/devices are connected, online, available, reachable, registered, default, or active
- none: normal conversation, memory/notes/calculator/reminders, unclear non-action

Important:
- Infer intent from meaning, not just exact words.
- Preserve the action exactly. If the user says open, keep open. If the user says close, keep close. If the user says play, do not turn that into close or search.
- If the user says they need or want an app/site/tool, classify as desktop and normalize to "open <target>".
- If the user wants to message/text/chat/contact someone and does not name another messaging app, normalize to "open telegram".
- If the user asks for fresh/current/latest information, classify as web_search even when the speech transcript is messy.
- If the user asks what devices are connected or whether a computer is online, classify as device_status.
- If the user asks for the name of their computer or device, classify as device_status.
- Use the current device display name from the "name" field when choosing or naming a device. Do not prefer hostnames over display names.
- If the user names a target app or site after an open/close/play verb, keep that target in normalizedText.
- If the user says "close YouTube on my second computer", normalizedText should stay close-oriented and target "my second computer".
- If the user asks to search for weather/news/latest/current information, do not rewrite that as a desktop command.
- For desktop YouTube or Google commands, keep normalizedText executable, but keep query as content only.
- For "open YouTube" or "open Google" with no extra content, query must be empty.
- For YouTube or Google search commands, query must not include youtube, google, open, play, look for, search, find, show, device names, or device phrases such as "on my computer".
- Examples: "play JARVIS videos on YouTube" -> type desktop, normalizedText "play JARVIS videos on YouTube", query "JARVIS videos".
- Examples: "open YouTube on computer 1" -> type desktop, normalizedText "open YouTube on computer 1", query "", targetDevice "computer 1".
- Examples: "google weather information in Uzbekistan on my second computer" -> type desktop, normalizedText "google weather in Uzbekistan on my second computer", query "weather in Uzbekistan", targetDevice "my second computer".

Return this JSON shape:
{
  "type": "desktop" | "web_search" | "device_status" | "none",
  "confidence": 0.0,
  "normalizedText": "English command or question for JARVIS controller",
  "query": "search query if web_search, otherwise empty",
  "targetDevice": "device name if explicitly mentioned, otherwise default or empty"
}

Known devices: ${JSON.stringify(deviceSummary)}
Address: ${address}
User input: ${JSON.stringify(message)}`;
}

function normalizeIntent(value) {
  if (!value || typeof value !== 'object') return null;
  const type = INTENT_TYPES.has(value.type) ? value.type : 'none';
  const confidence = Math.max(0, Math.min(1, Number(value.confidence || 0)));
  const query = type === 'desktop' ? cleanDesktopIntentQuery(value.query) : String(value.query || '').trim();
  return {
    type,
    confidence,
    normalizedText: String(value.normalizedText || '').trim(),
    query,
    targetDevice: String(value.targetDevice || '').trim()
  };
}

function cleanDesktopIntentQuery(query) {
  let value = String(query || '')
    .replace(/\b(search the web for|search for|find me|look for|show me)\b/gi, ' ')
    .replace(/\b(open|play|put on|search|find|show|watch|google|youtube|you tube)\b/gi, ' ')
    .replace(/\b(?:on|in|at|for)\s+(?:my\s+)?(?:default\s+)?(?:first|second|third|fourth|fifth|another)?\s*(?:computer|pc|laptop|desktop|device)\s*(?:\d+|one|two|three|four|five)?\b/gi, ' ')
    .replace(/\b(?:on|in|at|for)\s+[\p{L}\p{N}\s-]{1,30}\s+(?:computer|pc|laptop|desktop|device)\b/giu, ' ')
    .replace(/\bweather information\b/gi, 'weather')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(youtube|you tube|google)$/i.test(value)) return '';
  return value;
}
