import chalk from 'chalk';
import { addRepo } from '../lib/db.js';
import { getLatestCommitSha } from '../lib/github.js';

export async function runAdd(slug: string): Promise<void> {
  if (!/^[\w-]+\/[\w.-]+$/.test(slug)) {
    console.error(chalk.red(
      `Invalid slug: ${slug}. Expected format: owner/repo (e.g. enzo0525/toasty-app)`,
    ));
    process.exit(1);
  }
  const head = await getLatestCommitSha(slug);
  if (head === null) {
    console.error(chalk.red(
      `Could not fetch ${slug} from GitHub. Check the slug or run \`gh auth status\`.`,
    ));
    process.exit(1);
  }
  addRepo({ slug, displayName: slug.split('/')[1] ?? slug, lastTweetedSha: head });
  console.log(chalk.green(`Added ${slug}`));
}
