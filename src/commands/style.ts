import { execa } from 'execa';
import chalk from 'chalk';
import { writeDefaultStyle } from '../lib/style.js';
import { paths } from '../lib/paths.js';

export async function runStyle(): Promise<void> {
  writeDefaultStyle(); // creates the file with default content if it doesn't exist
  const editor = process.env['EDITOR'] ?? 'vi';
  console.log(chalk.dim(`Opening ${paths.styleFile()} in ${editor}...`));
  await execa(editor, [paths.styleFile()], { stdio: 'inherit' });
}
