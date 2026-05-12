#!/usr/bin/env -S node --experimental-strip-types
import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runTweet } from './commands/tweet.js';
import { runList } from './commands/list.js';
import { runAdd } from './commands/add.js';
import { runRemove } from './commands/remove.js';
import { runStyle } from './commands/style.js';
import { runBanner } from './commands/banner.js';
import { runRefresh } from './commands/refresh.js';

const program = new Command();

program.name('postcommit').description('Drafts build-in-public tweets from your recent git commits.').version('0.1.0');

program.command('init').description('One-time setup: install shell hook, launchd, OpenAI key').action(runInit);
program.command('tweet').description('Draft a tweet from commits since your last one').action(runTweet);
program.command('list').description('Show tracked repos and pending commit counts').action(runList);
program.command('add <path>').description('Add a repo to track').action(runAdd);
program.command('remove <path>').description('Stop tracking a repo').action(runRemove);
program.command('style').description('Edit the AI voice prompt in $EDITOR').action(runStyle);
program.command('banner').description('Print the terminal banner (called by shell hook)').action(runBanner);
program.command('refresh').description('Refresh the cache from GitHub (called by launchd)').action(runRefresh);

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
