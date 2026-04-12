import { query, nowIso } from './db.js';
import { getUserTimeContext } from './time.js';

const SHORT_TERM_LIMIT = 20;

export async function addExchange(role, content) {
  const text = String(content || '').trim();
  if (!text) return null;

  const inserted = await query(
    'INSERT INTO conversations (role, content, created_at) VALUES ($1, $2, $3) RETURNING id',
    [role, text, nowIso()]
  );

  const oldRows = await query(
    'SELECT id FROM conversations ORDER BY id DESC LIMIT 100000 OFFSET $1',
    [SHORT_TERM_LIMIT]
  );

  if (oldRows.rows.length) {
    await Promise.all(oldRows.rows.map((row) => query('DELETE FROM conversations WHERE id = $1', [row.id])));
  }

  return inserted.rows[0]?.id || null;
}

export async function getShortTerm() {
  const result = await query(
    'SELECT role, content, created_at FROM conversations ORDER BY id ASC LIMIT $1',
    [SHORT_TERM_LIMIT]
  );
  return result.rows;
}

export async function rememberFact(content, key = null, metadata = {}) {
  const text = String(content || '').trim();
  if (!text) return null;

  const result = await query(`
    INSERT INTO memories (type, key, content, metadata, created_at, updated_at)
    VALUES ('long_term', $1, $2, $3, $4, $5)
    RETURNING id
  `, [key, text, JSON.stringify(metadata), nowIso(), nowIso()]);

  return result.rows[0]?.id || null;
}

export async function forgetMemory(search) {
  const q = `%${String(search || '').trim()}%`;
  if (q === '%%') return 0;
  const result = await query(
    "DELETE FROM memories WHERE type = 'long_term' AND (content ILIKE $1 OR key ILIKE $2)",
    [q, q]
  );
  return result.rowCount;
}

export async function addEpisodicSummary(content, metadata = {}) {
  const text = String(content || '').trim();
  if (!text) return null;
  const result = await query(`
    INSERT INTO memories (type, key, content, metadata, created_at, updated_at)
    VALUES ('episodic', 'session', $1, $2, $3, $4)
    RETURNING id
  `, [text, JSON.stringify(metadata), nowIso(), nowIso()]);
  return result.rows[0]?.id || null;
}

export async function getRelevantMemories(search = '') {
  const normalized = String(search || '').trim();
  const longTerm = normalized
    ? await query(`
        SELECT * FROM memories
        WHERE type = 'long_term' AND content ILIKE $1
        ORDER BY updated_at DESC LIMIT 10
      `, [`%${normalized}%`])
    : await query("SELECT * FROM memories WHERE type = 'long_term' ORDER BY updated_at DESC LIMIT 10");

  const episodic = await query("SELECT * FROM memories WHERE type = 'episodic' ORDER BY created_at DESC LIMIT 5");

  return {
    shortTerm: await getShortTerm(),
    longTerm: longTerm.rows,
    episodic: episodic.rows
  };
}

export async function buildSystemPrompt(address = 'Sir', search = '') {
  const memories = await getRelevantMemories(search);
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

export async function summarizeSession() {
  const history = await getShortTerm();
  if (!history.length) return null;
  const userTurns = history.filter((turn) => turn.role === 'user').map((turn) => turn.content);
  const assistantTurns = history.filter((turn) => turn.role === 'assistant').map((turn) => turn.content);
  const summary = [
    `Discussed ${userTurns.slice(-3).join('; ') || 'general assistance'}.`,
    assistantTurns.length ? `JARVIS responded with ${assistantTurns.length} assistant turn(s).` : ''
  ].filter(Boolean).join(' ');
  return addEpisodicSummary(summary, { exchangeCount: history.length });
}
