# PostCommit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PostCommit MVP — a Node 22 TypeScript CLI that drafts build-in-public tweets from recent git commits, with a zsh shell-hook banner that ambushes the user into running the tool.

**Architecture:** Pure-local Node CLI. One SQLite file for state, one JSON cache file the banner reads from, one launchd plist for background refresh. No webserver, no daemon, no auth flow (delegates GitHub auth to the user's already-installed `gh` CLI).

**Tech Stack:** Node 22, TypeScript (ESM, NodeNext module resolution), commander, chalk, enquirer, better-sqlite3, execa, openai SDK, vitest for tests, oxlint for lint.

**Spec:** `docs/superpowers/specs/2026-05-12-postcommit-design.md`

---

## File Structure

```
postcommit/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore              # already exists
  src/
    index.ts              # commander entry, wires subcommands
    commands/
      init.ts             # one-time setup orchestrator
      tweet.ts            # the main draft/approve/edit/skip flow
      list.ts             # show tracked repos and pending counts
      add.ts              # add a repo
      remove.ts           # stop tracking a repo
      style.ts            # open style.txt in $EDITOR
      banner.ts           # internal, called by shell hook
      refresh.ts          # internal, called by launchd
    lib/
      paths.ts            # central source of truth for filesystem paths
      db.ts               # better-sqlite3 wrapper, schema, CRUD
      cache.ts            # cache.json read/write
      github.ts           # gh CLI wrapper via execa
      openai.ts           # draft generator
      hooks.ts            # zshrc + launchd installer/uninstaller
      clipboard.ts        # pbcopy wrapper
      style.ts            # style.txt read/write + default content
  tests/
    lib/
      db.test.ts
      cache.test.ts
      github.test.ts
      openai.test.ts
      hooks.test.ts
      clipboard.test.ts
      style.test.ts
  docs/superpowers/
    specs/2026-05-12-postcommit-design.md
    plans/2026-05-12-postcommit.md  # this file
  README.md
```

## Conventions

- **ESM throughout.** `"type": "module"` in package.json. Relative imports use `.js` extensions (e.g. `import { openDb } from './db.js'`) even though source is `.ts` — this is the Node 22 NodeNext requirement.
- **No `..` parent-relative imports.** Single-level `./foo.js` is fine. If you find yourself reaching for `../`, restructure.
- **One responsibility per file.** Lib modules expose typed functions; commands orchestrate libs. Commands do not call SQLite or filesystems directly — they go through `lib/`.
- **Mock at boundaries.** Vitest tests mock `execa` (for `gh`, `pbcopy`, `launchctl`), the `openai` SDK, and use temp dirs for filesystem operations. They do not mock our own logic.
- **No console.log in libs.** Only `commands/` and `index.ts` may write to stdout/stderr. Libs throw errors; commands decide presentation.
- **All paths centralized.** `lib/paths.ts` exports `paths.home`, `paths.configDir`, `paths.dbFile`, `paths.cacheFile`, `paths.styleFile`, `paths.envFile`, `paths.hookFile`, `paths.plistFile`. Tests override `paths` via a setter so they can use temp dirs.

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Modify: `.gitignore` (already exists with node_modules/, .env, *.log, .DS_Store — add `dist/`)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "postcommit",
  "version": "0.1.0",
  "description": "Drafts build-in-public tweets from your recent git commits.",
  "type": "module",
  "bin": {
    "postcommit": "./src/index.ts"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint src tests"
  },
  "dependencies": {
    "better-sqlite3": "^11.5.0",
    "chalk": "^5.3.0",
    "commander": "^13.0.0",
    "enquirer": "^2.4.1",
    "execa": "^9.5.2",
    "openai": "^4.77.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.0",
    "oxlint": "^0.15.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```

Note: pin exact versions (no `^`) once locked. Caret is fine during scaffold; bun will resolve and write the lockfile.

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": false,
    "sourceMap": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
```

- [ ] **Step 4: Update `.gitignore`**

Append `dist/` to the existing file. Final contents:

```
node_modules/
.env
*.log
.DS_Store
dist/
```

- [ ] **Step 5: Install dependencies**

Run: `bun install`
Expected: lockfile generated, `node_modules/` populated, no errors.

- [ ] **Step 6: Verify typecheck passes on empty project**

Run: `bun run typecheck`
Expected: exits 0 (no errors — there are no `.ts` files yet).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore bun.lock
git commit -m "Scaffold postcommit project (Node 22 + TS + vitest)"
```

---

## Task 2: `lib/paths.ts` — central path module

**Files:**
- Create: `src/lib/paths.ts`
- Test: `tests/lib/paths.test.ts`

This module is small but load-bearing — every other module depends on it. Building it first lets tests stub paths to temp dirs.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/paths.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { paths, setHome } from '../../src/lib/paths.js';

describe('paths', () => {
  beforeEach(() => setHome('/tmp/pc-test'));

  it('derives configDir under home', () => {
    expect(paths.configDir()).toBe('/tmp/pc-test/.postcommit');
  });

  it('derives all known files under configDir', () => {
    expect(paths.dbFile()).toBe('/tmp/pc-test/.postcommit/state.db');
    expect(paths.cacheFile()).toBe('/tmp/pc-test/.postcommit/cache.json');
    expect(paths.styleFile()).toBe('/tmp/pc-test/.postcommit/style.txt');
    expect(paths.envFile()).toBe('/tmp/pc-test/.postcommit/.env');
    expect(paths.hookFile()).toBe('/tmp/pc-test/.postcommit/hook.zsh');
  });

  it('derives zshrc and plist under home', () => {
    expect(paths.zshrc()).toBe('/tmp/pc-test/.zshrc');
    expect(paths.plistFile()).toBe('/tmp/pc-test/Library/LaunchAgents/com.enzo.postcommit.refresh.plist');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/lib/paths.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/paths.js'".

- [ ] **Step 3: Implement `src/lib/paths.ts`**

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

let _home = homedir();

export function setHome(h: string): void {
  _home = h;
}

export const paths = {
  home: () => _home,
  configDir: () => join(_home, '.postcommit'),
  dbFile: () => join(_home, '.postcommit', 'state.db'),
  cacheFile: () => join(_home, '.postcommit', 'cache.json'),
  styleFile: () => join(_home, '.postcommit', 'style.txt'),
  envFile: () => join(_home, '.postcommit', '.env'),
  hookFile: () => join(_home, '.postcommit', 'hook.zsh'),
  zshrc: () => join(_home, '.zshrc'),
  plistFile: () => join(_home, 'Library', 'LaunchAgents', 'com.enzo.postcommit.refresh.plist'),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/lib/paths.test.ts`
Expected: PASS, 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/paths.ts tests/lib/paths.test.ts
git commit -m "Add lib/paths centralized path module"
```

---

## Task 3: `lib/db.ts` — SQLite wrapper

**Files:**
- Create: `src/lib/db.ts`
- Test: `tests/lib/db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHome } from '../../src/lib/paths.js';
import {
  openDb,
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
  rmSync(tmp, { recursive: true, force: true });
});

describe('db', () => {
  it('creates schema on first open', () => {
    const db = openDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/lib/db.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `src/lib/db.ts`**

```ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { paths } from './paths.js';

export interface Repo {
  path: string;
  githubSlug: string;
  displayName: string;
  lastTweetedSha: string | null;
  lastTweetedAt: string | null;
  addedAt: string;
}

export interface NewRepo {
  path: string;
  githubSlug: string;
  displayName: string;
  lastTweetedSha: string | null;
}

export interface NewTweet {
  draft: string;
  final: string | null;
  status: 'approved' | 'edited' | 'skipped';
  repos: string[];
}

let _db: Database.Database | null = null;

export function openDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(paths.configDir(), { recursive: true });
  const db = new Database(paths.dbFile());
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      path             TEXT PRIMARY KEY,
      github_slug      TEXT NOT NULL,
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
     (path, github_slug, display_name, last_tweeted_sha, last_tweeted_at, added_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(r.path, r.githubSlug, r.displayName, r.lastTweetedSha, new Date().toISOString());
}

export function listRepos(): Repo[] {
  const db = openDb();
  const rows = db
    .prepare(
      `SELECT path, github_slug, display_name, last_tweeted_sha,
              last_tweeted_at, added_at FROM repos ORDER BY display_name`,
    )
    .all() as Array<{
      path: string;
      github_slug: string;
      display_name: string;
      last_tweeted_sha: string | null;
      last_tweeted_at: string | null;
      added_at: string;
    }>;
  return rows.map((r) => ({
    path: r.path,
    githubSlug: r.github_slug,
    displayName: r.display_name,
    lastTweetedSha: r.last_tweeted_sha,
    lastTweetedAt: r.last_tweeted_at,
    addedAt: r.added_at,
  }));
}

export function removeRepo(path: string): void {
  const db = openDb();
  db.prepare('DELETE FROM repos WHERE path = ?').run(path);
}

export function updateLastTweetedSha(
  path: string,
  sha: string,
  isoAt: string,
): void {
  const db = openDb();
  db.prepare(
    'UPDATE repos SET last_tweeted_sha = ?, last_tweeted_at = ? WHERE path = ?',
  ).run(sha, isoAt, path);
}

export function insertTweet(t: NewTweet): number {
  const db = openDb();
  const info = db
    .prepare(
      `INSERT INTO tweets (draft, final, status, repos_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(t.draft, t.final, t.status, JSON.stringify(t.repos), new Date().toISOString());
  return Number(info.lastInsertRowid);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/lib/db.test.ts`
Expected: PASS, 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts tests/lib/db.test.ts
git commit -m "Add lib/db SQLite wrapper with repos + tweets tables"
```

---

## Task 4: `lib/cache.ts` — cache.json read/write

**Files:**
- Create: `src/lib/cache.ts`
- Test: `tests/lib/cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
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
    // corrupt the file
    const fs = require('node:fs');
    fs.writeFileSync(paths.cacheFile(), '{not valid json');
    expect(readCache()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/lib/cache.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/cache.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/lib/cache.test.ts`
Expected: PASS, 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.ts tests/lib/cache.test.ts
git commit -m "Add lib/cache JSON read/write"
```

---

## Task 5: `lib/github.ts` — gh CLI wrapper

**Files:**
- Create: `src/lib/github.ts`
- Test: `tests/lib/github.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/github.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import {
  countCommitsSince,
  fetchCommitsSince,
  getRepoSlugFromRemote,
  type Commit,
} from '../../src/lib/github.js';

beforeEach(() => {
  vi.mocked(execa).mockReset();
});

describe('github', () => {
  it('countCommitsSince returns array length from gh api response', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: JSON.stringify([{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }]),
    } as never);
    const n = await countCommitsSince('enzo/ascend', '2026-05-10T00:00:00Z');
    expect(n).toBe(3);
    expect(execa).toHaveBeenCalledWith('gh', [
      'api',
      '-X', 'GET',
      'repos/enzo/ascend/commits',
      '-f', 'since=2026-05-10T00:00:00Z',
    ]);
  });

  it('countCommitsSince returns 0 on gh failure', async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error('rate limit'));
    const n = await countCommitsSince('enzo/ascend', '2026-05-10T00:00:00Z');
    expect(n).toBe(0);
  });

  it('fetchCommitsSince returns typed commits', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          sha: 'abc123',
          commit: { message: 'add paywall', author: { date: '2026-05-11T18:42:00Z' } },
        },
      ]),
    } as never);
    const commits = await fetchCommitsSince('enzo/ascend', '2026-05-10T00:00:00Z');
    expect(commits).toEqual<Commit[]>([
      { sha: 'abc123', message: 'add paywall', at: '2026-05-11T18:42:00Z' },
    ]);
  });

  it('getRepoSlugFromRemote parses ssh + https remotes', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: 'origin\tgit@github.com:enzo/ascend.git (fetch)\norigin\tgit@github.com:enzo/ascend.git (push)',
    } as never);
    expect(await getRepoSlugFromRemote('/p/ascend')).toBe('enzo/ascend');

    vi.mocked(execa).mockResolvedValueOnce({
      stdout: 'origin\thttps://github.com/enzo/ascend.git (fetch)',
    } as never);
    expect(await getRepoSlugFromRemote('/p/ascend')).toBe('enzo/ascend');
  });

  it('getRepoSlugFromRemote returns null for non-GitHub remotes', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: 'origin\tgit@gitlab.com:enzo/ascend.git (fetch)',
    } as never);
    expect(await getRepoSlugFromRemote('/p/ascend')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/lib/github.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/github.ts`**

```ts
import { execa } from 'execa';

export interface Commit {
  sha: string;
  message: string;
  at: string;
}

interface GhApiCommit {
  sha: string;
  commit: { message: string; author: { date: string } };
}

export async function countCommitsSince(slug: string, sinceIso: string): Promise<number> {
  try {
    const { stdout } = await execa('gh', [
      'api',
      '-X', 'GET',
      `repos/${slug}/commits`,
      '-f', `since=${sinceIso}`,
    ]);
    const arr = JSON.parse(stdout) as unknown[];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

export async function fetchCommitsSince(slug: string, sinceIso: string): Promise<Commit[]> {
  try {
    const { stdout } = await execa('gh', [
      'api',
      '-X', 'GET',
      `repos/${slug}/commits`,
      '-f', `since=${sinceIso}`,
    ]);
    const arr = JSON.parse(stdout) as GhApiCommit[];
    return arr.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split('\n')[0] ?? '',
      at: c.commit.author.date,
    }));
  } catch {
    return [];
  }
}

const REMOTE_PATTERNS = [
  /git@github\.com:([\w-]+\/[\w.-]+?)(?:\.git)?\s/,
  /https:\/\/github\.com\/([\w-]+\/[\w.-]+?)(?:\.git)?\s/,
];

export async function getRepoSlugFromRemote(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['-C', repoPath, 'remote', '-v']);
    const padded = `${stdout}\n`;
    for (const re of REMOTE_PATTERNS) {
      const m = padded.match(re);
      if (m && m[1]) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

export async function getHeadSha(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['-C', repoPath, 'rev-parse', 'HEAD']);
    return stdout.trim();
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/lib/github.test.ts`
Expected: PASS, 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/github.ts tests/lib/github.test.ts
git commit -m "Add lib/github wrapping gh CLI + git remote parsing"
```

---

## Task 6: `lib/openai.ts` — draft generator

**Files:**
- Create: `src/lib/openai.ts`
- Test: `tests/lib/openai.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/openai.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: createMock } },
  })),
}));

import { draftTweet } from '../../src/lib/openai.js';

beforeEach(() => createMock.mockReset());

describe('openai', () => {
  it('passes system prompt + commits JSON and returns draft text', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'shipped paywall on ascend today  ' } }],
    });
    const out = await draftTweet({
      apiKey: 'sk-x',
      systemPrompt: 'be casual',
      repos: [
        {
          name: 'Ascend',
          commits: [{ sha: 'a', message: 'add paywall', at: '2026-05-11T18:42:00Z' }],
        },
      ],
      daysSinceLastTweet: 3,
    });
    expect(out).toBe('shipped paywall on ascend today');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 100,
        messages: [
          { role: 'system', content: 'be casual' },
          expect.objectContaining({ role: 'user' }),
        ],
      }),
    );
    const callArg = createMock.mock.calls[0][0];
    const userJson = JSON.parse(callArg.messages[1].content);
    expect(userJson.repos[0].name).toBe('Ascend');
    expect(userJson.days_since_last_tweet).toBe(3);
  });

  it('throws when OpenAI returns empty content', async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: null } }] });
    await expect(
      draftTweet({
        apiKey: 'sk-x',
        systemPrompt: 's',
        repos: [],
        daysSinceLastTweet: 0,
      }),
    ).rejects.toThrow(/empty/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/lib/openai.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/openai.ts`**

```ts
import OpenAI from 'openai';
import type { Commit } from './github.js';

export interface RepoInput {
  name: string;
  commits: Commit[];
}

export interface DraftRequest {
  apiKey: string;
  systemPrompt: string;
  repos: RepoInput[];
  daysSinceLastTweet: number;
}

export async function draftTweet(req: DraftRequest): Promise<string> {
  const client = new OpenAI({ apiKey: req.apiKey });
  const userPayload = {
    repos: req.repos.map((r) => ({
      name: r.name,
      commits: r.commits.map((c) => ({ sha: c.sha, message: c.message, at: c.at })),
    })),
    days_since_last_tweet: req.daysSinceLastTweet,
  };
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    max_tokens: 100,
    messages: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
  });
  const text = completion.choices[0]?.message.content;
  if (!text || text.trim().length === 0) {
    throw new Error('OpenAI returned empty content');
  }
  return text.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/lib/openai.test.ts`
Expected: PASS, 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/openai.ts tests/lib/openai.test.ts
git commit -m "Add lib/openai draft generator using gpt-4o-mini"
```

---

## Task 7: `lib/clipboard.ts` — pbcopy wrapper

**Files:**
- Create: `src/lib/clipboard.ts`
- Test: `tests/lib/clipboard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/clipboard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { execa } from 'execa';
import { copyToClipboard } from '../../src/lib/clipboard.js';

beforeEach(() => vi.mocked(execa).mockReset());

describe('clipboard', () => {
  it('pipes text to pbcopy', async () => {
    vi.mocked(execa).mockResolvedValueOnce({ stdout: '' } as never);
    await copyToClipboard('hello world');
    expect(execa).toHaveBeenCalledWith('pbcopy', [], { input: 'hello world' });
  });

  it('throws when pbcopy fails', async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error('nope'));
    await expect(copyToClipboard('x')).rejects.toThrow(/clipboard/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/lib/clipboard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/clipboard.ts`**

```ts
import { execa } from 'execa';

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await execa('pbcopy', [], { input: text });
  } catch (err) {
    throw new Error(`Failed to copy to clipboard: ${(err as Error).message}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/lib/clipboard.test.ts`
Expected: PASS, 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clipboard.ts tests/lib/clipboard.test.ts
git commit -m "Add lib/clipboard pbcopy wrapper"
```

---

## Task 8: `lib/style.ts` — style.txt read/write + default

**Files:**
- Create: `src/lib/style.ts`
- Test: `tests/lib/style.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/style.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHome, paths } from '../../src/lib/paths.js';
import { readStyle, writeDefaultStyle, DEFAULT_STYLE } from '../../src/lib/style.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pc-style-'));
  setHome(tmp);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('style', () => {
  it('writeDefaultStyle creates file with DEFAULT_STYLE content', () => {
    writeDefaultStyle();
    expect(existsSync(paths.styleFile())).toBe(true);
    expect(readFileSync(paths.styleFile(), 'utf8')).toBe(DEFAULT_STYLE);
  });

  it('writeDefaultStyle does not overwrite existing file', () => {
    writeDefaultStyle();
    const fs = require('node:fs');
    fs.writeFileSync(paths.styleFile(), 'custom prompt');
    writeDefaultStyle();
    expect(readFileSync(paths.styleFile(), 'utf8')).toBe('custom prompt');
  });

  it('readStyle returns file contents', () => {
    writeDefaultStyle();
    expect(readStyle()).toBe(DEFAULT_STYLE);
  });

  it('readStyle returns DEFAULT_STYLE if file missing', () => {
    expect(readStyle()).toBe(DEFAULT_STYLE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/lib/style.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/style.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { paths } from './paths.js';

export const DEFAULT_STYLE = `You are drafting a single tweet for an indie maker building in public.

Input: a list of git commits with messages, repos, and timestamps.
Output: ONE tweet, max 240 chars, that reads like a real human shipped real work.

Rules:
- Mention the project name once if it's recognizable
- Refer to specific things you shipped — not "shipped some stuff"
- Casual voice, lowercase OK, no corporate-speak
- Zero hashtags, max 1 emoji
- End with an open thought, a number, or a question — never "stay tuned"
- If commits look like noise (typos, lint), pick the meatiest 2-3 and ignore the rest
`;

export function writeDefaultStyle(): void {
  mkdirSync(paths.configDir(), { recursive: true });
  if (existsSync(paths.styleFile())) return;
  writeFileSync(paths.styleFile(), DEFAULT_STYLE, 'utf8');
}

export function readStyle(): string {
  if (!existsSync(paths.styleFile())) return DEFAULT_STYLE;
  return readFileSync(paths.styleFile(), 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/lib/style.test.ts`
Expected: PASS, 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/style.ts tests/lib/style.test.ts
git commit -m "Add lib/style with default prompt"
```

---

## Task 9: `lib/hooks.ts` — zshrc + launchd installer

**Files:**
- Create: `src/lib/hooks.ts`
- Test: `tests/lib/hooks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/hooks.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHome, paths } from '../../src/lib/paths.js';

vi.mock('execa', () => ({ execa: vi.fn().mockResolvedValue({ stdout: '' }) }));

import {
  installShellHook,
  installAlias,
  installLaunchdPlist,
  HOOK_SOURCE_LINE,
  ALIAS_LINE,
} from '../../src/lib/hooks.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pc-hooks-'));
  setHome(tmp);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('hooks', () => {
  it('installShellHook writes hook.zsh with banner call', () => {
    writeFileSync(paths.zshrc(), '# existing\n');
    installShellHook();
    const hookContent = readFileSync(paths.hookFile(), 'utf8');
    expect(hookContent).toContain('postcommit banner');
    expect(readFileSync(paths.zshrc(), 'utf8')).toContain(HOOK_SOURCE_LINE);
  });

  it('installShellHook is idempotent (does not duplicate source line)', () => {
    writeFileSync(paths.zshrc(), '# existing\n');
    installShellHook();
    installShellHook();
    const zshrc = readFileSync(paths.zshrc(), 'utf8');
    const occurrences = zshrc.split(HOOK_SOURCE_LINE).length - 1;
    expect(occurrences).toBe(1);
  });

  it('installShellHook creates .zshrc if it does not exist', () => {
    installShellHook();
    expect(existsSync(paths.zshrc())).toBe(true);
    expect(readFileSync(paths.zshrc(), 'utf8')).toContain(HOOK_SOURCE_LINE);
  });

  it('installAlias appends alias line idempotently', () => {
    writeFileSync(paths.zshrc(), '');
    installAlias();
    installAlias();
    const zshrc = readFileSync(paths.zshrc(), 'utf8');
    expect(zshrc.split(ALIAS_LINE).length - 1).toBe(1);
  });

  it('installLaunchdPlist writes plist with 900s interval', async () => {
    await installLaunchdPlist();
    const plist = readFileSync(paths.plistFile(), 'utf8');
    expect(plist).toContain('com.enzo.postcommit.refresh');
    expect(plist).toContain('<integer>900</integer>');
    expect(plist).toContain('<string>postcommit</string>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/lib/hooks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/hooks.ts`**

```ts
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { execa } from 'execa';
import { paths } from './paths.js';

export const HOOK_SOURCE_LINE = '[ -f ~/.postcommit/hook.zsh ] && source ~/.postcommit/hook.zsh';
export const ALIAS_LINE = "alias tweet='postcommit tweet'";

const HOOK_BODY = `# postcommit banner — silent if nothing pending
command -v postcommit >/dev/null && postcommit banner 2>/dev/null
`;

function ensureZshrc(): string {
  const zshrc = paths.zshrc();
  if (!existsSync(zshrc)) writeFileSync(zshrc, '', 'utf8');
  return readFileSync(zshrc, 'utf8');
}

function appendOnce(line: string): void {
  const current = ensureZshrc();
  if (current.includes(line)) return;
  const sep = current.endsWith('\n') || current.length === 0 ? '' : '\n';
  appendFileSync(paths.zshrc(), `${sep}${line}\n`, 'utf8');
}

export function installShellHook(): void {
  mkdirSync(paths.configDir(), { recursive: true });
  writeFileSync(paths.hookFile(), HOOK_BODY, 'utf8');
  appendOnce(HOOK_SOURCE_LINE);
}

export function installAlias(): void {
  appendOnce(ALIAS_LINE);
}

function plistXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.enzo.postcommit.refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>postcommit</string>
    <string>refresh</string>
  </array>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/postcommit.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/postcommit.err.log</string>
</dict>
</plist>
`;
}

export async function installLaunchdPlist(): Promise<void> {
  const file = paths.plistFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, plistXml(), 'utf8');
  try {
    await execa('launchctl', ['unload', file]);
  } catch { /* not loaded yet — fine */ }
  try {
    await execa('launchctl', ['load', file]);
  } catch { /* surface in init log but don't crash hook installer */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/lib/hooks.test.ts`
Expected: PASS, 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hooks.ts tests/lib/hooks.test.ts
git commit -m "Add lib/hooks zshrc + launchd installer"
```

---

## Task 10: `src/index.ts` — commander entry with subcommand wiring

**Files:**
- Create: `src/index.ts`

No test for this file — it's pure command wiring. Subcommand handlers each have their own tests where they have logic.

- [ ] **Step 1: Write `src/index.ts`**

```ts
#!/usr/bin/env -S node --experimental-strip-types
import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runTweet } from './commands/tweet.js';
import { runList } from './commands/list.js';
import { runAdd } from './commands/add.js';
import { runRemove } from './commands/remove.js';
import { runStyle } from './commands/style.js';
import { runBanner } from './commands/banner.js';
import { runRefresh } from './commands/refresh.js';

const program = new Command();

program.name('postcommit').description('Drafts build-in-public tweets from your recent git commits.').version('0.1.0');

program.command('init').description('One-time setup: install shell hook, launchd, OpenAI key').action(runInit);
program.command('tweet').description('Draft a tweet from commits since your last one').action(runTweet);
program.command('list').description('Show tracked repos and pending commit counts').action(runList);
program.command('add <path>').description('Add a repo to track').action(runAdd);
program.command('remove <path>').description('Stop tracking a repo').action(runRemove);
program.command('style').description('Edit the AI voice prompt in $EDITOR').action(runStyle);
program.command('banner').description('Print the terminal banner (called by shell hook)').action(runBanner);
program.command('refresh').description('Refresh the cache from GitHub (called by launchd)').action(runRefresh);

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Create placeholder command files**

Each of `commands/init.ts`, `commands/tweet.ts`, `commands/list.ts`, `commands/add.ts`, `commands/remove.ts`, `commands/style.ts`, `commands/banner.ts`, `commands/refresh.ts` should exist with a stub export so typecheck passes. Tasks 11-17 will fill these in.

For each file, write:

```ts
// example: src/commands/banner.ts (replace name per file)
export async function runBanner(): Promise<void> {
  throw new Error('not yet implemented');
}
```

Use the function names: `runInit`, `runTweet`, `runList`, `runAdd`, `runRemove`, `runStyle`, `runBanner`, `runRefresh`. `runAdd` and `runRemove` take a single `path: string` parameter:

```ts
export async function runAdd(path: string): Promise<void> {
  throw new Error('not yet implemented');
}
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/commands/*.ts
git commit -m "Wire commander entry with command stubs"
```

---

## Task 11: `commands/banner.ts`

**Files:**
- Modify: `src/commands/banner.ts`

The banner is the most visible part of the product. It must be sub-50ms, silent on empty, and never throw.

- [ ] **Step 1: Replace `src/commands/banner.ts`**

```ts
import chalk from 'chalk';
import { readCache, type RepoCount } from '../lib/cache.js';

const ORANGE = '#d08770';
const ALIAS_FILE_LINE = `[ -f ${process.env.HOME ?? ''}/.postcommit/.alias ]`;

function ageString(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (days < 1) {
    const hrs = Math.floor((now - then) / (1000 * 60 * 60));
    return hrs <= 0 ? 'just now' : `${hrs}h ago`;
  }
  return `${days}d ago`;
}

function repoSummary(repos: RepoCount[]): string {
  const sorted = [...repos].filter((r) => r.pending > 0).sort((a, b) => b.pending - a.pending);
  const top = sorted.slice(0, 3).map((r) => `${r.displayName} (${r.pending})`).join(', ');
  const extra = sorted.length - 3;
  return extra > 0 ? `${top}, +${extra} more` : top;
}

function tweetCmd(): string {
  // If user installed the alias during init, we drop a sentinel file.
  // For MVP we just always show `tweet` — init asks first and we trust the user.
  return 'tweet';
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}

function renderBox(lines: string[]): string {
  const innerWidth = Math.max(...lines.map((l) => l.length));
  const horiz = '─'.repeat(innerWidth + 2);
  const top = chalk.hex(ORANGE)(`┌${horiz}┐`);
  const bottom = chalk.hex(ORANGE)(`└${horiz}┘`);
  const body = lines
    .map((l) => `${chalk.hex(ORANGE)('│')} ${pad(l, innerWidth)} ${chalk.hex(ORANGE)('│')}`)
    .join('\n');
  return `${top}\n${body}\n${bottom}`;
}

export async function runBanner(): Promise<void> {
  try {
    const cache = readCache();
    if (!cache || cache.totalPending <= 0) return;
    const line1 = `${cache.totalPending} commits · ${repoSummary(cache.byRepo)}`;
    const line2 = `${chalk.dim(`last tweet: ${ageString(cache.lastTweetedAt)}`)} · run ${chalk.green(`\`${tweetCmd()}\``)}`;
    process.stdout.write(`${renderBox([line1, line2])}\n`);
  } catch {
    // banner must never throw — silent failure preserves shell startup
  }
}

// silence unused-var warning for ALIAS_FILE_LINE — reserved for future alias-detection
void ALIAS_FILE_LINE;
```

Note: `tweetCmd()` is intentionally simple in MVP. Future work can sniff `~/.postcommit/.alias` to know whether to render `tweet` vs `postcommit tweet`. The reserved const is a forward hook.

- [ ] **Step 2: Verify typecheck and tests still pass**

Run: `bun run typecheck && bun run test`
Expected: 0 errors, all existing tests pass.

- [ ] **Step 3: Manual smoke test**

```bash
# Write a fake cache
mkdir -p ~/.postcommit
cat > ~/.postcommit/cache.json <<EOF
{"refreshedAt":"2026-05-12T09:00:00Z","totalPending":4,"byRepo":[{"displayName":"Ascend","pending":3},{"displayName":"Toasty","pending":1}],"lastTweetedAt":"2026-05-09T22:14:00Z"}
EOF
bun run dev banner
# Expected: orange-bordered box with "4 commits · Ascend (3), Toasty (1)" + "last tweet: 3d ago · run `tweet`"
rm ~/.postcommit/cache.json
bun run dev banner
# Expected: no output, exit 0
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/banner.ts
git commit -m "Implement banner command with box rendering"
```

---

## Task 12: `commands/list.ts`, `add.ts`, `remove.ts`

Three trivial command files batched as one task. Each reads from / writes to `lib/db`.

**Files:**
- Modify: `src/commands/list.ts`, `src/commands/add.ts`, `src/commands/remove.ts`

- [ ] **Step 1: Replace `src/commands/list.ts`**

```ts
import chalk from 'chalk';
import { listRepos } from '../lib/db.js';
import { readCache } from '../lib/cache.js';

export async function runList(): Promise<void> {
  const repos = listRepos();
  if (repos.length === 0) {
    console.log(chalk.dim('No repos tracked. Run `postcommit init` or `postcommit add <path>`.'));
    return;
  }
  const cache = readCache();
  const pending = new Map(cache?.byRepo.map((r) => [r.displayName, r.pending]) ?? []);
  for (const r of repos) {
    const count = pending.get(r.displayName) ?? 0;
    const countStr = count > 0 ? chalk.hex('#d08770')(`${count} pending`) : chalk.dim('up to date');
    console.log(`${chalk.bold(r.displayName)}  ${chalk.dim(r.githubSlug)}  ${countStr}`);
  }
}
```

- [ ] **Step 2: Replace `src/commands/add.ts`**

```ts
import { resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { addRepo } from '../lib/db.js';
import { getRepoSlugFromRemote, getHeadSha } from '../lib/github.js';

export async function runAdd(rawPath: string): Promise<void> {
  const path = resolve(rawPath);
  if (!existsSync(path)) {
    console.error(chalk.red(`No such directory: ${path}`));
    process.exit(1);
  }
  const slug = await getRepoSlugFromRemote(path);
  if (!slug) {
    console.error(chalk.red(`No GitHub remote found in ${path}`));
    process.exit(1);
  }
  const headSha = await getHeadSha(path);
  addRepo({
    path,
    githubSlug: slug,
    displayName: basename(path),
    lastTweetedSha: headSha,
  });
  console.log(chalk.green(`Added ${basename(path)} (${slug})`));
}
```

- [ ] **Step 3: Replace `src/commands/remove.ts`**

```ts
import { resolve } from 'node:path';
import chalk from 'chalk';
import { removeRepo } from '../lib/db.js';

export async function runRemove(rawPath: string): Promise<void> {
  const path = resolve(rawPath);
  removeRepo(path);
  console.log(chalk.green(`Removed ${path}`));
}
```

- [ ] **Step 4: Verify typecheck and tests**

Run: `bun run typecheck && bun run test`
Expected: 0 errors, all green.

- [ ] **Step 5: Commit**

```bash
git add src/commands/list.ts src/commands/add.ts src/commands/remove.ts
git commit -m "Implement list, add, remove commands"
```

---

## Task 13: `commands/style.ts`

**Files:**
- Modify: `src/commands/style.ts`

- [ ] **Step 1: Replace `src/commands/style.ts`**

```ts
import { execa } from 'execa';
import chalk from 'chalk';
import { writeDefaultStyle } from '../lib/style.js';
import { paths } from '../lib/paths.js';

export async function runStyle(): Promise<void> {
  writeDefaultStyle(); // creates the file with default content if it doesn't exist
  const editor = process.env.EDITOR ?? 'vi';
  console.log(chalk.dim(`Opening ${paths.styleFile()} in ${editor}...`));
  await execa(editor, [paths.styleFile()], { stdio: 'inherit' });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/style.ts
git commit -m "Implement style command opening style.txt in EDITOR"
```

---

## Task 14: `commands/refresh.ts`

**Files:**
- Modify: `src/commands/refresh.ts`

- [ ] **Step 1: Replace `src/commands/refresh.ts`**

```ts
import { listRepos } from '../lib/db.js';
import { countCommitsSince } from '../lib/github.js';
import { writeCache, type RepoCount } from '../lib/cache.js';

export async function runRefresh(): Promise<void> {
  const repos = listRepos();
  const byRepo: RepoCount[] = [];
  let total = 0;
  let mostRecentTweetAt: string | null = null;

  for (const r of repos) {
    const since = r.lastTweetedAt ?? new Date(0).toISOString();
    const count = await countCommitsSince(r.githubSlug, since);
    if (count > 0) byRepo.push({ displayName: r.displayName, pending: count });
    total += count;
    if (r.lastTweetedAt && (!mostRecentTweetAt || r.lastTweetedAt > mostRecentTweetAt)) {
      mostRecentTweetAt = r.lastTweetedAt;
    }
  }

  writeCache({
    refreshedAt: new Date().toISOString(),
    totalPending: total,
    byRepo,
    lastTweetedAt: mostRecentTweetAt,
  });
}
```

Note: refresh queries by `lastTweetedAt` (date), not `lastTweetedSha`. The `gh api commits?since=` filter accepts an ISO date and is simpler than walking commits by SHA. Slight imprecision (a commit at the exact `since` boundary may be excluded) is acceptable for MVP.

- [ ] **Step 2: Verify typecheck and tests**

Run: `bun run typecheck && bun run test`
Expected: 0 errors, all green.

- [ ] **Step 3: Commit**

```bash
git add src/commands/refresh.ts
git commit -m "Implement refresh command updating cache.json"
```

---

## Task 15: `commands/tweet.ts`

The main flow: refresh → fetch commits → draft → approve/edit/skip → clipboard → update DB.

**Files:**
- Modify: `src/commands/tweet.ts`

- [ ] **Step 1: Replace `src/commands/tweet.ts`**

```ts
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, readFileSync as rfs } from 'node:fs';
import chalk from 'chalk';
import enquirer from 'enquirer';
import { execa } from 'execa';
import { listRepos, updateLastTweetedSha, insertTweet } from '../lib/db.js';
import { fetchCommitsSince, type Commit } from '../lib/github.js';
import { draftTweet, type RepoInput } from '../lib/openai.js';
import { readStyle } from '../lib/style.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { paths } from '../lib/paths.js';
import { runRefresh } from './refresh.js';

function readApiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (!existsSync(paths.envFile())) {
    throw new Error('No OPENAI_API_KEY set and no ~/.postcommit/.env found. Run `postcommit init`.');
  }
  const env = readFileSync(paths.envFile(), 'utf8');
  const match = env.match(/^OPENAI_API_KEY=(.+)$/m);
  if (!match || !match[1]) throw new Error('OPENAI_API_KEY missing from ~/.postcommit/.env');
  return match[1].trim();
}

async function gatherCommits(): Promise<{
  repoInputs: RepoInput[];
  perRepoLatest: Map<string, { sha: string; at: string }>;
  daysSince: number;
}> {
  const repos = listRepos();
  const repoInputs: RepoInput[] = [];
  const perRepoLatest = new Map<string, { sha: string; at: string }>();
  let mostRecentTweetAt = 0;

  for (const r of repos) {
    if (r.lastTweetedAt) {
      mostRecentTweetAt = Math.max(mostRecentTweetAt, new Date(r.lastTweetedAt).getTime());
    }
    const since = r.lastTweetedAt ?? new Date(0).toISOString();
    const commits: Commit[] = await fetchCommitsSince(r.githubSlug, since);
    if (commits.length === 0) continue;
    repoInputs.push({ name: r.displayName, commits });
    const latest = commits[0];
    if (latest) perRepoLatest.set(r.path, { sha: latest.sha, at: latest.at });
  }

  const daysSince = mostRecentTweetAt
    ? Math.floor((Date.now() - mostRecentTweetAt) / (1000 * 60 * 60 * 24))
    : 0;

  return { repoInputs, perRepoLatest, daysSince };
}

async function editDraft(draft: string): Promise<string> {
  const editor = process.env.EDITOR ?? 'vi';
  const file = join(tmpdir(), `postcommit-${Date.now()}.txt`);
  writeFileSync(file, draft, 'utf8');
  await execa(editor, [file], { stdio: 'inherit' });
  return rfs(file, 'utf8').trim();
}

function commitAllRepos(perRepoLatest: Map<string, { sha: string; at: string }>): void {
  for (const [path, info] of perRepoLatest) {
    updateLastTweetedSha(path, info.sha, info.at);
  }
}

export async function runTweet(): Promise<void> {
  await runRefresh();
  const { repoInputs, perRepoLatest, daysSince } = await gatherCommits();

  if (repoInputs.length === 0) {
    console.log(chalk.dim('Nothing to tweet about — no new commits since your last tweet.'));
    return;
  }

  const apiKey = readApiKey();
  const systemPrompt = readStyle();
  console.log(chalk.dim('Drafting...'));
  const draft = await draftTweet({ apiKey, systemPrompt, repos: repoInputs, daysSinceLastTweet: daysSince });

  console.log('\n' + chalk.bold('Draft:'));
  console.log(draft);
  console.log();

  const { action } = await enquirer.prompt<{ action: 'approve' | 'edit' | 'skip' }>({
    type: 'select',
    name: 'action',
    message: 'What now?',
    choices: [
      { name: 'approve', message: '[a]pprove (copy to clipboard)' },
      { name: 'edit', message: '[e]dit in $EDITOR' },
      { name: 'skip', message: '[s]kip (advance SHA, no clipboard)' },
    ],
  });

  if (action === 'skip') {
    insertTweet({ draft, final: null, status: 'skipped', repos: repoInputs.map((r) => r.name) });
    commitAllRepos(perRepoLatest);
    console.log(chalk.dim('Skipped. Commits marked as seen.'));
    return;
  }

  const final = action === 'edit' ? await editDraft(draft) : draft;
  await copyToClipboard(final);
  insertTweet({
    draft,
    final,
    status: action === 'edit' ? 'edited' : 'approved',
    repos: repoInputs.map((r) => r.name),
  });
  commitAllRepos(perRepoLatest);
  console.log(chalk.green('Copied to clipboard. Paste into x.com.'));
}
```

- [ ] **Step 2: Verify typecheck and tests**

Run: `bun run typecheck && bun run test`
Expected: 0 errors, all existing tests still green.

- [ ] **Step 3: Commit**

```bash
git add src/commands/tweet.ts
git commit -m "Implement tweet command (refresh, draft, approve/edit/skip flow)"
```

---

## Task 16: `commands/init.ts`

The orchestrator. Idempotent end-to-end.

**Files:**
- Modify: `src/commands/init.ts`

- [ ] **Step 1: Replace `src/commands/init.ts`**

```ts
import { readdirSync, statSync, existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import enquirer from 'enquirer';
import { openDb, addRepo } from '../lib/db.js';
import { getRepoSlugFromRemote, getHeadSha } from '../lib/github.js';
import { writeDefaultStyle } from '../lib/style.js';
import { installShellHook, installAlias, installLaunchdPlist } from '../lib/hooks.js';
import { paths } from '../lib/paths.js';
import { runRefresh } from './refresh.js';

interface Candidate {
  path: string;
  slug: string;
  displayName: string;
}

async function discoverRepos(): Promise<Candidate[]> {
  const projectsDir = join(homedir(), 'Projects');
  if (!existsSync(projectsDir)) return [];
  const entries = readdirSync(projectsDir);
  const candidates: Candidate[] = [];
  for (const name of entries) {
    const path = join(projectsDir, name);
    try {
      if (!statSync(path).isDirectory()) continue;
      if (!existsSync(join(path, '.git'))) continue;
    } catch { continue; }
    const slug = await getRepoSlugFromRemote(path);
    if (!slug) continue;
    candidates.push({ path, slug, displayName: name });
  }
  return candidates;
}

async function promptApiKey(): Promise<string> {
  if (process.env.OPENAI_API_KEY) {
    console.log(chalk.dim('Using OPENAI_API_KEY from environment.'));
    return process.env.OPENAI_API_KEY;
  }
  const { key } = await enquirer.prompt<{ key: string }>({
    type: 'password',
    name: 'key',
    message: 'OpenAI API key (sk-...):',
  });
  return key.trim();
}

function writeEnvFile(apiKey: string): void {
  mkdirSync(paths.configDir(), { recursive: true });
  writeFileSync(paths.envFile(), `OPENAI_API_KEY=${apiKey}\n`, 'utf8');
  chmodSync(paths.envFile(), 0o600);
}

async function promptRepoSelection(candidates: Candidate[]): Promise<Candidate[]> {
  if (candidates.length === 0) {
    console.log(chalk.dim('No GitHub repos found under ~/Projects. You can `postcommit add <path>` later.'));
    return [];
  }
  const { selected } = await enquirer.prompt<{ selected: string[] }>({
    type: 'multiselect',
    name: 'selected',
    message: 'Which repos should PostCommit track?',
    choices: candidates.map((c) => ({ name: c.path, message: `${c.displayName}  (${c.slug})` })),
    initial: candidates.map((_, i) => i),
  });
  return candidates.filter((c) => selected.includes(c.path));
}

async function promptAlias(): Promise<boolean> {
  const { yes } = await enquirer.prompt<{ yes: boolean }>({
    type: 'confirm',
    name: 'yes',
    message: "Install shell alias `tweet='postcommit tweet'`?",
    initial: true,
  });
  return yes;
}

export async function runInit(): Promise<void> {
  console.log(chalk.bold('PostCommit setup'));

  mkdirSync(paths.configDir(), { recursive: true });

  const apiKey = await promptApiKey();
  writeEnvFile(apiKey);
  console.log(chalk.green('✓ Saved OpenAI key'));

  openDb(); // ensures schema

  const candidates = await discoverRepos();
  const selected = await promptRepoSelection(candidates);
  for (const c of selected) {
    const head = await getHeadSha(c.path);
    addRepo({ path: c.path, githubSlug: c.slug, displayName: c.displayName, lastTweetedSha: head });
  }
  console.log(chalk.green(`✓ Tracking ${selected.length} repo${selected.length === 1 ? '' : 's'}`));

  writeDefaultStyle();
  console.log(chalk.green('✓ Default style.txt written'));

  installShellHook();
  console.log(chalk.green('✓ Shell hook installed (~/.zshrc)'));

  await installLaunchdPlist();
  console.log(chalk.green('✓ launchd plist installed (refresh every 15 min)'));

  if (await promptAlias()) {
    installAlias();
    console.log(chalk.green("✓ Shell alias `tweet` installed"));
  }

  await runRefresh();
  console.log(chalk.green('✓ Cache seeded'));

  console.log();
  console.log(chalk.bold('Done.'));
  console.log(`Open a new terminal tab — the banner stays silent until you push commits.`);
  console.log(`Run ${chalk.green('`tweet`')} (or ${chalk.green('`postcommit tweet`')}) when you're ready.`);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/init.ts
git commit -m "Implement init command (full orchestrator, idempotent)"
```

---

## Task 17: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# postcommit

Drafts build-in-public tweets from your recent git commits. Lives in your terminal so you actually use it.

## Install

```bash
git clone https://github.com/<you>/postcommit
cd postcommit
bun install
bun link
postcommit init
```

Requires Node 22+, macOS, zsh, and the [`gh` CLI](https://cli.github.com) authenticated to your GitHub account.

## What it does

Open a new terminal tab → if you've pushed commits since your last tweet, a one-line banner shows up:

```
┌─ tweet queue ─────────────────────────┐
│  4 commits · Ascend (3), Toasty (1)   │
│  last tweet: 3d ago · run `tweet`     │
└───────────────────────────────────────┘
```

Run `tweet`. It pulls your commits, drafts a tweet via GPT-4o-mini, asks `[a]pprove / [e]dit / [s]kip`. Approve copies it to your clipboard. Paste into x.com.

## Commands

- `postcommit init` — one-time setup
- `postcommit tweet` — draft from new commits
- `postcommit list` — show tracked repos and pending counts
- `postcommit add <path>` — track a new repo
- `postcommit remove <path>` — stop tracking
- `postcommit style` — edit the AI voice prompt
- `postcommit refresh` — re-pull commits (auto-runs every 15 min via launchd)

## Configuration

All state lives in `~/.postcommit/`:
- `state.db` — SQLite (tracked repos, tweet history)
- `cache.json` — latest commit counts (banner reads this)
- `style.txt` — AI system prompt (edit with `postcommit style`)
- `.env` — your OpenAI API key (mode 0600)
- `hook.zsh` — sourced from `~/.zshrc`

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.enzo.postcommit.refresh.plist
rm ~/Library/LaunchAgents/com.enzo.postcommit.refresh.plist
rm -rf ~/.postcommit
# remove the source line + alias from ~/.zshrc manually
bun unlink
```

## Development

```bash
bun run test         # vitest
bun run typecheck    # tsc --noEmit
bun run lint         # oxlint
bun run dev <cmd>    # tsx src/index.ts <cmd>
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add README"
```

---

## Task 18: End-to-end smoke + acceptance check

**Files:** none modified — this is a manual verification pass against spec section 11.

- [ ] **Step 1: Fresh install on this machine**

```bash
cd /Users/enzovarela/Projects/postcommit
bun install
bun link
postcommit init
```

Expected: prompts walk through, exits with "Done."

- [ ] **Step 2: Verify silent state**

```bash
# Open a new Ghostty tab — should look normal, no banner
```

- [ ] **Step 3: Verify banner after push**

```bash
# In another tracked repo (e.g., Ascend), make a commit and push:
cd ~/Projects/Ascend
git commit --allow-empty -m "smoke test commit for postcommit"
git push
# Wait up to 15 minutes (or run `postcommit refresh` manually)
postcommit refresh
# Open a new Ghostty tab — orange banner should appear
```

- [ ] **Step 4: Verify tweet flow**

```bash
tweet
# Expected: drafts a tweet, asks approve/edit/skip
# Choose approve, check clipboard with `pbpaste`
# Open a new tab — banner should be gone
```

- [ ] **Step 5: Verify run-all-tests**

```bash
bun run test
bun run typecheck
bun run lint
```

Expected: all green.

- [ ] **Step 6: Tag the MVP**

```bash
git tag v0.1.0-mvp
git log --oneline | head -20
```

After this, the 14-day dogfood window begins (per spec section 11, criterion 6). The work is done — usage is the real test.

---

## Self-Review

This is a quick checklist run after writing the plan. Issues found and resolved inline:

**1. Spec coverage:**
- Section 2.1 banner — Task 11 ✓
- Section 2.2 tweet flow — Task 15 ✓
- Section 3.1 every command — Tasks 11-16 ✓
- Section 4 stack — Task 1 ✓
- Section 5 data model — Tasks 3 (db) and 4 (cache) ✓
- Section 6 banner behavior (silent, truncation, failure) — Task 11 (silent + truncation), 14 (refresh failure) ✓
- Section 7 AI voice + default prompt — Task 8 (style) + Task 6 (openai) ✓
- Section 8 init flow steps 1-12 — Task 16 ✓
- Section 9 repo structure — Task 1 + Task 10 ✓
- Section 11 acceptance criteria — Task 18 ✓

**2. Placeholder scan:** No TBDs, no "TODO later", no "implement appropriately." All code blocks contain real code.

**3. Type consistency:**
- `Repo` shape (db.ts) — used in list.ts ✓
- `Cache` shape (cache.ts) — used in banner.ts, refresh.ts ✓
- `Commit` shape (github.ts) — used in openai.ts, tweet.ts ✓
- `RepoInput` (openai.ts) — used in tweet.ts ✓
- Function names: `runInit`, `runTweet`, `runList`, `runAdd`, `runRemove`, `runStyle`, `runBanner`, `runRefresh` — consistent in index.ts and command files ✓
- `addRepo` / `removeRepo` / `listRepos` / `updateLastTweetedSha` — consistent across db.ts, tests, commands ✓
- `HOOK_SOURCE_LINE`, `ALIAS_LINE` exports — referenced in tests, used in init.ts indirectly via installAlias/installShellHook ✓
