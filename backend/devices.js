import crypto from 'crypto';
import { query, nowIso } from './db.js';

const COMMAND_STATUSES = new Set(['queued', 'sent', 'running', 'success', 'error', 'cancelled']);
const COMMAND_TYPES = new Set(['desktop_intent', 'open_url', 'open_app', 'close_app', 'close_url', 'media_key']);

export async function registerDevice({ deviceKey, deviceSecret, name, platform, metadata = {} }) {
  const key = cleanRequired(deviceKey, 'deviceKey');
  const secret = cleanRequired(deviceSecret, 'deviceSecret');
  const displayName = cleanName(name, 'Unknown computer');
  const os = String(platform || 'unknown').trim().slice(0, 80);
  const secretHash = hashSecret(secret);
  const time = nowIso();

  const existing = await findDeviceByKey(key);
  if (existing) {
    assertSecret(existing, secret);
    const updated = await query(`
      UPDATE devices
      SET platform = $1, metadata = $2, last_seen_at = $3, updated_at = $4
      WHERE device_key = $5
      RETURNING *
    `, [os, JSON.stringify(metadata || {}), time, time, key]);
    return hydrateDevice(updated.rows[0]);
  }

  const id = crypto.randomUUID();
  const inserted = await query(`
    INSERT INTO devices (id, device_key, secret_hash, name, platform, status, metadata, last_seen_at, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)
    RETURNING *
  `, [id, key, secretHash, displayName, os, JSON.stringify(metadata || {}), time, time, time]);
  await audit('device.registered', { id, name: displayName, platform: os });
  return hydrateDevice(inserted.rows[0]);
}

export async function heartbeatDevice({ deviceKey, deviceSecret, metadata = {} }) {
  const device = await authenticateDevice(deviceKey, deviceSecret);
  const time = nowIso();
  const updated = await query(`
    UPDATE devices
    SET metadata = $1, last_seen_at = $2, updated_at = $3
    WHERE id = $4
    RETURNING *
  `, [JSON.stringify({ ...device.metadata, ...metadata }), time, time, device.id]);
  return hydrateDevice(updated.rows[0]);
}

export async function listDevices() {
  const result = await query(`
    SELECT d.*,
      (SELECT COUNT(*) FROM commands c WHERE c.device_id = d.id AND c.status IN ('queued', 'sent', 'running')) AS active_commands
    FROM devices d
    ORDER BY d.updated_at DESC
  `);
  return result.rows.map(hydrateDevice);
}

export async function approveDevice(id, options = {}) {
  if (typeof options.name === 'string' || typeof options.isDefault === 'boolean') {
    await updateDevice(id, options);
  }
  if (options.isDefault === true) {
    await clearDefaultDevices();
  }
  const result = await query(`
    UPDATE devices
    SET status = 'approved', is_default = $1, updated_at = $2
    WHERE id = $3
    RETURNING *
  `, [options.isDefault === true, nowIso(), id]);
  if (result.rows[0]) await audit('device.approved', { id, isDefault: options.isDefault === true });
  return result.rows[0] ? hydrateDevice(result.rows[0]) : null;
}

export async function updateDevice(id, options = {}) {
  const updates = [];
  const params = [];

  if (typeof options.name === 'string') {
    params.push(cleanName(options.name, 'Computer'));
    updates.push(`name = $${params.length}`);
  }

  if (typeof options.isDefault === 'boolean') {
    if (options.isDefault) await clearDefaultDevices();
    params.push(options.isDefault);
    updates.push(`is_default = $${params.length}`);
  }

  if (!updates.length) {
    const result = await query('SELECT * FROM devices WHERE id = $1', [id]);
    return result.rows[0] ? hydrateDevice(result.rows[0]) : null;
  }

  params.push(nowIso());
  updates.push(`updated_at = $${params.length}`);
  params.push(id);
  const result = await query(`
    UPDATE devices
    SET ${updates.join(', ')}
    WHERE id = $${params.length}
    RETURNING *
  `, params);

  if (result.rows[0]) {
    await audit('device.updated', {
      id,
      name: typeof options.name === 'string' ? cleanName(options.name, 'Computer') : undefined,
      isDefault: typeof options.isDefault === 'boolean' ? options.isDefault : undefined
    });
  }
  return result.rows[0] ? hydrateDevice(result.rows[0]) : null;
}

export async function revokeDevice(id) {
  const result = await query(`
    UPDATE devices SET status = 'revoked', is_default = false, updated_at = $1 WHERE id = $2 RETURNING *
  `, [nowIso(), id]);
  if (result.rows[0]) await audit('device.revoked', { id });
  return result.rows[0] ? hydrateDevice(result.rows[0]) : null;
}

export async function queueCommand(deviceId, type, payload = {}) {
  if (!COMMAND_TYPES.has(type)) {
    throw Object.assign(new Error(`Unsupported command type: ${type}`), { status: 400 });
  }

  const deviceResult = await query('SELECT * FROM devices WHERE id = $1', [deviceId]);
  const device = hydrateDevice(deviceResult.rows[0]);
  if (!device) throw Object.assign(new Error('Device not found.'), { status: 404 });
  if (device.status !== 'approved') {
    throw Object.assign(new Error('Device is not approved yet.'), { status: 409 });
  }

  const id = crypto.randomUUID();
  const time = nowIso();
  const inserted = await query(`
    INSERT INTO commands (id, device_id, status, type, payload, result, created_at, updated_at)
    VALUES ($1, $2, 'queued', $3, $4, '{}', $5, $6)
    RETURNING *
  `, [id, deviceId, type, JSON.stringify(payload || {}), time, time]);
  await audit('command.queued', { id, deviceId, type });
  return hydrateCommand(inserted.rows[0]);
}

export async function pollCommands({ deviceKey, deviceSecret }) {
  const device = await authenticateDevice(deviceKey, deviceSecret);
  if (device.status !== 'approved') {
    return { device, commands: [] };
  }

  const result = await query(`
    SELECT * FROM commands
    WHERE device_id = $1 AND status = 'queued'
    ORDER BY created_at ASC
    LIMIT 5
  `, [device.id]);
  const commands = result.rows.map(hydrateCommand);
  if (commands.length) {
    await Promise.all(commands.map((command) => updateCommandStatus({
      deviceKey,
      deviceSecret,
      commandId: command.id,
      status: 'sent'
    })));
  }
  return { device, commands };
}

export async function updateCommandStatus({ deviceKey, deviceSecret, commandId, status, result = {}, error = '' }) {
  const device = await authenticateDevice(deviceKey, deviceSecret);
  if (!COMMAND_STATUSES.has(status)) {
    throw Object.assign(new Error(`Unsupported command status: ${status}`), { status: 400 });
  }

  const updated = await query(`
    UPDATE commands
    SET status = $1, result = $2, error = $3, updated_at = $4
    WHERE id = $5 AND device_id = $6
    RETURNING *
  `, [status, JSON.stringify(result || {}), String(error || ''), nowIso(), commandId, device.id]);
  return updated.rows[0] ? hydrateCommand(updated.rows[0]) : null;
}

export async function getCommand(commandId) {
  const result = await query('SELECT * FROM commands WHERE id = $1', [commandId]);
  return result.rows[0] ? hydrateCommand(result.rows[0]) : null;
}

export async function listCommands(deviceId) {
  const result = await query(`
    SELECT * FROM commands
    WHERE device_id = $1
    ORDER BY created_at DESC
    LIMIT 50
  `, [deviceId]);
  return result.rows.map(hydrateCommand);
}

async function authenticateDevice(deviceKey, deviceSecret) {
  const key = cleanRequired(deviceKey, 'deviceKey');
  const secret = cleanRequired(deviceSecret, 'deviceSecret');
  const device = await findDeviceByKey(key);
  if (!device) throw Object.assign(new Error('Device is not registered.'), { status: 401 });
  assertSecret(device, secret);
  await touchDeviceSeen(device.id);
  return { ...device, last_seen_at: nowIso() };
}

async function findDeviceByKey(deviceKey) {
  const result = await query('SELECT * FROM devices WHERE device_key = $1', [deviceKey]);
  return result.rows[0] ? hydrateDevice(result.rows[0], { includeSecret: true }) : null;
}

function assertSecret(device, secret) {
  const expected = Buffer.from(String(device.secret_hash || ''), 'hex');
  const actual = Buffer.from(hashSecret(secret), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw Object.assign(new Error('Device authentication failed.'), { status: 401 });
  }
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

async function audit(action, metadata = {}) {
  await query(
    'INSERT INTO audit_logs (actor, action, metadata, created_at) VALUES ($1, $2, $3, $4)',
    ['jarvis', action, JSON.stringify(metadata), nowIso()]
  );
}

function cleanRequired(value, label) {
  const cleaned = String(value || '').trim();
  if (!cleaned) throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  return cleaned;
}

function cleanName(value, fallback) {
  return String(value || fallback)
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || fallback;
}

async function clearDefaultDevices() {
  await query('UPDATE devices SET is_default = false, updated_at = $1 WHERE is_default = true', [nowIso()]);
}

async function touchDeviceSeen(deviceId) {
  await query('UPDATE devices SET last_seen_at = $1 WHERE id = $2', [nowIso(), deviceId]);
}

function hydrateDevice(row, { includeSecret = false } = {}) {
  if (!row) return null;
  const device = {
    ...row,
    is_default: Boolean(row.is_default),
    metadata: parseJson(row.metadata, {}),
    active_commands: Number(row.active_commands || 0)
  };
  if (!includeSecret) delete device.secret_hash;
  return device;
}

function hydrateCommand(row) {
  if (!row) return null;
  return {
    ...row,
    payload: parseJson(row.payload, {}),
    result: parseJson(row.result, {})
  };
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
