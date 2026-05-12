# PostCommit — Design Spec

**Date:** 2026-05-12
**Status:** MVP — single-user (the author), no monetization yet
**Goal:** A CLI + shell-hook tool that drafts build-in-public tweets from your recent git commits, ambushed into a terminal banner so you don't forget to ship the tweet.

---

## 1. The pain

The author ships iOS apps (Toasty, Ascend, HairMaxxing, larpmaxxing) and follows indie makers like Marc Lou who get to $70-80k/month largely through Twitter distribution. The author has the work but not the tweets. Two compounding problems:

1. **Forgetting.** The author wants to tweet about what he's shipping but loses the thread of "what did I actually do today" by the time he sits down to post.
2. **Cold-start cost.** Drafting a tweet from scratch is too much friction at the end of a long coding day — easier to just close the laptop.

PostCommit collapses both: the terminal banner makes forgetting hard, and the AI draft eliminates the blank page.

## 2. What it does

### 2.1 Shell-hook banner

Every new zsh tab calls `postcommit banner`. It reads from a local cache. If there are commits since the user's last tweet, it prints a one-shot orange-bordered box above the prompt:

```
┌─ tweet queue ─────────────────────────┐
│  4 commits · Ascend (3), Toasty (1)   │
│  last tweet: 3d ago · run `tweet`     │
└───────────────────────────────────────┘
```

If there's nothing pending, the banner exits silently — no output, terminal looks normal. The banner is one banner per session, not per command — it does not re-print after every keystroke.

(`tweet` shown above assumes the user accepted the optional shell alias during `init`; otherwise the banner shows `run \`postcommit tweet\``.)

### 2.2 The `postcommit tweet` flow

User runs `postcommit tweet`. The CLI:

1. Refreshes its cache from GitHub (pulls commits since each repo's `last_tweeted_sha`)
2. Calls OpenAI `gpt-4o-mini` once with the collected commits + the user's style prompt
3. Prints the draft to the terminal
4. Asks: `[a]pprove / [e]dit / [s]kip`
   - **approve:** copies draft to clipboard via `pbcopy`, updates `last_tweeted_sha` per repo, banner clears
   - **edit:** opens the draft in `$EDITOR`; on save, copies edited version to clipboard, updates `last_tweeted_sha`
   - **skip:** marks commits as seen (advances `last_tweeted_sha`) but does not copy anything; useful for "this batch isn't tweet-worthy"

The clipboard copy is the MVP integration with X — the user pastes into x.com themselves. Direct X API posting is explicitly out of scope.

## 3. Scope

### 3.1 In MVP

- `postcommit init` — one-time setup
- `postcommit tweet` — the main flow described above
- `postcommit list` — show tracked repos and pending commit counts
- `postcommit add <path>` / `postcommit remove <path>` — manage tracked repos (`add` sets `last_tweeted_sha` to the repo's current `HEAD`, so newly added repos don't backfill historical commits)
- `postcommit style` — open the system prompt in `$EDITOR`
- `postcommit banner` — internal; called by the shell hook
- `postcommit refresh` — internal; called by launchd every 15 min
- Shell hook installation into `~/.zshrc`
- Local SQLite at `~/.postcommit/state.db`
- Cache file at `~/.postcommit/cache.json`
- Style prompt at `~/.postcommit/style.txt`
- launchd plist for background refresh

### 3.2 Out of MVP

These are deferred until the author has actually used the tool for 2+ weeks and confirmed it sticks. Premature build = wasted work.

- Direct posting to X via API (clipboard only for now)
- RevenueCat / Vercel / Stripe / Superwall event sources (commits-only)
- Tweet queue, scheduling, drafts library
- Web dashboard
- Multi-user, payments, packaging for resale
- Notifications outside the terminal (push, SMS, email)
- Cross-shell support (bash, fish) — zsh only
- Cross-OS support (Linux) — macOS only (launchd, pbcopy, Ghostty user)
- Multi-account GitHub
- Analytics on which drafts get approved vs skipped

## 4. Stack

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node 22 + TypeScript (ESM) | Author's daily stack; zero learning tax |
| CLI parsing | `commander` | Smallest viable; mature |
| Terminal colors | `chalk` | Standard; supports ANSI 256 |
| Prompts | `enquirer` | Approve/edit/skip menu, clean DX |
| Local DB | `better-sqlite3` | Synchronous, zero infra, single file |
| GitHub access | `gh` CLI via `execa` | User is already authenticated; no OAuth dance |
| AI | OpenAI `gpt-4o-mini` via `openai` SDK | Cheap (sub-cent per draft), fast |
| Clipboard | `pbcopy` via `execa` | Native macOS, no dep |
| Local install | `bun link` for now | Single-developer install; Homebrew comes later |

No webserver. No background daemon (launchd handles refresh). No auth flow (gh CLI handles it).

## 5. Data model

SQLite database at `~/.postcommit/state.db`:

```sql
CREATE TABLE repos (
  path           TEXT PRIMARY KEY,    -- absolute path to local checkout
  github_slug    TEXT NOT NULL,       -- "enzo/ascend"
  display_name   TEXT NOT NULL,       -- "Ascend"
  last_tweeted_sha TEXT,              -- nullable on first add
  last_tweeted_at TEXT,               -- ISO8601, nullable
  added_at       TEXT NOT NULL
);

CREATE TABLE tweets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  draft        TEXT NOT NULL,
  final        TEXT,                  -- post-edit version; null on skip
  status       TEXT NOT NULL,         -- 'approved' | 'edited' | 'skipped'
  repos_json   TEXT NOT NULL,         -- JSON array of repo slugs included
  created_at   TEXT NOT NULL
);
```

Cache file at `~/.postcommit/cache.json` (rewritten by `postcommit refresh`):

```json
{
  "refreshed_at": "2026-05-12T09:18:42Z",
  "total_pending": 4,
  "by_repo": [
    { "display_name": "Ascend", "pending": 3 },
    { "display_name": "Toasty", "pending": 1 }
  ],
  "last_tweeted_at": "2026-05-09T22:14:00Z"
}
```

Banner reads only `cache.json`. Never touches GitHub or SQLite — keeps it sub-50ms.

Style file at `~/.postcommit/style.txt` is a flat text file (no JSON, no schema). Default content lives in section 7.

## 6. Banner behavior

- **Install:** `postcommit init` writes `~/.postcommit/hook.zsh` containing one line: `command -v postcommit >/dev/null && postcommit banner 2>/dev/null`. It then appends `[ -f ~/.postcommit/hook.zsh ] && source ~/.postcommit/hook.zsh` to `~/.zshrc` (idempotent — checks for existing line first).
- **Trigger:** every new zsh session calls `postcommit banner`.
- **Read path:** banner reads `~/.postcommit/cache.json`. If absent or `total_pending == 0`, exits silently with code 0 and no output.
- **Output:** orange-bordered box rendered with chalk's `hex('#d08770')`. Adapts width to `process.stdout.columns` (default 40 cols if undetectable). If more than 3 repos have pending commits, banner shows the top 3 by count and appends `+N more` (e.g. `Ascend (5), Toasty (3), HairMaxxing (2), +2 more`).
- **Refresh:** a launchd plist installed during `init` (`com.enzo.postcommit.refresh.plist`) runs `postcommit refresh` every 900 seconds. Refresh queries `gh api repos/<slug>/commits?since=<last_tweeted_at>&sha=main` for each tracked repo, counts commits, rewrites `cache.json`.
- **`postcommit tweet`** forces an inline refresh before drafting — banner is approximate, `tweet` is authoritative.
- **Failure:** if the cache is stale or refresh errored, banner shows last-known state. Banner never throws, never prints stderr — silent failure on the user-facing side.

## 7. AI voice — default prompt

`~/.postcommit/style.txt` ships with this content. User can edit anytime via `postcommit style`.

```
You are drafting a single tweet for an indie maker building in public.

Input: a list of git commits with messages, repos, and timestamps.
Output: ONE tweet, max 240 chars, that reads like a real human shipped real work.

Rules:
- Mention the project name once if it's recognizable
- Refer to specific things you shipped — not "shipped some stuff"
- Casual voice, lowercase OK, no corporate-speak
- Zero hashtags, max 1 emoji
- End with an open thought, a number, or a question — never "stay tuned"
- If commits look like noise (typos, lint), pick the meatiest 2-3 and ignore the rest
```

System prompt = the contents of `style.txt`. User message = a JSON blob of commits:

```json
{
  "repos": [
    {
      "name": "Ascend",
      "commits": [
        { "sha": "abc123", "message": "add hairline scoring V2", "at": "2026-05-11T18:42:00Z" }
      ]
    }
  ],
  "days_since_last_tweet": 3
}
```

Model: `gpt-4o-mini`. Temperature: 0.7. Max tokens: 100.

## 8. `postcommit init` flow

1. Creates `~/.postcommit/` if missing
2. Prompts for OpenAI API key (or reads from `$OPENAI_API_KEY` if set)
3. Writes the key to `~/.postcommit/.env` (mode 0600)
4. Scans `~/Projects/*` for directories containing `.git/`; for each, reads `git remote -v` and keeps the ones with `github.com` remotes
5. Shows the list and asks which to track (multi-select via enquirer, all selected by default)
6. Inserts selected repos into the `repos` table with `last_tweeted_sha = HEAD` (so the first run only counts NEW commits after install)
7. Writes default `style.txt`
8. Installs `~/.postcommit/hook.zsh` and appends source line to `~/.zshrc`
9. Installs `~/Library/LaunchAgents/com.enzo.postcommit.refresh.plist` and loads it via `launchctl load`
10. Asks: *"Want a shell alias `tweet='postcommit tweet'` so you can just type `tweet`?"* (default yes) — if yes, appends to `~/.zshrc`
11. Runs `postcommit refresh` once to seed the cache
12. Prints a success message with next-steps

Idempotent: running `init` twice does not duplicate hooks, source lines, or launchd entries.

## 9. Repository structure

```
postcommit/
  package.json
  tsconfig.json
  src/
    index.ts              # commander entry, dispatches subcommands
    commands/
      init.ts
      tweet.ts
      list.ts
      add.ts
      remove.ts
      style.ts
      banner.ts
      refresh.ts
    lib/
      db.ts               # better-sqlite3 wrapper
      cache.ts            # cache.json read/write
      github.ts           # gh CLI wrapper via execa
      openai.ts           # draft generator
      hooks.ts            # zshrc + launchd installers
      clipboard.ts        # pbcopy wrapper
  docs/
    superpowers/
      specs/
        2026-05-12-postcommit-design.md
  README.md
  .gitignore
```

## 10. Open questions / explicit non-decisions

- **Pricing:** not addressed. MVP is single-user (the author). Pricing decision waits until usage is proven and there's a story to tell on X.
- **Branding:** "PostCommit" is the working name. Domain availability not checked.
- **Telemetry:** none in MVP. No usage data collected, anonymous or otherwise.
- **Tests:** unit tests for `lib/` modules (db, cache, github wrapper). No e2e tests in MVP — the surface is small and the author is the sole tester.

## 11. Acceptance criteria

The MVP is done when:

1. After cloning the repo and running `bun install && bun link`, the author runs `postcommit init`, follows prompts, and lands on a working install in under 2 minutes.
2. Opening a new Ghostty tab shows the silent state immediately after install (cache is empty → no banner).
3. After a `git push` to a tracked repo, within 15 minutes the next new tab shows the orange banner with correct commit count.
4. Running `tweet` (or `postcommit tweet`) drafts a tweet that's coherent, under 240 chars, references actual commit content, and copies to clipboard on approve.
5. After approve, the next new tab is silent again.
6. The tool runs for 14 consecutive days during which the author tweets at least 5 build-in-public posts using it.

If criterion 6 fails, the project is shelved (per the author's own self-aware "I would never use my own products" admission). Dogfooding success is the only proof of fit.
