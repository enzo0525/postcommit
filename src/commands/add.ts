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
