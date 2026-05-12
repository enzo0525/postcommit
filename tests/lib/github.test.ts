import { describe, it, expect, mock, beforeEach } from 'bun:test';

const execaMock = mock(() => Promise.resolve({ stdout: '' } as never));
mock.module('execa', () => ({ execa: execaMock }));

import { execa } from 'execa';
import {
  countCommitsSince,
  fetchCommitsSince,
  getAuthedUserLogin,
  listUserGitHubRepos,
  getLatestCommitSha,
  type Commit,
} from '../../src/lib/github.js';

beforeEach(() => {
  execaMock.mockReset();
});

describe('github', () => {
  it('countCommitsSince returns array length from gh api response', async () => {
    execaMock.mockResolvedValueOnce({
      stdout: JSON.stringify([{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }]),
    } as never);
    const n = await countCommitsSince('enzo/ascend', '2026-05-10T00:00:00Z');
    expect(n).toBe(3);
    expect(execa).toHaveBeenCalledWith('gh', [
      'api',
      '-X', 'GET',
      'repos/enzo/ascend/commits',
      '-f', 'since=2026-05-10T00:00:00Z',
    ]);
  });

  it('countCommitsSince returns 0 on gh failure', async () => {
    execaMock.mockRejectedValueOnce(new Error('rate limit'));
    const n = await countCommitsSince('enzo/ascend', '2026-05-10T00:00:00Z');
    expect(n).toBe(0);
  });

  it('fetchCommitsSince returns typed commits', async () => {
    execaMock.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          sha: 'abc123',
          commit: { message: 'add paywall', author: { date: '2026-05-11T18:42:00Z' } },
        },
      ]),
    } as never);
    const commits = await fetchCommitsSince('enzo/ascend', '2026-05-10T00:00:00Z');
    expect(commits).toEqual<Commit[]>([
      { sha: 'abc123', message: 'add paywall', at: '2026-05-11T18:42:00Z' },
    ]);
  });

  it('listUserGitHubRepos parses a single JSON array response', async () => {
    execaMock.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          full_name: 'enzo0525/toasty-app',
          name: 'toasty-app',
          owner: { login: 'enzo0525' },
          pushed_at: '2026-05-11T12:00:00Z',
          fork: false,
        },
      ]),
    } as never);
    const repos = await listUserGitHubRepos();
    expect(repos).toEqual([
      {
        slug: 'enzo0525/toasty-app',
        displayName: 'toasty-app',
        ownerLogin: 'enzo0525',
        pushedAt: '2026-05-11T12:00:00Z',
        isFork: false,
      },
    ]);
  });

  it('listUserGitHubRepos parses concatenated arrays from --paginate', async () => {
    execaMock.mockResolvedValueOnce({
      stdout:
        `[{"full_name":"enzo0525/a","name":"a","owner":{"login":"enzo0525"},"pushed_at":"2026-01-01T00:00:00Z","fork":false}]` +
        `[{"full_name":"enzo0525/b","name":"b","owner":{"login":"enzo0525"},"pushed_at":"2026-02-01T00:00:00Z","fork":false}]`,
    } as never);
    const repos = await listUserGitHubRepos();
    expect(repos.map((r) => r.slug)).toEqual(['enzo0525/a', 'enzo0525/b']);
  });

  it('listUserGitHubRepos returns [] on gh failure', async () => {
    execaMock.mockRejectedValueOnce(new Error('gh not authed'));
    const repos = await listUserGitHubRepos();
    expect(repos).toEqual([]);
  });

  it('getAuthedUserLogin returns trimmed login', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'enzo0525\n' } as never);
    expect(await getAuthedUserLogin()).toBe('enzo0525');
  });

  it('getLatestCommitSha returns commit SHA', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'abc123def\n' } as never);
    expect(await getLatestCommitSha('enzo0525/toasty-app')).toBe('abc123def');
  });
});
