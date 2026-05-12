import { resolve } from 'node:path';
import chalk from 'chalk';
import { removeRepo } from '../lib/db.js';

export async function runRemove(rawPath: string): Promise<void> {
  const path = resolve(rawPath);
  const changes = removeRepo(path);
  if (changes === 0) {
    console.log(chalk.dim(`No tracked repo at ${path}`));
    return;
  }
  console.log(chalk.green(`Removed ${path}`));
}
