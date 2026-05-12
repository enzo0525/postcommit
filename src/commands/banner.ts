import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { readCache, type RepoCount } from '../lib/cache.js';
import { paths } from '../lib/paths.js';

const ORANGE = '#d08770';

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
  return existsSync(join(paths.configDir(), '.alias')) ? 'tweet' : 'postcommit tweet';
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


