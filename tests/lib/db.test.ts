import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHome } from '../../src/lib/paths.js';
import {
  openDb,
  closeDb,
  addRepo,
  listRepos,
  removeRepo,
  updateLastTweetedSha,
  insertTweet,
  type Repo,
} from '../../src/lib/db.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pc-db-'));
  setHome(tmp);
});

afterEach(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('db', () => {
  it('creates schema on first open', () => {
    const db = openDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual(['repos', 'tweets']);
  });

  it('addRepo + listRepos roundtrip', () => {
    openDb();
    addRepo({
      path: '/p/ascend',
      githubSlug: 'enzo/ascend',
      displayName: 'Ascend',
      lastTweetedSha: 'abc123',
    });
    const repos = listRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({
      path: '/p/ascend',
      githubSlug: 'enzo/ascend',
      displayName: 'Ascend',
      lastTweetedSha: 'abc123',
    });
  });

  it('addRepo initializes lastTweetedAt to current time', () => {
    openDb();
    const before = Date.now();
    addRepo({ path: '/p/a', githubSlug: 's', displayName: 'A', lastTweetedSha: 'x' });
    const after = Date.now();
    const r = listRepos()[0];
    expect(r?.lastTweetedAt).not.toBeNull();
    const ts = new Date(r!.lastTweetedAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('addRepo is idempotent on path conflict (REPLACE)', () => {
    openDb();
    addRepo({ path: '/p/a', githubSlug: 's', displayName: 'A', lastTweetedSha: 'x' });
    addRepo({ path: '/p/a', githubSlug: 's2', displayName: 'A2', lastTweetedSha: 'y' });
    const repos = listRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0]?.githubSlug).toBe('s2');
  });

  it('removeRepo deletes by path', () => {
    openDb();
    addRepo({ path: '/p/a', githubSlug: 's', displayName: 'A', lastTweetedSha: 'x' });
    addRepo({ path: '/p/b', githubSlug: 't', displayName: 'B', lastTweetedSha: 'y' });
    removeRepo('/p/a');
    const repos = listRepos();
    expect(repos.map((r: Repo) => r.path)).toEqual(['/p/b']);
  });

  it('removeRepo returns 0 when path not found', () => {
    openDb();
    expect(removeRepo('/no/such/path')).toBe(0);
  });

  it('updateLastTweetedSha updates sha and timestamp', () => {
    openDb();
    addRepo({ path: '/p/a', githubSlug: 's', displayName: 'A', lastTweetedSha: 'old' });
    updateLastTweetedSha('/p/a', 'new', '2026-05-12T10:00:00Z');
    const r = listRepos()[0];
    expect(r?.lastTweetedSha).toBe('new');
    expect(r?.lastTweetedAt).toBe('2026-05-12T10:00:00Z');
  });

  it('insertTweet records a draft', () => {
    openDb();
    const id = insertTweet({
      draft: 'shipped paywall',
      final: 'shipped paywall today',
      status: 'edited',
      repos: ['enzo/ascend'],
    });
    expect(id).toBeGreaterThan(0);
  });
});
