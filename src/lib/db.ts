import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { paths } from './paths.js';

export interface Repo {
  slug: string;
  displayName: string;
  lastTweetedSha: string | null;
  lastTweetedAt: string | null;
  addedAt: string;
}

export interface NewRepo {
  slug: string;
  displayName: string;
  lastTweetedSha: string | null;
}

export interface NewTweet {
  draft: string;
  final: string | null;
  status: 'approved' | 'edited' | 'skipped';
  repos: string[];
}

let _db: Database | null = null;

export function openDb(): Database {
  if (_db) return _db;
  mkdirSync(paths.configDir(), { recursive: true });
  const db = new Database(paths.dbFile());
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      slug             TEXT PRIMARY KEY,
      display_name     TEXT NOT NULL,
      last_tweeted_sha TEXT,
      last_tweeted_at  TEXT,
      added_at         TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tweets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      draft       TEXT NOT NULL,
      final       TEXT,
      status      TEXT NOT NULL,
      repos_json  TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS excluded_slugs (
      slug         TEXT PRIMARY KEY,
      excluded_at  TEXT NOT NULL
    );
  `);
  _db = db;
  return db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

export function addRepo(r: NewRepo): void {
  const db = openDb();
  db.prepare(
    `INSERT OR REPLACE INTO repos
     (slug, display_name, last_tweeted_sha, last_tweeted_at, added_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(r.slug, r.displayName, r.lastTweetedSha, new Date().toISOString(), new Date().toISOString());
  // Re-adding a repo clears any prior exclusion.
  db.prepare(`DELETE FROM excluded_slugs WHERE slug = ?`).run(r.slug);
}

export function listRepos(): Repo[] {
  const db = openDb();
  const rows = db
    .prepare(
      `SELECT slug, display_name, last_tweeted_sha,
              last_tweeted_at, added_at FROM repos ORDER BY display_name`,
    )
    .all() as Array<{
      slug: string;
      display_name: string;
      last_tweeted_sha: string | null;
      last_tweeted_at: string | null;
      added_at: string;
    }>;
  return rows.map((r) => ({
    slug: r.slug,
    displayName: r.display_name,
    lastTweetedSha: r.last_tweeted_sha,
    lastTweetedAt: r.last_tweeted_at,
    addedAt: r.added_at,
  }));
}

export function removeRepo(slug: string): number {
  const db = openDb();
  const info = db.prepare('DELETE FROM repos WHERE slug = ?').run(slug);
  // Always add to exclusion list, even if the DELETE was a no-op (user might be excluding
  // a repo they never tracked but don't want auto-discovered).
  db.prepare(
    `INSERT OR IGNORE INTO excluded_slugs (slug, excluded_at) VALUES (?, ?)`,
  ).run(slug, new Date().toISOString());
  return info.changes;
}

export function addExcluded(slug: string): void {
  const db = openDb();
  db.prepare(
    `INSERT OR IGNORE INTO excluded_slugs (slug, excluded_at) VALUES (?, ?)`,
  ).run(slug, new Date().toISOString());
}

export function removeExcluded(slug: string): void {
  const db = openDb();
  db.prepare(`DELETE FROM excluded_slugs WHERE slug = ?`).run(slug);
}

export function listExcludedSlugs(): string[] {
  const db = openDb();
  const rows = db.prepare(`SELECT slug FROM excluded_slugs`).all() as Array<{ slug: string }>;
  return rows.map((r) => r.slug);
}

export function updateLastTweetedSha(slug: string, sha: string, isoAt: string): void {
  const db = openDb();
  db.prepare(
    'UPDATE repos SET last_tweeted_sha = ?, last_tweeted_at = ? WHERE slug = ?',
  ).run(sha, isoAt, slug);
}

export function insertTweet(t: NewTweet): number {
  const db = openDb();
  const info = db
    .prepare(
      `INSERT INTO tweets (draft, final, status, repos_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(t.draft, t.final ?? null, t.status, JSON.stringify(t.repos), new Date().toISOString());
  return Number(info.lastInsertRowid);
}
