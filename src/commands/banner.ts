import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { readCache } from '../lib/cache.js';
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

function tweetCmd(): string {
  return existsSync(join(paths.configDir(), '.alias')) ? 'tweet' : 'postcommit tweet';
}

function visibleLength(s: string): number {
  // oxlint-disable-next-line no-control-regex -- intentional: strip ANSI SGR escape sequences
  return s.replace(/\[[0-9;]*m/g, '').length;
}

function pad(text: string, width: number): string {
  const vis = visibleLength(text);
  if (vis >= width) return text;
  return text + ' '.repeat(width - vis);
}

function renderBox(title: string, bodyLines: string[]): string {
  const titleSpace = ` ${title} `;
  const innerWidth = Math.max(
    ...bodyLines.map(visibleLength),
    visibleLength(titleSpace) + 2 - 2,
  );
  // Top border: ┌─ title ────────┐
  const topRemaining = innerWidth + 2 - visibleLength(titleSpace) - 1;
  const top = chalk.hex(ORANGE)(`┌─${titleSpace}${'─'.repeat(Math.max(0, topRemaining))}┐`);
  const bottom = chalk.hex(ORANGE)(`└${'─'.repeat(innerWidth + 2)}┘`);
  const body = bodyLines
    .map((l) => `${chalk.hex(ORANGE)('│')} ${pad(l, innerWidth)} ${chalk.hex(ORANGE)('│')}`)
    .join('\n');
  return `${top}\n${body}\n${bottom}`;
}

export async function runBanner(): Promise<void> {
  try {
    const cache = readCache();
    if (!cache || cache.totalPending <= 0) return;

    const sorted = [...cache.byRepo]
      .filter((r) => r.pending > 0)
      .sort((a, b) => b.pending - a.pending);
    const top = sorted.slice(0, 5);
    const extra = sorted.length - top.length;

    const repoLines = top.map((r) => `${r.displayName} (${r.pending})`);
    if (extra > 0) repoLines.push(chalk.dim(`+${extra} more`));

    const footer = `${chalk.dim(`last tweet: ${ageString(cache.lastTweetedAt)}`)} · run ${chalk.green(`\`${tweetCmd()}\``)}`;

    process.stdout.write(`${renderBox('tweet queue', [...repoLines, footer])}\n`);
  } catch {
    // banner must never throw — silent failure preserves shell startup
  }
}


