import { describe, it, expect, mock, beforeEach } from 'bun:test';

const createMock = mock(() => Promise.resolve({ choices: [{ message: { content: '' } }] } as never));

mock.module('openai', () => ({
  default: mock(() => ({
    chat: { completions: { create: createMock } },
  })),
}));

import { draftTweet } from '../../src/lib/openai.js';

beforeEach(() => createMock.mockReset());

describe('openai', () => {
  it('passes system prompt + commits JSON and returns draft text', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'shipped paywall on ascend today  ' } }],
    } as never);
    const out = await draftTweet({
      apiKey: 'sk-x',
      systemPrompt: 'be casual',
      repos: [
        {
          name: 'Ascend',
          commits: [{ sha: 'a', message: 'add paywall', at: '2026-05-11T18:42:00Z' }],
        },
      ],
      daysSinceLastTweet: 3,
    });
    expect(out).toBe('shipped paywall on ascend today');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 100,
        messages: [
          { role: 'system', content: 'be casual' },
          expect.objectContaining({ role: 'user' }),
        ],
      }),
    );
    // bun:test mock.calls is a tuple — cast through unknown to access runtime shape
    const callArg = (createMock.mock.calls[0] as unknown as [Record<string, unknown>])[0]!;
    const userJson = JSON.parse((callArg['messages'] as Array<{ content: string }>)[1]!.content);
    expect(userJson.repos[0].name).toBe('Ascend');
    expect(userJson.days_since_last_tweet).toBe(3);
  });

  it('throws when OpenAI returns empty content', async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: null } }] } as never);
    await expect(
      draftTweet({
        apiKey: 'sk-x',
        systemPrompt: 's',
        repos: [],
        daysSinceLastTweet: 0,
      }),
    ).rejects.toThrow(/empty/i);
  });
});
