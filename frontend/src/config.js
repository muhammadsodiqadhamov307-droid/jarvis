const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

export const API_URL = resolveApiUrl();
export const LIVE_WS_URL = resolveLiveWsUrl();

function resolveApiUrl() {
  const configured = import.meta.env.VITE_API_URL;
  if (import.meta.env.DEV) return configured || 'http://localhost:3001';
  if (configured && !isLocalUrl(configured)) return configured;
  return window.location.origin;
}

function resolveLiveWsUrl() {
  const configured = import.meta.env.VITE_API_WS;
  if (import.meta.env.DEV && configured) return configured;
  if (!import.meta.env.DEV && configured && !isLocalUrl(configured)) return configured;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = import.meta.env.DEV ? `${window.location.hostname}:3001` : window.location.host;
  return `${protocol}//${host}/ws/gemini-live`;
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
