import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { paths } from './paths.js';

export interface RepoCount {
  displayName: string;
  pending: number;
}

export interface Cache {
  refreshedAt: string;
  totalPending: number;
  byRepo: RepoCount[];
  lastTweetedAt: string | null;
}

export function readCache(): Cache | null {
  const file = paths.cacheFile();
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, 'utf8');
    return JSON.parse(raw) as Cache;
  } catch {
    return null;
  }
}

export function writeCache(c: Cache): void {
  mkdirSync(paths.configDir(), { recursive: true });
  writeFileSync(paths.cacheFile(), JSON.stringify(c, null, 2), 'utf8');
}
