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
