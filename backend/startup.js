import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VALUE_NAME = 'JarvisAI';

export async function getStartupStatus() {
  if (os.platform() !== 'win32') {
    return { supported: false, enabled: false, command: '', reason: 'Windows startup registration is only available on Windows.' };
  }

  try {
    const output = await runReg(['query', RUN_KEY, '/v', VALUE_NAME]);
    const command = parseRunValue(output);
    return { supported: true, enabled: Boolean(command), command };
  } catch {
    return { supported: true, enabled: false, command: '' };
  }
}

export async function setStartupEnabled(enabled) {
  if (os.platform() !== 'win32') {
    return { supported: false, enabled: false, command: '', reason: 'Windows startup registration is only available on Windows.' };
  }

  if (!enabled) {
    await runReg(['delete', RUN_KEY, '/v', VALUE_NAME, '/f']).catch(() => {});
    return getStartupStatus();
  }

  const command = process.env.JARVIS_STARTUP_COMMAND || buildDefaultStartupCommand();
  await runReg(['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', command, '/f']);
  return getStartupStatus();
}

function buildDefaultStartupCommand() {
  const launcher = path.resolve(__dirname, '..', 'deploy', 'windows', 'launcher', 'start-jarvis.ps1');
  return `"${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${launcher}"`;
}

function parseRunValue(output) {
  const line = String(output || '')
    .split(/\r?\n/)
    .find((entry) => entry.includes(VALUE_NAME) && entry.includes('REG_SZ'));
  if (!line) return '';
  return line.replace(new RegExp(`^\\s*${VALUE_NAME}\\s+REG_SZ\\s+`, 'i'), '').trim();
}

function runReg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('reg.exe', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `reg.exe exited with code ${code}`));
    });
  });
}
