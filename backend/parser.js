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

export async function parseCommand(rawText, options = {}, timeoutMs = Number(process.env.GEMINI_INTENT_TIMEOUT_MS || 1800)) {
  if (!process.env.GEMINI_API_KEY) return null;
  const text = String(rawText || '').trim();
  if (!text) return null;
  if (typeof options === 'number') {
    timeoutMs = options;
    options = {};
  }
  const context = normalizeBrainContext(options);

  const controller = new AbortController();
  const timeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 1800;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    for (const model of getParserModels()) {
      const result = await parseWithModel(model, text, controller.signal, context);
      if (result) return result;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function parseWithModel(model, text, signal, context) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildParserSystemPrompt(context) }]
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

function normalizeBrainContext(options = {}) {
  const devices = Array.isArray(options.devices) ? options.devices : [];
  const favorites = Array.isArray(options.favorites) ? options.favorites : [];
  return {
    devices: devices.map((device, index) => ({
      index: index + 1,
      name: String(device.name || '').trim(),
      status: String(device.status || '').trim(),
      isDefault: Boolean(device.is_default),
      online: Boolean(device.online),
      agentVersion: String(device.metadata?.agentVersion || '').trim()
    })).filter((device) => device.name),
    favorites: favorites.map((track, index) => ({
      index: index + 1,
      title: String(track.title || '').trim(),
      url: String(track.url || '').trim()
    })).filter((track) => track.title || track.url)
  };
}

function getParserModels() {
  const models = [
    process.env.GEMINI_INTENT_MODEL,
    'gemini-2.5-flash-lite',
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
  const text = parts.filter(Boolean).join(' ')
    .toLowerCase()
    .replace(/\bfa\s*vorite\b/gi, 'favorite')
    .replace(/\bfav\s*orite\b/gi, 'favorite');
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

function buildParserSystemPrompt(context = {}) {
  const devices = context.devices?.length
    ? JSON.stringify(context.devices)
    : '[]';
  const favorites = context.favorites?.length
    ? JSON.stringify(context.favorites)
    : '[]';

  return `You are the command brain for a voice assistant called JARVIS.
The user speaks English, Uzbek, and Russian.
Speech recognition may fragment words with extra spaces or broken syllables.
You must understand the full sentence, not isolated keywords.
You know exactly what JARVIS can execute, which computers exist, and which favorite tracks are saved.
Return structured JSON only. No explanation, no markdown, no preamble.

Executable capabilities:
${formatCapabilitiesForPrompt()}

Approved/known devices:
${devices}

Favorite music saved in Settings:
${favorites}

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
Do not convert casual statements into commands. If the user merely mentions YouTube, Google, an app, a computer, or a favorite song without asking JARVIS to do something, return action "none".
Only return executable actions when the user asks to open, close, play, pause, search, remember, create, delete, check, set, mute, list, or otherwise control something.
Think first:
1. Is this an instruction/request, or just conversation?
2. If it is a request, which capability does it match?
3. What is the action?
4. What is the target app/site/media/favorite?
5. What is the target device or devices?
6. What content should be searched, if any?
Never infer an executable command from keywords alone.
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
If the user says "play my favorite song on my second computer", set favoritesPlay true, searchQuery null, devices ["my second computer"] or the exact matching device name from the known devices list.
If the user says "my favorite song is nice" or "YouTube is good for videos", return action "none".
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
When the user mentions a named device, preserve the display name from the known devices list whenever possible.
Repair fragmented words silently. Do not mention the repair.
Respond in JSON only. No other text.`;
}
import { formatCapabilitiesForPrompt } from './capabilities.js';
