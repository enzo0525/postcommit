import OpenAI from 'openai';
import type { Commit } from './github.js';

export interface RepoInput {
  name: string;
  commits: Commit[];
}

export interface DraftRequest {
  apiKey: string;
  systemPrompt: string;
  repos: RepoInput[];
  daysSinceLastTweet: number;
}

export async function draftTweet(req: DraftRequest): Promise<string> {
  const client = new OpenAI({ apiKey: req.apiKey });
  const userPayload = {
    repos: req.repos.map((r) => ({
      name: r.name,
      commits: r.commits.map((c) => ({ sha: c.sha, message: c.message, at: c.at })),
    })),
    days_since_last_tweet: req.daysSinceLastTweet,
  };
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    max_tokens: 100,
    messages: [
      { role: 'system', content: req.systemPrompt },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
  });
  const text = completion.choices[0]?.message.content;
  if (!text || text.trim().length === 0) {
    throw new Error('OpenAI returned empty content');
  }
  return text.trim();
}
