import chalk from 'chalk';
import { listRepos } from '../lib/db.js';
import { readCache } from '../lib/cache.js';

export async function runList(): Promise<void> {
  const repos = listRepos();
  if (repos.length === 0) {
    console.log(chalk.dim('No repos tracked. Run `postcommit init` or `postcommit add <slug>`.'));
    return;
  }
  const cache = readCache();
  const pending = new Map(cache?.byRepo.map((r) => [r.displayName, r.pending]) ?? []);
  for (const r of repos) {
    const count = pending.get(r.displayName) ?? 0;
    const countStr = count > 0 ? chalk.hex('#d08770')(`${count} pending`) : chalk.dim('up to date');
    console.log(`${chalk.bold(r.displayName)}  ${chalk.dim(r.slug)}  ${countStr}`);
  }
}
