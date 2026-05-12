import chalk from 'chalk';
import enquirer from 'enquirer';
import { listRepos, addRepo, removeRepo } from '../lib/db.js';
import {
  listUserGitHubRepos,
  getLatestCommitSha,
  type GitHubRepo,
} from '../lib/github.js';

function buildChoices(repos: GitHubRepo[], trackedSet: Set<string>): {
  choices: Array<{ name: string; message: string }>;
  initial: number[];
} {
  const initial: number[] = [];
  repos.forEach((r, i) => { if (trackedSet.has(r.slug)) initial.push(i); });
  const choices = repos.map((r) => ({
    name: r.slug,
    message: `${r.displayName.padEnd(28)} ${chalk.dim(r.slug)} ${chalk.dim(`· pushed ${r.pushedAt.slice(0, 10)}`)}`,
  }));
  return { choices, initial };
}

export async function runEdit(): Promise<void> {
  console.log(chalk.dim('Fetching your GitHub repos...'));
  const ghRepos = (await listUserGitHubRepos()).filter((r) => !r.isFork);
  if (ghRepos.length === 0) {
    console.error(chalk.red('No GitHub repos found. Are you logged in with `gh auth login`?'));
    process.exit(1);
  }

  const tracked = listRepos();
  const trackedSet = new Set(tracked.map((r) => r.slug));
  const { choices, initial } = buildChoices(ghRepos, trackedSet);

  const { selected } = await enquirer.prompt<{ selected: string[] }>({
    type: 'multiselect',
    name: 'selected',
    message: `Toggle tracking (${tracked.length} currently active; space to toggle, enter to save)`,
    choices,
    initial: initial as unknown as number,
  } as Parameters<typeof enquirer.prompt>[0]);

  const selectedSet = new Set(selected);
  let activated = 0;
  let deactivated = 0;

  // Newly activated: in selectedSet but not in trackedSet → addRepo (clears exclusion too)
  for (const r of ghRepos) {
    if (selectedSet.has(r.slug) && !trackedSet.has(r.slug)) {
      const head = await getLatestCommitSha(r.slug);
      addRepo({ slug: r.slug, displayName: r.displayName, lastTweetedSha: head });
      activated++;
    }
  }

  // Newly deactivated: in trackedSet but not in selectedSet → removeRepo (which excludes)
  for (const slug of trackedSet) {
    if (!selectedSet.has(slug)) {
      removeRepo(slug);
      deactivated++;
    }
  }

  const totalActive = selected.length;
  const changes = activated + deactivated;
  const changesNote = changes > 0
    ? chalk.dim(` (${activated} activated, ${deactivated} deactivated)`)
    : chalk.dim(' (no changes)');
  console.log(chalk.green(`✓ ${totalActive} tracked${changesNote}`));
}
