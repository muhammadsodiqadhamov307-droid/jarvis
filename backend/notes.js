import { db, nowIso } from './db.js';

function parseTags(tags = []) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  return [];
}

export function listNotes(query = '') {
  const q = String(query || '').trim();
  if (!q) {
    return db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all().map(hydrateNote);
  }
  return db.prepare(`
    SELECT * FROM notes
    WHERE title LIKE ? OR content LIKE ? OR tags LIKE ?
    ORDER BY updated_at DESC
  `).all(`%${q}%`, `%${q}%`, `%${q}%`).map(hydrateNote);
}

export function createNote({ title, content, tags = [] }) {
  const body = String(content || '').trim();
  const inferredTitle = String(title || body.slice(0, 48) || 'Untitled note').trim();
  const time = nowIso();
  const id = db.prepare(`
    INSERT INTO notes (title, content, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(inferredTitle, body, JSON.stringify(parseTags(tags)), time, time).lastInsertRowid;
  return getNote(id);
}

export function getNote(id) {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  return note ? hydrateNote(note) : null;
}

export function appendToNote(topic, content) {
  const q = `%${String(topic || '').trim()}%`;
  const note = db.prepare('SELECT * FROM notes WHERE title LIKE ? OR tags LIKE ? ORDER BY updated_at DESC LIMIT 1').get(q, q);
  if (!note) {
    return createNote({ title: topic || 'New note', content });
  }
  const updated = `${note.content}\n\n${String(content || '').trim()}`.trim();
  db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(updated, nowIso(), note.id);
  return getNote(note.id);
}

export function deleteNote(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isInteger(numeric)) {
    return db.prepare('DELETE FROM notes WHERE id = ?').run(numeric).changes;
  }
  return db.prepare('DELETE FROM notes WHERE title LIKE ?').run(`%${raw}%`).changes;
}

function hydrateNote(note) {
  return {
    ...note,
    tags: JSON.parse(note.tags || '[]')
  };
}
