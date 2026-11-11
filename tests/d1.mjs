// Minimaler Ersatz für Cloudflare D1 in Tests, auf Basis von node:sqlite (ebenfalls SQLite).
// Wendet alle Migrationen aus migrations/ an, damit Tests das echte Schema nutzen.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  async first() { const row = this.db.prepare(this.sql).get(...this.params); return row ? { ...row } : null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params).map(row => ({ ...row })), success: true }; }
  async run() { const info = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(info.changes) } }; }
  runSync() { return this.db.prepare(this.sql).run(...this.params); }
}

export function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'));
  return {
    raw: db,
    prepare: sql => new Statement(db, sql),
    async batch(statements) {
      db.exec('BEGIN');
      try { const results = statements.map(statement => statement.runSync()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}
