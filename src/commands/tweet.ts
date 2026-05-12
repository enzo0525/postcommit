import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  if (process.env['OPENAI_API_KEY']) return process.env['OPENAI_API_KEY'];
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
    const commits: Commit[] = await fetchCommitsSince(r.slug, since);
    if (commits.length === 0) continue;
    repoInputs.push({ name: r.displayName, commits });
    const latest = commits[0];
    if (latest) perRepoLatest.set(r.slug, { sha: latest.sha, at: latest.at });
  }

  const daysSince = mostRecentTweetAt
    ? Math.floor((Date.now() - mostRecentTweetAt) / (1000 * 60 * 60 * 24))
    : 0;

  return { repoInputs, perRepoLatest, daysSince };
}

async function editDraft(draft: string): Promise<string> {
  const editor = process.env['EDITOR'] ?? 'vi';
  const file = join(tmpdir(), `postcommit-${Date.now()}.txt`);
  writeFileSync(file, draft, 'utf8');
  await execa(editor, [file], { stdio: 'inherit' });
  return readFileSync(file, 'utf8').trim();
}

function commitAllRepos(perRepoLatest: Map<string, { sha: string; at: string }>): void {
  for (const [slug, info] of perRepoLatest) {
    updateLastTweetedSha(slug, info.sha, info.at);
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
    await runRefresh();
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
  await runRefresh();
  console.log(chalk.green('Copied to clipboard. Paste into x.com.'));
}
