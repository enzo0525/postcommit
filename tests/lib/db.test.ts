import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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
  addExcluded,
  removeExcluded,
  listExcludedSlugs,
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
    expect(tables.map((t) => t.name)).toEqual(['excluded_slugs', 'repos', 'tweets']);
  });

  it('addRepo + listRepos roundtrip', () => {
    openDb();
    addRepo({
      slug: 'enzo/ascend',
      displayName: 'Ascend',
      lastTweetedSha: 'abc123',
    });
    const repos = listRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({
      slug: 'enzo/ascend',
      displayName: 'Ascend',
      lastTweetedSha: 'abc123',
    });
  });

  it('addRepo initializes lastTweetedAt to current time', () => {
    openDb();
    const before = Date.now();
    addRepo({ slug: 'enzo/a', displayName: 'A', lastTweetedSha: 'x' });
    const after = Date.now();
    const r = listRepos()[0];
    expect(r?.lastTweetedAt).not.toBeNull();
    const ts = new Date(r!.lastTweetedAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('addRepo is idempotent on slug conflict (REPLACE)', () => {
    openDb();
    addRepo({ slug: 'enzo/a', displayName: 'A', lastTweetedSha: 'x' });
    addRepo({ slug: 'enzo/a', displayName: 'A2', lastTweetedSha: 'y' });
    const repos = listRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0]?.displayName).toBe('A2');
  });

  it('removeRepo deletes by slug', () => {
    openDb();
    addRepo({ slug: 'enzo/a', displayName: 'A', lastTweetedSha: 'x' });
    addRepo({ slug: 'enzo/b', displayName: 'B', lastTweetedSha: 'y' });
    removeRepo('enzo/a');
    const repos = listRepos();
    expect(repos.map((r: Repo) => r.slug)).toEqual(['enzo/b']);
  });

  it('removeRepo returns 0 when slug not found', () => {
    openDb();
    expect(removeRepo('enzo/no-such-repo')).toBe(0);
  });

  it('updateLastTweetedSha updates sha and timestamp', () => {
    openDb();
    addRepo({ slug: 'enzo/a', displayName: 'A', lastTweetedSha: 'old' });
    updateLastTweetedSha('enzo/a', 'new', '2026-05-12T10:00:00Z');
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

  it('addExcluded + listExcludedSlugs roundtrip', () => {
    openDb();
    addExcluded('enzo/foo');
    addExcluded('enzo/bar');
    expect(listExcludedSlugs().sort()).toEqual(['enzo/bar', 'enzo/foo']);
  });

  it('addExcluded is idempotent', () => {
    openDb();
    addExcluded('enzo/foo');
    addExcluded('enzo/foo');
    expect(listExcludedSlugs()).toEqual(['enzo/foo']);
  });

  it('removeRepo also excludes the slug', () => {
    openDb();
    addRepo({ slug: 'enzo/foo', displayName: 'foo', lastTweetedSha: 'x' });
    removeRepo('enzo/foo');
    expect(listRepos()).toHaveLength(0);
    expect(listExcludedSlugs()).toEqual(['enzo/foo']);
  });

  it('removeRepo can exclude a slug that was never tracked', () => {
    openDb();
    expect(removeRepo('enzo/never-tracked')).toBe(0);
    expect(listExcludedSlugs()).toEqual(['enzo/never-tracked']);
  });

  it('addRepo clears any prior exclusion', () => {
    openDb();
    addExcluded('enzo/foo');
    addRepo({ slug: 'enzo/foo', displayName: 'foo', lastTweetedSha: 'x' });
    expect(listExcludedSlugs()).toEqual([]);
  });

  it('removeExcluded deletes from the exclusion list', () => {
    openDb();
    addExcluded('enzo/foo');
    removeExcluded('enzo/foo');
    expect(listExcludedSlugs()).toEqual([]);
  });
});
