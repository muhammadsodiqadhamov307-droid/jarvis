import { query, nowIso } from './db.js';

function parseTags(tags = []) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  return [];
}

export async function listNotes(search = '') {
  const q = String(search || '').trim();
  const result = q
    ? await query(`
        SELECT * FROM notes
        WHERE title ILIKE $1 OR content ILIKE $2 OR CAST(tags AS TEXT) ILIKE $3
        ORDER BY updated_at DESC
      `, [`%${q}%`, `%${q}%`, `%${q}%`])
    : await query('SELECT * FROM notes ORDER BY updated_at DESC');
  return result.rows.map(hydrateNote);
}

export async function createNote({ title, content, tags = [] }) {
  const body = String(content || '').trim();
  const inferredTitle = String(title || body.slice(0, 48) || 'Untitled note').trim();
  const time = nowIso();
  const result = await query(`
    INSERT INTO notes (title, content, tags, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [inferredTitle, body, JSON.stringify(parseTags(tags)), time, time]);
  return getNote(result.rows[0]?.id);
}

export async function getNote(id) {
  const result = await query('SELECT * FROM notes WHERE id = $1', [id]);
  return result.rows[0] ? hydrateNote(result.rows[0]) : null;
}

export async function appendToNote(topic, content) {
  const q = `%${String(topic || '').trim()}%`;
  const result = await query(
    'SELECT * FROM notes WHERE title ILIKE $1 OR CAST(tags AS TEXT) ILIKE $2 ORDER BY updated_at DESC LIMIT 1',
    [q, q]
  );
  const note = result.rows[0];
  if (!note) {
    return createNote({ title: topic || 'New note', content });
  }
  const updated = `${note.content}\n\n${String(content || '').trim()}`.trim();
  await query('UPDATE notes SET content = $1, updated_at = $2 WHERE id = $3', [updated, nowIso(), note.id]);
  return getNote(note.id);
}

export async function deleteNote(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return 0;
  const numeric = Number(raw);
  const result = Number.isInteger(numeric)
    ? await query('DELETE FROM notes WHERE id = $1', [numeric])
    : await query('DELETE FROM notes WHERE title ILIKE $1', [`%${raw}%`]);
  return result.rowCount;
}

function hydrateNote(note) {
  const tags = typeof note.tags === 'string' ? JSON.parse(note.tags || '[]') : note.tags || [];
  return {
    ...note,
    tags
  };
}
