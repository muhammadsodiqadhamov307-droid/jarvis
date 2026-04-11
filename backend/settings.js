import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

const SETTINGS_SCHEMA = [
  {
    section: 'Identity',
    fields: [
      { key: 'DEFAULT_ADDRESS', label: 'Preferred address', defaultValue: 'Sir' },
      { key: 'USER_TIMEZONE', label: 'Time zone', defaultValue: 'Asia/Tashkent' }
    ]
  },
  {
    section: 'Gemini',
    fields: [
      { key: 'GEMINI_API_KEY', label: 'Gemini API key', secret: true },
      { key: 'GEMINI_TEXT_MODEL', label: 'Text model', defaultValue: 'gemini-2.5-flash' },
      { key: 'GEMINI_LIVE_MODEL', label: 'Live voice model', defaultValue: 'gemini-2.5-flash-native-audio-preview-12-2025' },
      { key: 'GEMINI_VOICE', label: 'Gemini voice', defaultValue: 'Charon' },
      { key: 'GEMINI_LIVE_SILENCE_MS', label: 'Sentence pause, ms', defaultValue: '1200' }
    ]
  },
  {
    section: 'Search',
    fields: [
      { key: 'TAVILY_API_KEY', label: 'Tavily API key', secret: true },
      { key: 'SERPAPI_KEY', label: 'SerpAPI key', secret: true }
    ]
  },
  {
    section: 'Voice Fallback',
    fields: [
      { key: 'TTS_PROVIDER', label: 'TTS provider', defaultValue: 'live' },
      { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs API key', secret: true },
      { key: 'ELEVENLABS_VOICE_ID', label: 'ElevenLabs voice ID', defaultValue: 'JBFqnCBsd6RMkjVDRZzb' },
      { key: 'ELEVENLABS_MODEL', label: 'ElevenLabs model', defaultValue: 'eleven_flash_v2_5' }
    ]
  }
];

const ALLOWED_KEYS = new Set(SETTINGS_SCHEMA.flatMap((section) => section.fields.map((field) => field.key)));
const SECRET_KEYS = new Set(SETTINGS_SCHEMA.flatMap((section) => section.fields.filter((field) => field.secret).map((field) => field.key)));

export function getSettingsForClient() {
  const env = readEnvFile();
  return {
    envPath: ENV_PATH,
    sections: SETTINGS_SCHEMA.map((section) => ({
      section: section.section,
      fields: section.fields.map((field) => {
        const value = env[field.key] ?? process.env[field.key] ?? field.defaultValue ?? '';
        return {
          ...field,
          value: field.secret ? '' : String(value || ''),
          configured: Boolean(String(env[field.key] ?? process.env[field.key] ?? '').trim())
        };
      })
    }))
  };
}

export function updateSettings(settings = {}, clearSecrets = []) {
  const env = readEnvFile();
  const cleared = new Set(clearSecrets.filter((key) => SECRET_KEYS.has(key)));

  for (const key of cleared) {
    delete env[key];
    delete process.env[key];
  }

  Object.entries(settings).forEach(([key, rawValue]) => {
    if (!ALLOWED_KEYS.has(key)) return;
    const value = String(rawValue ?? '').trim();

    if (SECRET_KEYS.has(key) && !value) return;
    if (!SECRET_KEYS.has(key) && !value) {
      delete env[key];
      delete process.env[key];
      return;
    }

    env[key] = value;
    process.env[key] = value;
  });

  writeEnvFile(env);
  return getSettingsForClient();
}

function readEnvFile() {
  if (!existsSync(ENV_PATH)) return {};
  const raw = readFileSync(ENV_PATH, 'utf8');
  const env = {};

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index === -1) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    env[key] = unquoteEnvValue(value);
  });

  return env;
}

function writeEnvFile(env) {
  const lines = [
    '# Backend',
    `PORT=${env.PORT || process.env.PORT || '3001'}`,
    `FRONTEND_ORIGIN=${env.FRONTEND_ORIGIN || process.env.FRONTEND_ORIGIN || 'http://localhost:5174'}`,
    `DEFAULT_ADDRESS=${env.DEFAULT_ADDRESS || 'Sir'}`,
    `USER_TIMEZONE=${env.USER_TIMEZONE || 'Asia/Tashkent'}`,
    `SQLITE_PATH=${env.SQLITE_PATH || process.env.SQLITE_PATH || './backend/database.sqlite'}`,
    '',
    '# Gemini',
    `GEMINI_API_KEY=${env.GEMINI_API_KEY || ''}`,
    `GEMINI_TEXT_MODEL=${env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash'}`,
    `GEMINI_TTS_MODEL=${env.GEMINI_TTS_MODEL || process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'}`,
    `GEMINI_LIVE_MODEL=${env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025'}`,
    `GEMINI_VOICE=${env.GEMINI_VOICE || 'Charon'}`,
    `GEMINI_LIVE_SILENCE_MS=${env.GEMINI_LIVE_SILENCE_MS || '1200'}`,
    `GEMINI_LIVE_WS_URL=${env.GEMINI_LIVE_WS_URL || process.env.GEMINI_LIVE_WS_URL || 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'}`,
    '',
    '# Voice provider',
    `TTS_PROVIDER=${env.TTS_PROVIDER || 'live'}`,
    `ELEVENLABS_API_KEY=${env.ELEVENLABS_API_KEY || ''}`,
    `ELEVENLABS_VOICE_ID=${env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'}`,
    `ELEVENLABS_MODEL=${env.ELEVENLABS_MODEL || 'eleven_flash_v2_5'}`,
    '',
    '# Search',
    `TAVILY_API_KEY=${env.TAVILY_API_KEY || ''}`,
    `SERPAPI_KEY=${env.SERPAPI_KEY || ''}`,
    '',
    '# Frontend',
    `VITE_API_URL=${env.VITE_API_URL || process.env.VITE_API_URL || 'http://localhost:3001'}`,
    `VITE_API_WS=${env.VITE_API_WS || process.env.VITE_API_WS || 'ws://localhost:3001/ws/gemini-live'}`,
    `VITE_TTS_PROVIDER=${env.VITE_TTS_PROVIDER || process.env.VITE_TTS_PROVIDER || 'live'}`,
    `VITE_ENABLE_LIVE_AUDIO=${env.VITE_ENABLE_LIVE_AUDIO || process.env.VITE_ENABLE_LIVE_AUDIO || 'true'}`,
    `VITE_SPEECH_RECOGNITION_LANG=${env.VITE_SPEECH_RECOGNITION_LANG || process.env.VITE_SPEECH_RECOGNITION_LANG || 'en-US'}`,
    ''
  ];

  writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
