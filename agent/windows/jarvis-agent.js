import crypto from 'crypto';
import { execSync } from 'child_process';
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

  if (command.type === 'close_url') {
    return executeDesktopIntent({
      action: 'close_url',
      label: payload.label || payload.url || 'Website'
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

  if (command.type === 'set_volume') {
    return setSystemVolume(payload);
  }

  throw new Error(`Unsupported command type: ${command.type}`);
}

function setSystemVolume(payload = {}) {
  const action = String(payload.action || '').trim().toLowerCase();
  if (!['set', 'up', 'down', 'mute', 'unmute', 'max'].includes(action)) {
    throw new Error(`Unsupported volume action: ${payload.action}`);
  }

  if (action === 'up') {
    runVolumeKeyPress(175, 5);
  } else if (action === 'down') {
    runVolumeKeyPress(174, 5);
  } else if (action === 'mute') {
    runAudioEndpointScript({ mute: true });
  } else if (action === 'unmute') {
    runAudioEndpointScript({ mute: false });
  } else if (action === 'max') {
    runVolumeKeyPress(175, 60);
  } else {
    const level = Math.max(0, Math.min(100, Math.round(Number(payload.level ?? 50))));
    runAudioEndpointScript({ level });
  }

  return {
    ok: true,
    action: 'set_volume',
    volume: {
      action,
      level: action === 'set' ? Math.max(0, Math.min(100, Math.round(Number(payload.level ?? 50)))) : undefined
    }
  };
}

function runVolumeKeyPress(keyCode, count = 1) {
  const presses = Math.max(1, Math.min(80, Math.round(Number(count) || 1)));
  runPowerShellSync(`
$wsh = New-Object -ComObject WScript.Shell
1..${presses} | ForEach-Object {
  $wsh.SendKeys([char]${keyCode})
  Start-Sleep -Milliseconds 15
}
`);
}

function runAudioEndpointScript({ level = null, mute = null } = {}) {
  const commands = [];
  if (typeof level === 'number') {
    commands.push(`[JarvisAudio.AudioController]::SetVolume(${(Math.max(0, Math.min(100, level)) / 100).toFixed(2)})`);
  }
  if (typeof mute === 'boolean') {
    commands.push(`[JarvisAudio.AudioController]::SetMute($${mute ? 'true' : 'false'})`);
  }

  runPowerShellSync(`
$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Runtime.InteropServices;
namespace JarvisAudio {
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int _VtblGap1_3();
  int _VtblGap2_1();
  int SetMasterVolumeLevelScalar(float f, System.Guid g);
  int _VtblGap3_1();
  int GetMasterVolumeLevelScalar(out float f);
  int _VtblGap4_4();
  int SetMute(bool b, System.Guid g);
  int GetMute(out bool b);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid id, int ctx, IntPtr p, out IAudioEndpointVolume v);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int _VtblGap1_1();
  int GetDefaultAudioEndpoint(int f, int r, out IMMDevice d);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject {}
public static class AudioController {
  public static void SetVolume(float level) {
    level = Math.Max(0f, Math.Min(1f, level));
    GetEndpoint().SetMasterVolumeLevelScalar(level, Guid.Empty);
  }
  public static void SetMute(bool mute) {
    GetEndpoint().SetMute(mute, Guid.Empty);
  }
  private static IAudioEndpointVolume GetEndpoint() {
    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
    Guid id = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume volume;
    Marshal.ThrowExceptionForHR(device.Activate(ref id, 23, IntPtr.Zero, out volume));
    return volume;
  }
}
}
'@
Add-Type -TypeDefinition $code
${commands.join('\n')}
`);
}

function runPowerShellSync(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
    windowsHide: true,
    stdio: 'pipe',
    timeout: 12000
  });
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
    agentVersion: '0.3.1'
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
