import crypto from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { executeDesktopIntent, resolveDesktopIntent } from '../../backend/desktop.js';

const DEFAULT_SERVER_URL = 'https://jarvis12345.duckdns.org';
const POLL_INTERVAL_MS = Number(process.env.JARVIS_AGENT_POLL_MS || 3000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.JARVIS_AGENT_HEARTBEAT_MS || 30000);
const configDir = path.join(process.env.APPDATA || os.homedir(), 'JarvisComputerAgent');
const configPath = path.join(configDir, 'device.json');
const logPath = path.join(configDir, 'agent.log');

const serverUrl = normalizeServerUrl(getArgValue('--server') || process.env.JARVIS_SERVER_URL || DEFAULT_SERVER_URL);
installFileLogger();
const device = loadOrCreateDevice();

console.log('JARVIS Windows Agent starting.');
console.log(`Server: ${serverUrl}`);
console.log(`Device: ${device.name} (${device.deviceKey})`);
console.log('This agent executes only allowlisted desktop commands after server approval.');

await register();
setInterval(() => heartbeat().catch(reportLoopError), HEARTBEAT_INTERVAL_MS);
setInterval(() => poll().catch(reportLoopError), POLL_INTERVAL_MS);
process.on('unhandledRejection', (error) => reportLoopError(error));
process.on('uncaughtException', (error) => {
  console.error(`Fatal agent error: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});

async function register() {
  const payload = await request('/api/agent/register', {
    deviceKey: device.deviceKey,
    deviceSecret: device.deviceSecret,
    name: device.name,
    platform: `${os.type()} ${os.release()}`,
    metadata: getMetadata()
  });
  console.log(`Registration status: ${payload.device.status}. ${payload.message}`);
  if (payload.device.status !== 'approved') {
    console.log('Waiting for approval from the JARVIS admin panel.');
  }
}

async function heartbeat() {
  const payload = await request('/api/agent/heartbeat', {
    deviceKey: device.deviceKey,
    deviceSecret: device.deviceSecret,
    metadata: getMetadata()
  });
  if (payload.device.status !== 'approved') {
    console.log(`Device status: ${payload.device.status}. Standing by.`);
  }
}

async function poll() {
  const payload = await request('/api/agent/poll', {
    deviceKey: device.deviceKey,
    deviceSecret: device.deviceSecret
  });

  if (payload.device.status !== 'approved') return;
  for (const command of payload.commands || []) {
    await executeCommand(command);
  }
}

async function executeCommand(command) {
  console.log(`Executing command ${command.id}: ${command.type}`);
  await updateStatus(command.id, 'running');
  try {
    const result = await runAllowedCommand(command);
    await updateStatus(command.id, 'success', result);
    console.log(`Command ${command.id} completed.`);
  } catch (error) {
    await updateStatus(command.id, 'error', {}, error.message);
    console.error(`Command ${command.id} failed: ${error.message}`);
  }
}

async function runAllowedCommand(command) {
  const payload = command.payload || {};
  if (command.type === 'desktop_intent') {
    const intent = resolveDesktopIntent(payload.message || '');
    if (!intent) throw new Error('No safe desktop action could be resolved from that command.');
    const result = await executeDesktopIntent(intent);
    return { intent, result };
  }

  if (command.type === 'open_url') {
    return executeDesktopIntent({
      action: 'open_url',
      label: payload.label || payload.url || 'URL',
      url: requireSafeUrl(payload.url)
    });
  }

  if (command.type === 'open_app') {
    return executeDesktopIntent({
      action: 'open_app',
      app: payload.app || `custom:${payload.appName || payload.label}`,
      label: payload.label || payload.appName || payload.app || 'Application',
      appName: payload.appName
    });
  }

  if (command.type === 'close_app') {
    return executeDesktopIntent({
      action: 'close_app',
      app: payload.app || `custom:${payload.appName || payload.label}`,
      label: payload.label || payload.appName || payload.app || 'Application',
      appName: payload.appName
    });
  }

  if (command.type === 'media_key') {
    return executeDesktopIntent({
      action: 'media_key',
      key: payload.key,
      label: payload.label || payload.key || 'Media control'
    });
  }

  throw new Error(`Unsupported command type: ${command.type}`);
}

async function updateStatus(commandId, status, result = {}, error = '') {
  return request(`/api/agent/commands/${encodeURIComponent(commandId)}/status`, {
    deviceKey: device.deviceKey,
    deviceSecret: device.deviceSecret,
    status,
    result,
    error
  });
}

async function request(endpoint, body) {
  const response = await fetch(`${serverUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Server returned ${response.status}`);
  }
  return payload;
}

function loadOrCreateDevice() {
  mkdirSync(configDir, { recursive: true });
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  }

  const created = {
    deviceKey: crypto.randomUUID(),
    deviceSecret: crypto.randomBytes(32).toString('hex'),
    name: `${os.hostname()} Windows`
  };
  writeFileSync(configPath, JSON.stringify(created, null, 2), 'utf8');
  return created;
}

function installFileLogger() {
  mkdirSync(configDir, { recursive: true });
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  function write(level, args) {
    const line = `[${new Date().toISOString()}] ${level} ${args.map(formatLogValue).join(' ')}\n`;
    try {
      appendFileSync(logPath, line, 'utf8');
    } catch {
      // Logging must never stop the agent from registering.
    }
  }

  console.log = (...args) => {
    write('INFO', args);
    originalLog(...args);
  };
  console.warn = (...args) => {
    write('WARN', args);
    originalWarn(...args);
  };
  console.error = (...args) => {
    write('ERROR', args);
    originalError(...args);
  };
}

function formatLogValue(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getMetadata() {
  return {
    hostname: os.hostname(),
    username: os.userInfo().username,
    arch: os.arch(),
    uptimeSeconds: Math.round(os.uptime()),
    agentVersion: '0.1.0'
  };
}

function normalizeServerUrl(value) {
  return String(value || DEFAULT_SERVER_URL).replace(/\/+$/g, '');
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function requireSafeUrl(value) {
  const url = new URL(String(value || ''));
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are allowed.');
  }
  return url.toString();
}

function reportLoopError(error) {
  console.warn(`Agent loop warning: ${error.message}`);
}
