import { describe, it, expect, mock, beforeEach } from 'bun:test';

const execaMock = mock(() => Promise.resolve({ stdout: '' } as never));
mock.module('execa', () => ({ execa: execaMock }));

import { execa } from 'execa';
import {
  countCommitsSince,
  fetchCommitsSince,
  getRepoSlugFromRemote,
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

  it('getRepoSlugFromRemote parses ssh + https remotes', async () => {
    execaMock.mockResolvedValueOnce({
      stdout: 'origin\tgit@github.com:enzo/ascend.git (fetch)\norigin\tgit@github.com:enzo/ascend.git (push)',
    } as never);
    expect(await getRepoSlugFromRemote('/p/ascend')).toBe('enzo/ascend');

    execaMock.mockResolvedValueOnce({
      stdout: 'origin\thttps://github.com/enzo/ascend.git (fetch)',
    } as never);
    expect(await getRepoSlugFromRemote('/p/ascend')).toBe('enzo/ascend');
  });

  it('getRepoSlugFromRemote returns null for non-GitHub remotes', async () => {
    execaMock.mockResolvedValueOnce({
      stdout: 'origin\tgit@gitlab.com:enzo/ascend.git (fetch)',
    } as never);
    expect(await getRepoSlugFromRemote('/p/ascend')).toBeNull();
  });
});
