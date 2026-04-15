import { dbProvider, nowIso, query } from './db.js';

const CURSOR_KEY = 'favorite_track_cursor';

export async function listFavoriteTracks() {
  const result = await query(`
    SELECT id, title, url, play_order, last_played_at, created_at
    FROM favorite_tracks
    ORDER BY play_order ASC, id ASC
  `);
  return result.rows.map(hydrateTrack);
}

export async function addFavoriteTrack({ title = '', url = '' } = {}) {
  const safeUrl = requireFavoriteUrl(url);
  const safeTitle = cleanTitle(title) || inferTitleFromUrl(safeUrl);
  const orderResult = await query('SELECT COALESCE(MAX(play_order), -1) + 1 AS next_order FROM favorite_tracks');
  const nextOrder = Number(orderResult.rows[0]?.next_order || 0);
  const inserted = await query(`
    INSERT INTO favorite_tracks (title, url, play_order)
    VALUES ($1, $2, $3)
    RETURNING id, title, url, play_order, last_played_at, created_at
  `, [safeTitle, safeUrl, nextOrder]);
  return hydrateTrack(inserted.rows[0]);
}

export async function deleteFavoriteTrack(id) {
  const trackId = Number(id);
  if (!Number.isInteger(trackId) || trackId <= 0) {
    throw Object.assign(new Error('Favorite track id is invalid.'), { status: 400 });
  }
  const result = await query('DELETE FROM favorite_tracks WHERE id = $1 RETURNING id', [trackId]);
  const deleted = Boolean(result.rows[0]);
  if (deleted) await compactFavoriteTrackOrder();
  return deleted;
}

export async function reorderFavoriteTracks(items = []) {
  if (!Array.isArray(items)) {
    throw Object.assign(new Error('Reorder payload must be an array.'), { status: 400 });
  }
  const updates = items
    .map((item) => ({
      id: Number(item?.id),
      play_order: Number(item?.play_order)
    }))
    .filter((item) => Number.isInteger(item.id) && item.id > 0 && Number.isInteger(item.play_order));

  await Promise.all(updates.map((item) => query(
    'UPDATE favorite_tracks SET play_order = $1 WHERE id = $2',
    [item.play_order, item.id]
  )));
  return listFavoriteTracks();
}

export async function getNextFavoriteTrack() {
  const tracks = await listFavoriteTracks();
  if (!tracks.length) return null;

  const cursor = Number(await getAppSetting(CURSOR_KEY));
  const currentIndex = tracks.findIndex((track) => Number(track.id) === cursor);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % tracks.length : 0;
  const next = tracks[nextIndex];

  await setAppSetting(CURSOR_KEY, String(next.id));
  await query('UPDATE favorite_tracks SET last_played_at = $1 WHERE id = $2', [nowIso(), next.id]);
  return { ...next, last_played_at: nowIso() };
}

async function compactFavoriteTrackOrder() {
  const tracks = await listFavoriteTracks();
  await Promise.all(tracks.map((track, index) => query(
    'UPDATE favorite_tracks SET play_order = $1 WHERE id = $2',
    [index, track.id]
  )));
}

async function getAppSetting(key) {
  const result = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return result.rows[0]?.value || '';
}

async function setAppSetting(key, value) {
  if (dbProvider() === 'postgres') {
    await query(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `, [key, value, nowIso()]);
    return;
  }
  await query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `, [key, value, nowIso()]);
}

function hydrateTrack(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    play_order: Number(row.play_order || 0)
  };
}

function requireFavoriteUrl(value) {
  const raw = String(value || '').trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw Object.assign(new Error('Favorite track URL must be a valid HTTP or HTTPS link.'), { status: 400 });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Favorite track URL must use HTTP or HTTPS.'), { status: 400 });
  }
  return parsed.toString();
}

function cleanTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function inferTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '') || 'Favorite track';
  } catch {
    return 'Favorite track';
  }
}
