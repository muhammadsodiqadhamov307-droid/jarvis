import { spawn } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

const APP_ALIASES = {
  telegram: {
    label: 'Telegram',
    processes: ['Telegram'],
    candidates: [
      path.join(process.env.APPDATA || '', 'Telegram Desktop', 'Telegram.exe'),
      'telegram'
    ]
  },
  chrome: {
    label: 'Chrome',
    processes: ['chrome'],
    candidates: ['chrome']
  },
  google: {
    label: 'Google',
    url: 'https://www.google.com'
  },
  youtube: {
    label: 'YouTube',
    url: 'https://www.youtube.com'
  },
  spotify: {
    label: 'Spotify',
    processes: ['Spotify'],
    candidates: ['spotify']
  },
  vscode: {
    label: 'VS Code',
    processes: ['Code'],
    candidates: ['code']
  },
  notepad: {
    label: 'Notepad',
    processes: ['notepad'],
    candidates: ['notepad']
  },
  explorer: {
    label: 'File Explorer',
    processes: ['explorer'],
    candidates: ['explorer.exe']
  },
  calculator: {
    label: 'Calculator',
    processes: ['Calculator'],
    candidates: ['calc.exe', 'calculator:']
  },
  word: {
    label: 'Microsoft Word',
    processes: ['WINWORD'],
    candidates: ['winword']
  },
  excel: {
    label: 'Microsoft Excel',
    processes: ['EXCEL'],
    candidates: ['excel']
  },
  obs: {
    label: 'OBS Studio',
    processes: ['obs64', 'obs32'],
    candidates: ['obs64', 'obs32']
  }
};

const MEDIA_KEYS = {
  play_pause: 0xb3,
  next: 0xb0,
  previous: 0xb1,
  volume_up: 0xaf,
  volume_down: 0xae,
  mute: 0xad
};

export function resolveDesktopIntent(raw) {
  const text = String(raw || '').trim();
  const lower = text.toLowerCase();
  if (!text) return null;
  if (isSearchLikeRequest(lower) && !isExplicitWeatherAppRequest(lower)) return null;

  const website = resolveWebsiteIntent(lower, text);
  if (website) return website;

  const media = resolveMediaIntent(lower);
  if (media) return media;

  const app = resolveAppIntent(lower);
  if (app) return app;

  const generalApp = resolveGeneralAppIntent(text, lower);
  if (generalApp) return generalApp;

  return null;
}

export async function executeDesktopIntent(intent) {
  if (!intent) return null;
  if (os.platform() !== 'win32') {
    return {
      ok: false,
      action: intent.action,
      label: intent.label,
      message: 'Desktop control is currently implemented for Windows only.'
    };
  }

  if (intent.action === 'open_url') {
    await startProcess(intent.url);
    return { ok: true, ...intent };
  }

  if (intent.action === 'open_app') {
    await openApp(intent.app, intent.label);
    return { ok: true, ...intent };
  }

  if (intent.action === 'close_app') {
    await closeApp(intent.app);
    return { ok: true, ...intent };
  }

  if (intent.action === 'media_key') {
    await sendMediaKey(intent.key);
    return { ok: true, ...intent };
  }

  return null;
}

export function desktopReply(result, address = 'Sir') {
  if (!result) return null;
  if (!result.ok) return `${result.message} ${address}.`;

  if (result.action === 'open_url') {
    return `Opening ${result.label}, ${address}.`;
  }
  if (result.action === 'open_app') {
    return `Opening ${result.label}, ${address}.`;
  }
  if (result.action === 'close_app') {
    return `Closing ${result.label}, ${address}.`;
  }
  if (result.action === 'media_key') {
    return `${result.label}, ${address}.`;
  }
  return `Done, ${address}.`;
}

function resolveMediaIntent(lower) {
  if (/\b(pause|stop|resume)\b.*\b(music|song|audio|video|media)\b/.test(lower) || /\b(pause|resume|play)\b$/.test(lower)) {
    return { action: 'media_key', key: 'play_pause', label: 'Toggling playback' };
  }
  if (/\b(next|skip)\b.*\b(song|track|video)\b/.test(lower)) {
    return { action: 'media_key', key: 'next', label: 'Skipping forward' };
  }
  if (/\b(previous|back)\b.*\b(song|track|video)\b/.test(lower)) {
    return { action: 'media_key', key: 'previous', label: 'Going back' };
  }
  if (/\b(volume up|louder|turn it up)\b/.test(lower)) {
    return { action: 'media_key', key: 'volume_up', label: 'Raising volume' };
  }
  if (/\b(volume down|quieter|turn it down)\b/.test(lower)) {
    return { action: 'media_key', key: 'volume_down', label: 'Lowering volume' };
  }
  if (/\b(mute|unmute)\b/.test(lower)) {
    return { action: 'media_key', key: 'mute', label: 'Toggling mute' };
  }
  return null;
}

function resolveWebsiteIntent(lower, original) {
  if (/\b(play|put on)\b.*\b(music|song|songs?|lofi|lo-fi)\b/.test(lower)) {
    const query = cleanMusicQuery(extractSearchQuery(original, /(play|put on|music|song|songs?|on youtube|youtube)/i)) || 'music';
    return {
      action: 'open_url',
      label: 'YouTube music search',
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    };
  }

  if (/\b(youtube|you tube)\b/.test(lower)) {
    const query = extractSearchQuery(original, /(youtube|you tube|watch|play|find videos? (about|on)|search youtube for)/i);
    if (query && !isBareOpenTarget(query, ['youtube', 'you tube'])) {
      return {
        action: 'open_url',
        label: 'YouTube',
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      };
    }
    return { action: 'open_url', label: 'YouTube', url: APP_ALIASES.youtube.url };
  }

  if (/\b(google|look up|search the web|search for|find me)\b/.test(lower)) {
    const query = extractSearchQuery(original, /(google|look up|search the web for|search for|find me)/i);
    if (query && !isBareOpenTarget(query, ['google'])) {
      return {
        action: 'open_url',
        label: 'Google search',
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`
      };
    }
    if (/\bgoogle\b/.test(lower)) return { action: 'open_url', label: 'Google', url: APP_ALIASES.google.url };
  }

  return null;
}

function resolveAppIntent(lower) {
  const action = /\b(close|quit|exit|kill)\b/.test(lower) ? 'close_app' : 'open_app';
  const appKey = Object.keys(APP_ALIASES).find((key) => {
    if (key === 'vscode') return /\b(vs code|vscode|code editor)\b/.test(lower);
    if (key === 'explorer') return /\b(file explorer|explorer|files|my files|folder|folders)\b/.test(lower);
    if (key === 'calculator') return /\b(calculator|calc)\b/.test(lower);
    if (key === 'word') return /\b(word|microsoft word|ms word)\b/.test(lower);
    if (key === 'excel') return /\b(excel|microsoft excel|ms excel)\b/.test(lower);
    if (key === 'obs') return /\b(obs|obs studio)\b/.test(lower);
    return new RegExp(`\\b${key}\\b`).test(lower);
  });

  if (!appKey) return null;
  const app = APP_ALIASES[appKey];
  if (app.url && action === 'open_app') {
    return { action: 'open_url', app: appKey, label: app.label, url: app.url };
  }
  return { action, app: appKey, label: app.label };
}

function resolveGeneralAppIntent(original, lower) {
  const match = lower.match(/\b(open|launch|start|run|close|quit|exit)\s+(?:the\s+)?(.+?)(?:\s+app|\s+application|\s+program)?$/i)
    || lower.match(/\b(?:i need|bring up|pull up)\s+(?:the\s+)?(.+?)(?:\s+app|\s+application|\s+program)?$/i);
  if (!match) return null;

  const actionWord = match[1] || 'open';
  const rawName = match[2] || match[1];
  const appName = cleanAppName(rawName);
  if (!appName || appName.length < 2 || isBlockedGenericAppName(appName)) return null;

  const action = /\b(close|quit|exit)\b/.test(actionWord) ? 'close_app' : 'open_app';
  return {
    action,
    app: `custom:${appName}`,
    label: titleCase(appName),
    appName
  };
}

function extractSearchQuery(text, triggerPattern) {
  const cleaned = text
    .replace(/\b(jarvis|please|could you|can you|would you|i want you to|i want to|i need|open|go to|bring up|pull up|show me)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutTrigger = cleaned.replace(triggerPattern, ' ').replace(/\s+/g, ' ').trim();
  if (!withoutTrigger || withoutTrigger.length < 2) return '';
  if (/^(open|go to|show me)$/.test(withoutTrigger.toLowerCase())) return '';
  return withoutTrigger;
}

function isBareOpenTarget(query, targets) {
  const normalized = query.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
  return targets.some((target) => normalized === target);
}

function cleanMusicQuery(query) {
  return String(query || '')
    .replace(/\b(the|a|some|music|song|songs|track|please)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAppName(name) {
  return String(name || '')
    .replace(/\b(jarvis|please|could you|can you|would you|for me)\b/gi, ' ')
    .replace(/\b(the|app|application|program)\b/gi, ' ')
    .replace(/[.?!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlockedGenericAppName(name) {
  return /^(it|this|that|something|anything|everything|computer|pc|window|windows|news|latest|current|today)$/i.test(name);
}

function isSearchLikeRequest(lower) {
  return /\b(latest|news|weather|forecast|temperature|current|today|online|internet|what happened)\b/.test(lower)
    || /^(search|web search|search online|look up|google)\b/.test(lower);
}

function isExplicitWeatherAppRequest(lower) {
  return /\b(open|launch|start|run|close|quit|exit)\s+(?:the\s+)?weather\s+(?:app|application|program)\b/.test(lower);
}

function titleCase(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function openApp(appKey, label = appKey) {
  const app = APP_ALIASES[appKey];
  if (!app) {
    await openAppByName(label);
    return;
  }
  for (const candidate of app.candidates || []) {
    if (candidate.includes(path.sep) && !existsSync(candidate)) continue;
    try {
      await startProcess(candidate);
      return;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(`Could not open ${app.label}.`);
}

async function closeApp(appKey) {
  if (appKey === 'explorer') {
    await closeExplorerWindows();
    return;
  }
  const app = APP_ALIASES[appKey];
  if (!app?.processes?.length) {
    const name = String(appKey || '').replace(/^custom:/, '');
    await closeAppByName(name);
    return;
  }
  const script = `
param([string[]]$Names)
foreach ($Name in $Names) {
  Get-Process -Name $Name -ErrorAction SilentlyContinue | Stop-Process -Force
}
`;
  await runPowerShell(script, app.processes);
}

async function openAppByName(appName) {
  const cleaned = cleanAppName(appName);
  if (!cleaned) throw new Error('No application name was provided.');
  const script = `
param([string]$Name)
function Normalize([string]$Value) {
  if (-not $Value) { return '' }
  return ($Value.ToLowerInvariant() -replace '[^a-z0-9]+', '')
}
$needle = Normalize $Name
$startRoots = @(
  [Environment]::GetFolderPath('Programs'),
  [Environment]::GetFolderPath('CommonPrograms'),
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory')
) | Where-Object { $_ -and (Test-Path $_) }
$shortcuts = foreach ($root in $startRoots) {
  Get-ChildItem -LiteralPath $root -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue
}
$shortcut = $shortcuts |
  Where-Object { (Normalize $_.BaseName) -eq $needle } |
  Select-Object -First 1
if (-not $shortcut) {
  $shortcut = $shortcuts |
    Where-Object { (Normalize $_.BaseName).Contains($needle) -or $needle.Contains((Normalize $_.BaseName)) } |
    Sort-Object { $_.BaseName.Length } |
    Select-Object -First 1
}
if ($shortcut) {
  Start-Process -FilePath $shortcut.FullName
  return
}

$registryRoots = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths'
) | Where-Object { Test-Path $_ }
foreach ($root in $registryRoots) {
  foreach ($item in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($item.PSChildName)
    if ((Normalize $base) -eq $needle -or (Normalize $base).Contains($needle)) {
      $target = (Get-Item -LiteralPath $item.PSPath -ErrorAction SilentlyContinue).GetValue('')
      if ($target) {
        Start-Process -FilePath $target
        return
      }
    }
  }
}

$commands = @($Name, "$Name.exe", ($Name -replace '\\s+', ''), (($Name -replace '\\s+', '') + '.exe'))
foreach ($command in $commands) {
  try {
    Start-Process -FilePath $command -ErrorAction Stop
    return
  } catch {}
}

throw "Could not locate an installed app named '$Name'."
`;
  await runPowerShell(script, [cleaned]);
}

async function closeAppByName(appName) {
  const cleaned = cleanAppName(appName);
  if (!cleaned) throw new Error('No application name was provided.');
  const names = Array.from(new Set([
    cleaned,
    cleaned.replace(/\s+/g, ''),
    ...cleaned.split(/\s+/).filter((part) => part.length > 2)
  ]));
  const script = `
param([string[]]$Names)
foreach ($Name in $Names) {
  Get-Process -Name $Name -ErrorAction SilentlyContinue | Stop-Process -Force
}
`;
  await runPowerShell(script, names);
}

async function closeExplorerWindows() {
  const script = `
$shell = New-Object -ComObject Shell.Application
foreach ($window in @($shell.Windows())) {
  try {
    $path = $window.FullName
    if ($path -and [System.IO.Path]::GetFileName($path).ToLowerInvariant() -eq 'explorer.exe') {
      $window.Quit()
    }
  } catch {}
}
`;
  await runPowerShell(script);
}

async function sendMediaKey(key) {
  const code = MEDIA_KEYS[key];
  if (!code) throw new Error(`Unknown media key: ${key}`);
  const script = `
param([int]$KeyCode)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Keyboard {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
}
"@
[Keyboard]::keybd_event([byte]$KeyCode, 0, 0, 0)
[Keyboard]::keybd_event([byte]$KeyCode, 0, 2, 0)
`;
  await runPowerShell(script, [String(code)]);
}

function startProcess(target) {
  const value = String(target || '').trim();
  if (!value) return Promise.reject(new Error('No launch target was provided.'));
  if (/^https?:\/\//i.test(value)) {
    return spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', value]);
  }
  return spawnDetached(value, []);
}

function spawnDetached(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function runPowerShell(script, args = []) {
  return new Promise((resolve, reject) => {
    const argList = args.map((arg) => `'${String(arg).replace(/'/g, "''")}'`).join(', ');
    const command = `$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; $InformationPreference = 'SilentlyContinue'; $WarningPreference = 'SilentlyContinue'; $VerbosePreference = 'SilentlyContinue'; $__args = @(${argList}); & { ${script} } @__args`;
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-OutputFormat',
      'Text',
      '-EncodedCommand',
      encoded
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(cleanPowerShellError(`${stderr}\n${stdout}`) || `PowerShell exited with code ${code}`));
      }
    });
  });
}

function cleanPowerShellError(stderr) {
  const text = String(stderr || '').trim();
  if (!text) return '';
  if (!text.startsWith('#< CLIXML')) return text;
  const messages = [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)]
    .map((match) => match[1]
      .replace(/_x000D__x000A_/g, '\n')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim())
    .filter(Boolean);
  return messages[0] || 'PowerShell command failed.';
}
