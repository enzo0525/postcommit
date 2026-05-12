import { listRepos, addRepo, listExcludedSlugs } from '../lib/db.js';
import {
  countCommitsSince,
  listUserGitHubRepos,
  getAuthedUserLogin,
  getLatestCommitSha,
} from '../lib/github.js';
import { writeCache, type RepoCount } from '../lib/cache.js';

async function discoverNewRepos(): Promise<void> {
  const authedLogin = await getAuthedUserLogin();
  if (!authedLogin) return; // gh not authed — silently skip discovery
  const ghRepos = await listUserGitHubRepos();
  if (ghRepos.length === 0) return;

  const tracked = new Set(listRepos().map((r) => r.slug));
  const excluded = new Set(listExcludedSlugs());

  for (const r of ghRepos) {
    if (r.ownerLogin !== authedLogin) continue; // skip org repos
    if (r.isFork) continue;
    if (r.isArchived) continue;
    if (tracked.has(r.slug)) continue;
    if (excluded.has(r.slug)) continue;
    const head = await getLatestCommitSha(r.slug);
    addRepo({ slug: r.slug, displayName: r.displayName, lastTweetedSha: head });
  }
}

export async function runRefresh(): Promise<void> {
  await discoverNewRepos();

  const repos = listRepos();
  const byRepo: RepoCount[] = [];
  let total = 0;
  let mostRecentTweetAt: string | null = null;

  for (const r of repos) {
    const since = r.lastTweetedAt ?? new Date(0).toISOString();
    const count = await countCommitsSince(r.slug, since);
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
