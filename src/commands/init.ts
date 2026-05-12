import { writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import chalk from 'chalk';
import enquirer from 'enquirer';
import { openDb, addRepo } from '../lib/db.js';
import {
  getAuthedUserLogin,
  listUserGitHubRepos,
  getLatestCommitSha,
  type GitHubRepo,
} from '../lib/github.js';
import { writeDefaultStyle } from '../lib/style.js';
import { installShellHook, installAlias, installLaunchdPlist } from '../lib/hooks.js';
import { paths } from '../lib/paths.js';
import { runRefresh } from './refresh.js';

async function discoverFromGitHub(authedLogin: string | null): Promise<{
  repos: GitHubRepo[];
  defaultSelected: GitHubRepo[];
}> {
  const all = await listUserGitHubRepos();
  const nonFork = all.filter((r) => !r.isFork);
  const defaultSelected = authedLogin
    ? nonFork.filter((r) => r.ownerLogin === authedLogin)
    : nonFork;
  return { repos: nonFork, defaultSelected };
}

async function promptApiKey(): Promise<string> {
  if (process.env['OPENAI_API_KEY']) {
    console.log(chalk.dim('Using OPENAI_API_KEY from environment.'));
    return process.env['OPENAI_API_KEY'];
  }
  const { key } = await enquirer.prompt<{ key: string }>({
    type: 'password',
    name: 'key',
    message: 'OpenAI API key (sk-...):',
  });
  return key.trim();
}

function writeEnvFile(apiKey: string): void {
  mkdirSync(paths.configDir(), { recursive: true });
  writeFileSync(paths.envFile(), `OPENAI_API_KEY=${apiKey}\n`, 'utf8');
  chmodSync(paths.envFile(), 0o600);
}

async function promptRepoSelection(
  repos: GitHubRepo[],
  defaultSelected: GitHubRepo[],
): Promise<GitHubRepo[]> {
  if (repos.length === 0) {
    console.log(chalk.dim(
      'No GitHub repos found via `gh api user/repos`. Are you logged in with `gh auth login`?',
    ));
    return [];
  }
  const defaultSet = new Set(defaultSelected.map((r) => r.slug));
  const initial: number[] = [];
  repos.forEach((r, i) => { if (defaultSet.has(r.slug)) initial.push(i); });
  const { selected } = await enquirer.prompt<{ selected: string[] }>({
    type: 'multiselect',
    name: 'selected',
    message: `Which repos should PostCommit track? (${defaultSelected.length}/${repos.length} pre-selected; space to toggle, enter to confirm)`,
    choices: repos.map((r) => ({
      name: r.slug,
      message: `${r.displayName.padEnd(28)} ${chalk.dim(r.slug)} ${chalk.dim(`· pushed ${r.pushedAt.slice(0, 10)}`)}`,
    })),
    initial: initial as unknown as number,
  } as Parameters<typeof enquirer.prompt>[0]);
  return repos.filter((r) => selected.includes(r.slug));
}

async function promptAlias(): Promise<boolean> {
  const { yes } = await enquirer.prompt<{ yes: boolean }>({
    type: 'confirm',
    name: 'yes',
    message: "Install shell alias `tweet='postcommit tweet'`?",
    initial: true,
  });
  return yes;
}

export async function runInit(): Promise<void> {
  console.log(chalk.bold('PostCommit setup'));

  mkdirSync(paths.configDir(), { recursive: true });

  const apiKey = await promptApiKey();
  writeEnvFile(apiKey);
  console.log(chalk.green('✓ Saved OpenAI key'));

  openDb(); // ensures schema

  console.log(chalk.dim('Fetching your GitHub repos...'));
  const authedLogin = await getAuthedUserLogin();
  if (!authedLogin) {
    console.error(chalk.red('GitHub CLI not authenticated. Run `gh auth login` and try again.'));
    process.exit(1);
  }
  console.log(chalk.dim(`Authenticated as ${authedLogin}.`));

  const { repos: ghRepos, defaultSelected } = await discoverFromGitHub(authedLogin);
  const selected = await promptRepoSelection(ghRepos, defaultSelected);
  for (const r of selected) {
    const head = await getLatestCommitSha(r.slug);
    addRepo({ slug: r.slug, displayName: r.displayName, lastTweetedSha: head });
  }
  console.log(chalk.green(`✓ Tracking ${selected.length} repo${selected.length === 1 ? '' : 's'}`));

  writeDefaultStyle();
  console.log(chalk.green('✓ Default style.txt written'));

  installShellHook();
  console.log(chalk.green('✓ Shell hook installed (~/.zshrc)'));

  await installLaunchdPlist();
  console.log(chalk.green('✓ launchd plist installed (refresh every 15 min)'));

  if (await promptAlias()) {
    installAlias();
    console.log(chalk.green("✓ Shell alias `tweet` installed"));
  }

  await runRefresh();
  console.log(chalk.green('✓ Cache seeded'));

  console.log();
  console.log(chalk.bold('Done.'));
  console.log(`Open a new terminal tab — the banner stays silent until you push commits.`);
  console.log(`Run ${chalk.green('`tweet`')} (or ${chalk.green('`postcommit tweet`')}) when you're ready.`);
}
