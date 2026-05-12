import { resolve } from 'node:path';
import chalk from 'chalk';
import { removeRepo } from '../lib/db.js';

export async function runRemove(rawPath: string): Promise<void> {
  const path = resolve(rawPath);
  removeRepo(path);
  console.log(chalk.green(`Removed ${path}`));
}
