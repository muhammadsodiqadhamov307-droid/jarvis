const ACTIONS = new Set([
  'open',
  'play',
  'search',
  'close',
  'media',
  'remember',
  'forget',
  'notes',
  'time',
  'calculate',
  'weather',
  'news',
  'status',
  'none'
]);

const APPS = new Set([
  'youtube',
  'google',
  'telegram',
  'chrome',
  'spotify',
  'vscode',
  'notepad',
  'explorer',
  'calculator',
  'word',
  'excel',
  'obs',
  'null'
]);

const LANGUAGES = new Set(['en', 'uz', 'ru']);

export async function parseCommand(rawText, timeoutMs = Number(process.env.GEMINI_INTENT_TIMEOUT_MS || 1800)) {
  if (!process.env.GEMINI_API_KEY) return null;
  const text = String(rawText || '').trim();
  if (!text) return null;

  const model = process.env.GEMINI_INTENT_MODEL || 'gemini-flash-lite-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const controller = new AbortController();
  const timeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 1800;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: PARSER_SYSTEM_PROMPT }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text }]
          }
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 350,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!raw) return null;
    return normalizeParsedCommand(JSON.parse(cleanJson(raw)));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function cleanJson(raw) {
  return String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function normalizeParsedCommand(value) {
  if (!value || typeof value !== 'object') return null;
  const rawAction = String(value.action || '').trim().toLowerCase();
  const action = ACTIONS.has(rawAction) ? rawAction : 'none';
  const rawApp = String(value.appOrSite ?? 'null').trim().toLowerCase();
  const appOrSite = APPS.has(rawApp) && rawApp !== 'null' ? rawApp : null;
  const devices = Array.isArray(value.devices) ? value.devices : ['default'];
  const rawLanguage = String(value.language || '').trim().toLowerCase();
  const language = LANGUAGES.has(rawLanguage) ? rawLanguage : 'en';

  return {
    action,
    appOrSite,
    searchQuery: cleanNullable(value.searchQuery),
    devices: devices.map((device) => String(device || '').trim()).filter(Boolean).length
      ? devices.map((device) => String(device || '').trim()).filter(Boolean)
      : ['default'],
    language,
    rawIntent: String(value.rawIntent || '').trim()
  };
}

function cleanNullable(value) {
  const text = String(value ?? '').trim();
  if (!text || /^null$/i.test(text)) return null;
  return text;
}

const PARSER_SYSTEM_PROMPT = `You are a command parser for a voice assistant called JARVIS.
The user speaks English, Uzbek, and Russian.
Speech recognition may fragment words with extra spaces or broken syllables.
You must repair fragmented words, understand the meaning, and return
structured JSON only. No explanation, no markdown, no preamble.
Return exactly this JSON shape:
{
"action": "open | play | search | close | media | remember | forget | notes | time | calculate | weather | news | status | none",
"appOrSite": "youtube | google | telegram | chrome | spotify | vscode | notepad | explorer | calculator | word | excel | obs | null",
"searchQuery": "cleaned search content only - no app names, no device names, no action words, no filler | null",
"devices": ["my computer" | "computer 1" | "computer 2" | "both" | "all" | "default"],
"language": "en | uz | ru",
"rawIntent": "one sentence describing what the user wants in English"
}
Rules:

searchQuery must contain ONLY the content to search for.
Never include: app names, device names, ordinal words,
action verbs, filler words, or language artifacts.
If the user says "open YouTube" with nothing to search,
searchQuery must be null.
If the user says "play Kapalagim by Mashxurbek Yuldashev on YouTube",
searchQuery must be "Mashxurbek Yuldashev Kapalagim".
If the user says "google weather in Uzbekistan",
searchQuery must be "weather in Uzbekistan".
devices must always be an array. Default to ["default"] if no
device is mentioned.
Repair fragmented words silently. Do not mention the repair.
Respond in JSON only. No other text.`;
