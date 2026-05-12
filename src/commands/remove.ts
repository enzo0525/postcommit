import chalk from 'chalk';
import { removeRepo } from '../lib/db.js';

export async function runRemove(slug: string): Promise<void> {
  const changes = removeRepo(slug);
  if (changes === 0) {
    console.log(chalk.dim(`No tracked repo with slug ${slug}`));
    return;
  }
  console.log(chalk.green(`Removed ${slug}`));
}
