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

export interface GitHubRepo {
  slug: string;
  displayName: string;
  ownerLogin: string;
  pushedAt: string;
  isFork: boolean;
  isArchived: boolean;
}

interface GhApiRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  pushed_at: string;
  fork: boolean;
  archived: boolean;
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

export async function getAuthedUserLogin(): Promise<string | null> {
  try {
    const { stdout } = await execa('gh', ['api', 'user', '-q', '.login']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function listUserGitHubRepos(): Promise<GitHubRepo[]> {
  try {
    const { stdout } = await execa('gh', [
      'api',
      '--paginate',
      '-X', 'GET',
      'user/repos',
      '-f', 'per_page=100',
      '-f', 'sort=pushed',
      '-f', 'direction=desc',
    ]);
    const parsed = parseConcatenatedJson(stdout);
    return parsed.map((r): GitHubRepo => ({
      slug: r.full_name,
      displayName: r.name,
      ownerLogin: r.owner.login,
      pushedAt: r.pushed_at,
      isFork: r.fork,
      isArchived: r.archived,
    }));
  } catch {
    return [];
  }
}

function parseConcatenatedJson(s: string): GhApiRepo[] {
  // gh --paginate emits multiple JSON arrays back-to-back. Find each top-level array boundary
  // and concatenate. Simple approach: greedy split on `][` insertion point.
  const trimmed = s.trim();
  if (!trimmed) return [];
  try { return JSON.parse(trimmed) as GhApiRepo[]; } catch { /* fall through */ }
  // Concatenated arrays: replace `][` with `,`
  const merged = trimmed.replace(/\]\s*\[/g, ',');
  try { return JSON.parse(merged) as GhApiRepo[]; } catch { return []; }
}

export async function getLatestCommitSha(slug: string): Promise<string | null> {
  try {
    const { stdout } = await execa('gh', [
      'api',
      `repos/${slug}/commits`,
      '-f', 'per_page=1',
      '-q', '.[0].sha',
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
