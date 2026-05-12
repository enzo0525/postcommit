import { readdirSync, statSync, existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import enquirer from 'enquirer';
import { openDb, addRepo } from '../lib/db.js';
import { getRepoSlugFromRemote, getHeadSha } from '../lib/github.js';
import { writeDefaultStyle } from '../lib/style.js';
import { installShellHook, installAlias, installLaunchdPlist } from '../lib/hooks.js';
import { paths } from '../lib/paths.js';
import { runRefresh } from './refresh.js';

interface Candidate {
  path: string;
  slug: string;
  displayName: string;
}

async function discoverRepos(): Promise<Candidate[]> {
  const projectsDir = join(homedir(), 'Projects');
  if (!existsSync(projectsDir)) return [];
  const entries = readdirSync(projectsDir);
  const candidates: Candidate[] = [];
  for (const name of entries) {
    const path = join(projectsDir, name);
    try {
      if (!statSync(path).isDirectory()) continue;
      if (!existsSync(join(path, '.git'))) continue;
    } catch { continue; }
    const slug = await getRepoSlugFromRemote(path);
    if (!slug) continue;
    candidates.push({ path, slug, displayName: name });
  }
  return candidates;
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

async function promptRepoSelection(candidates: Candidate[]): Promise<Candidate[]> {
  if (candidates.length === 0) {
    console.log(chalk.dim('No GitHub repos found under ~/Projects. You can `postcommit add <path>` later.'));
    return [];
  }
  const { selected } = await enquirer.prompt<{ selected: string[] }>({
    type: 'multiselect',
    name: 'selected',
    message: 'Which repos should PostCommit track?',
    choices: candidates.map((c) => ({ name: c.path, message: `${c.displayName}  (${c.slug})` })),
    // enquirer accepts number[] for multiselect initial at runtime; cast needed due to type definition gap
    initial: candidates.map((_, i) => i) as unknown as number,
  } as Parameters<typeof enquirer.prompt>[0]);
  return candidates.filter((c) => selected.includes(c.path));
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

  const candidates = await discoverRepos();
  const selected = await promptRepoSelection(candidates);
  for (const c of selected) {
    const head = await getHeadSha(c.path);
    addRepo({ path: c.path, githubSlug: c.slug, displayName: c.displayName, lastTweetedSha: head });
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
