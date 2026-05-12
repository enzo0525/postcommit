import { homedir } from 'node:os';
import { join } from 'node:path';

let _home = homedir();

export function setHome(h: string): void {
  _home = h;
}

export const paths = {
  home: () => _home,
  configDir: () => join(_home, '.postcommit'),
  dbFile: () => join(_home, '.postcommit', 'state.db'),
  cacheFile: () => join(_home, '.postcommit', 'cache.json'),
  styleFile: () => join(_home, '.postcommit', 'style.txt'),
  envFile: () => join(_home, '.postcommit', '.env'),
  hookFile: () => join(_home, '.postcommit', 'hook.zsh'),
  zshrc: () => join(_home, '.zshrc'),
  plistFile: () => join(_home, 'Library', 'LaunchAgents', 'com.enzo.postcommit.refresh.plist'),
};
