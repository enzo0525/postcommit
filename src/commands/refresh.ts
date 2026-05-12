import { listRepos } from '../lib/db.js';
import { countCommitsSince } from '../lib/github.js';
import { writeCache, type RepoCount } from '../lib/cache.js';

export async function runRefresh(): Promise<void> {
  const repos = listRepos();
  const byRepo: RepoCount[] = [];
  let total = 0;
  let mostRecentTweetAt: string | null = null;

  for (const r of repos) {
    const since = r.lastTweetedAt ?? new Date(0).toISOString();
    const count = await countCommitsSince(r.githubSlug, since);
    if (count > 0) byRepo.push({ displayName: r.displayName, pending: count });
    total += count;
    if (r.lastTweetedAt && (!mostRecentTweetAt || r.lastTweetedAt > mostRecentTweetAt)) {
      mostRecentTweetAt = r.lastTweetedAt;
    }
  }

  writeCache({
    refreshedAt: new Date().toISOString(),
    totalPending: total,
    byRepo,
    lastTweetedAt: mostRecentTweetAt,
  });
}
