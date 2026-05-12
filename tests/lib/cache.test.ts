import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHome, paths } from '../../src/lib/paths.js';
import { readCache, writeCache, type Cache } from '../../src/lib/cache.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pc-cache-'));
  setHome(tmp);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('cache', () => {
  it('readCache returns null when file missing', () => {
    expect(readCache()).toBeNull();
  });

  it('writeCache then readCache roundtrips', () => {
    const c: Cache = {
      refreshedAt: '2026-05-12T09:18:42Z',
      totalPending: 4,
      byRepo: [
        { displayName: 'Ascend', pending: 3 },
        { displayName: 'Toasty', pending: 1 },
      ],
      lastTweetedAt: '2026-05-09T22:14:00Z',
    };
    writeCache(c);
    expect(readCache()).toEqual(c);
    expect(existsSync(paths.cacheFile())).toBe(true);
  });

  it('writeCache creates configDir if missing', () => {
    writeCache({ refreshedAt: 'x', totalPending: 0, byRepo: [], lastTweetedAt: null });
    expect(existsSync(paths.configDir())).toBe(true);
  });

  it('readCache returns null on malformed JSON', () => {
    writeCache({ refreshedAt: 'x', totalPending: 0, byRepo: [], lastTweetedAt: null });
    writeFileSync(paths.cacheFile(), '{not valid json');
    expect(readCache()).toBeNull();
  });
});
