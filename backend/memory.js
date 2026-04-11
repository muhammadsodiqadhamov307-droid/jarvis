import { db, nowIso } from './db.js';
import { getUserTimeContext } from './time.js';

const SHORT_TERM_LIMIT = 20;

export function addExchange(role, content) {
  const text = String(content || '').trim();
  if (!text) return null;

  const insert = db.prepare('INSERT INTO conversations (role, content, created_at) VALUES (?, ?, ?)');
  const info = insert.run(role, text, nowIso());

  const rows = db.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT -1 OFFSET ?').all(SHORT_TERM_LIMIT);
  if (rows.length) {
    const ids = rows.map((row) => row.id);
    db.prepare(`DELETE FROM conversations WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }

  return info.lastInsertRowid;
}

export function getShortTerm() {
  return db.prepare('SELECT role, content, created_at FROM conversations ORDER BY id ASC LIMIT ?').all(SHORT_TERM_LIMIT);
}

export function rememberFact(content, key = null, metadata = {}) {
  const text = String(content || '').trim();
  if (!text) return null;

  return db.prepare(`
    INSERT INTO memories (type, key, content, metadata, created_at, updated_at)
    VALUES ('long_term', ?, ?, ?, ?, ?)
  `).run(key, text, JSON.stringify(metadata), nowIso(), nowIso()).lastInsertRowid;
}

export function forgetMemory(query) {
  const q = `%${String(query || '').trim()}%`;
  if (q === '%%') return 0;
  const result = db.prepare("DELETE FROM memories WHERE type = 'long_term' AND (content LIKE ? OR key LIKE ?)").run(q, q);
  return result.changes;
}

export function addEpisodicSummary(content, metadata = {}) {
  const text = String(content || '').trim();
  if (!text) return null;
  return db.prepare(`
    INSERT INTO memories (type, key, content, metadata, created_at, updated_at)
    VALUES ('episodic', 'session', ?, ?, ?, ?)
  `).run(text, JSON.stringify(metadata), nowIso(), nowIso()).lastInsertRowid;
}

export function getRelevantMemories(query = '') {
  const normalized = String(query || '').trim();
  const longTerm = normalized
    ? db.prepare(`
        SELECT * FROM memories
        WHERE type = 'long_term' AND content LIKE ?
        ORDER BY updated_at DESC LIMIT 10
      `).all(`%${normalized}%`)
    : db.prepare("SELECT * FROM memories WHERE type = 'long_term' ORDER BY updated_at DESC LIMIT 10").all();

  const episodic = db.prepare("SELECT * FROM memories WHERE type = 'episodic' ORDER BY created_at DESC LIMIT 5").all();

  return {
    shortTerm: getShortTerm(),
    longTerm,
    episodic
  };
}

export function buildSystemPrompt(address = 'Sir', query = '') {
  const memories = getRelevantMemories(query);
  const facts = memories.longTerm.map((m) => `- ${m.content}`).join('\n') || '- No durable user facts yet.';
  const episodes = memories.episodic.map((m) => `- ${m.created_at}: ${m.content}`).join('\n') || '- No prior session summaries yet.';
  const recent = memories.shortTerm.map((m) => `${m.role}: ${m.content}`).join('\n') || 'No active conversation yet.';
  const time = getUserTimeContext();

  return `You are JARVIS, a formal, intelligent, loyal AI assistant inspired by a cinematic armored-suit AI.
Always address the user as "${address}" unless configured otherwise.
Stay concise, confident, witty, and useful. Never mention roleplay or break character.
The user lives in Uzbekistan. User timezone: ${time.timeZone}.
Current date/time for the user: ${time.dateTime}.

Long-term memory:
${facts}

Recent session summaries:
${episodes}

Current short-term conversation:
${recent}`;
}

export function summarizeSession() {
  const history = getShortTerm();
  if (!history.length) return null;
  const userTurns = history.filter((turn) => turn.role === 'user').map((turn) => turn.content);
  const assistantTurns = history.filter((turn) => turn.role === 'assistant').map((turn) => turn.content);
  const summary = [
    `Discussed ${userTurns.slice(-3).join('; ') || 'general assistance'}.`,
    assistantTurns.length ? `JARVIS responded with ${assistantTurns.length} assistant turn(s).` : ''
  ].filter(Boolean).join(' ');
  return addEpisodicSummary(summary, { exchangeCount: history.length });
}
