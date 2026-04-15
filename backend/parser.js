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
  'volume',
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

  const controller = new AbortController();
  const timeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 1800;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    for (const model of getParserModels()) {
      const result = await parseWithModel(model, text, controller.signal);
      if (result) return result;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function parseWithModel(model, text, signal) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
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
          maxOutputTokens: 700,
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
  }
}

function getParserModels() {
  const models = [
    process.env.GEMINI_INTENT_MODEL,
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2-flash',
    'gemini-2.5-flash',
    process.env.GEMINI_TEXT_MODEL,
    ...(process.env.GEMINI_INTENT_FALLBACK_MODELS || '').split(',')
  ];
  return [...new Set(models.map((model) => String(model || '').trim()).filter(Boolean))];
}

function cleanJson(raw) {
  return String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function normalizeParsedCommand(value) {
  if (!value || typeof value !== 'object') return null;
  const rawTasks = Array.isArray(value.tasks) && value.tasks.length ? value.tasks : [value];
  const language = normalizeLanguage(value.language);
  const tasks = rawTasks
    .map((task) => normalizeTask(task, language))
    .filter(Boolean);

  if (!tasks.length) return null;
  const first = tasks[0];
  return {
    ...first,
    tasks,
    language,
    rawIntent: String(value.rawIntent || first.rawIntent || '').trim()
  };
}

function normalizeTask(value, language = 'en') {
  if (!value || typeof value !== 'object') return null;
  const rawAction = String(value.action || '').trim().toLowerCase();
  const action = ACTIONS.has(rawAction) ? rawAction : 'none';
  const rawApp = String(value.appOrSite ?? 'null').trim().toLowerCase();
  const appOrSite = APPS.has(rawApp) && rawApp !== 'null' ? rawApp : null;
  const devices = Array.isArray(value.devices) ? value.devices : ['default'];
  const rawIntent = String(value.rawIntent || '').trim();
  const searchQuery = sanitizeSearchQuery(cleanNullable(value.searchQuery), appOrSite, action);

  return {
    action,
    appOrSite,
    searchQuery,
    devices: devices.map((device) => String(device || '').trim()).filter(Boolean).length
      ? devices.map((device) => String(device || '').trim()).filter(Boolean)
      : ['default'],
    language,
    rawIntent,
    favoritesPlay: Boolean(value.favoritesPlay) || looksLikeFavoriteRequest(rawIntent, searchQuery),
    volume: normalizeVolume(value.volume)
  };
}

function normalizeLanguage(value) {
  const rawLanguage = String(value || '').trim().toLowerCase();
  return LANGUAGES.has(rawLanguage) ? rawLanguage : 'en';
}

function normalizeVolume(value) {
  if (!value || typeof value !== 'object') return null;
  const action = String(value.action || '').trim().toLowerCase();
  const allowed = new Set(['set', 'up', 'down', 'mute', 'unmute', 'max']);
  if (!allowed.has(action)) return null;
  const level = Number(value.level);
  return {
    action,
    level: action === 'set'
      ? Math.max(0, Math.min(100, Number.isFinite(level) ? Math.round(level) : 50))
      : undefined
  };
}

function looksLikeFavoriteRequest(...parts) {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  return /\b(favou?rite|next favorite|saved song|saved track)\b/i.test(text)
    || /\bsevimli\b/i.test(text)
    || /\b(любим|избранн)\b/i.test(text);
}

function cleanNullable(value) {
  const text = String(value ?? '').trim();
  if (!text || /^null$/i.test(text)) return null;
  return text;
}

function sanitizeSearchQuery(query, appOrSite, action) {
  let value = String(query || '')
    .replace(/\b(?:on|in|at|for)\s+(?:both\s+(?:of\s+the\s+)?|all\s+(?:of\s+the\s+)?)(?:computers?|pcs?|laptops?|desktops?|devices?)\b/giu, ' ')
    .replace(/\b(?:both\s+(?:of\s+the\s+)?|all\s+(?:of\s+the\s+)?)(?:computers?|pcs?|laptops?|desktops?|devices?)\b/giu, ' ')
    .replace(/\b(?:on|in|at|for)\s+(?:my\s+)?(?:computer|pc|laptop|desktop|device)s?\s*(?:\d+|one|two|three|four|five)?\b/giu, ' ')
    .replace(/\b(?:on|in|at|for)\s+(?:my\s+)?(?:default\s+)?(?:first|second|third|fourth|fifth|another)\s+(?:computer|pc|laptop|desktop|device)s?\b/giu, ' ')
    .replace(/\b(?:on|in|at|for)\s+[\p{L}\p{N}\s-]{1,30}\s+(?:computer|pc|laptop|desktop|device)s?\b/giu, ' ')
    .replace(/\b(?:youtube|you tube|google)\b/giu, ' ')
    .replace(/\b(?:open|play|put on|search|find|show|watch|look for|google|youtube)\b/giu, ' ')
    .replace(/\bweather information\b/giu, 'weather')
    .replace(/\s+/g, ' ')
    .trim();

  if (isDeviceOnlyQuery(value)) value = '';
  if (!value && action === 'open' && (appOrSite === 'youtube' || appOrSite === 'google')) return null;
  return value || null;
}

function isDeviceOnlyQuery(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  return /^(?:on|in|at|for|my|the|both|all|of|default|first|second|third|fourth|fifth|computer|computers|pc|pcs|laptop|laptops|desktop|desktops|device|devices|\d+|one|two|three|four|five|\s)+$/iu.test(normalized);
}

const PARSER_SYSTEM_PROMPT = `You are a command parser for a voice assistant called JARVIS.
The user speaks English, Uzbek, and Russian.
Speech recognition may fragment words with extra spaces or broken syllables.
You must repair fragmented words, understand the meaning, and return
structured JSON only. No explanation, no markdown, no preamble.
Always return exactly this JSON shape:
{
"tasks": [
  {
    "action": "open | play | search | close | media | remember | forget | notes | time | calculate | weather | news | volume | status | none",
    "appOrSite": "youtube | google | telegram | chrome | spotify | vscode | notepad | explorer | calculator | word | excel | obs | null",
    "searchQuery": "cleaned search content only - no app names, no device names, no action words, no filler | null",
    "devices": ["my computer" | "computer 1" | "computer 2" | "both" | "all" | "default"],
    "favoritesPlay": false,
    "volume": { "action": "set | up | down | mute | unmute | max", "level": 50 },
    "rawIntent": "one sentence describing this task in English"
  }
],
"language": "en | uz | ru"
}
Rules:

Always return a "tasks" array. Even if there is only one task, wrap it in the array.
Split compound commands into separate task objects.
Each task must be fully self-contained with its own action, appOrSite, searchQuery, devices, favoritesPlay, volume, and rawIntent.
searchQuery must contain ONLY the content to search for.
Never include: app names, device names, ordinal words,
action verbs, filler words, or language artifacts.
If the user says "open YouTube" with nothing to search,
searchQuery must be null.
If the user says "play Kapalagim by Mashxurbek Yuldashev on YouTube",
searchQuery must be "Mashxurbek Yuldashev Kapalagim".
If the user says "google weather in Uzbekistan",
searchQuery must be "weather in Uzbekistan".
If the user says "play my favorite music", set favoritesPlay true and searchQuery null.
If the user says "play my favorite song and set volume to max on computer 1",
return two tasks: a play task with favoritesPlay true and a volume task with volume.action "max".
If the user says "open Telegram on computer 1 and close YouTube on computer 2",
return two tasks with their own devices.
If the user says "mute computer 2, play music on computer 1, and open Telegram on computer 1",
return three tasks.
For volume: "volume up" means action "volume" and volume.action "up";
"volume down" -> "down"; "mute" -> "mute"; "unmute" -> "unmute";
"set volume to max" -> "max"; "set volume to 50" -> "set" with level 50.
Uzbek volume examples: "ovozni oshir" -> up; "ovozni tushir" -> down;
"ovozni o'chir" -> mute; "ovozni yoq" -> unmute; "ovozni maksimumga qo'y" -> max.
Russian volume examples: "громче" -> up; "тише" -> down; "выключи звук" -> mute.
devices must always be an array. Default to ["default"] if no
device is mentioned.
Repair fragmented words silently. Do not mention the repair.
Respond in JSON only. No other text.`;
