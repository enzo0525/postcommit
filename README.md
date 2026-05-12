# postcommit

Drafts build-in-public tweets from your recent git commits. Lives in your terminal so you actually use it.

## Install

```bash
git clone https://github.com/enzo0525/postcommit
cd postcommit
bun install
bun link
postcommit init
```

Requires Node 22+, macOS, zsh, and the [`gh` CLI](https://cli.github.com) authenticated to your GitHub account.

## What it does

Open a new terminal tab — if you've pushed commits since your last tweet, a one-line banner shows up:

```
┌─ tweet queue ─────────────────────────┐
│ toasty-app (3)                        │
│ ascnd-web (2)                         │
│ portfolio (1)                         │
│ last tweet: 3d ago · run `tweet`      │
└───────────────────────────────────────┘
```

Run `tweet`. It pulls your commits, drafts a tweet via GPT-4o-mini, asks `[a]pprove / [e]dit / [s]kip`. Approve copies it to your clipboard. Paste into x.com.

## Commands

- `postcommit init` — one-time setup
- `postcommit tweet` — draft from new commits
- `postcommit list` — show tracked repos and pending counts
- `postcommit add <slug>` — track a new repo (e.g. enzo0525/toasty-app)
- `postcommit remove <slug>` — stop tracking (e.g. enzo0525/toasty-app)
- `postcommit style` — edit the AI voice prompt
- `postcommit refresh` — re-pull commits and auto-discover new GitHub repos owned by you (auto-runs every 15 min via launchd; skips forks, archived repos, and anything you previously removed)

## Configuration

All state lives in `~/.postcommit/`:
- `state.db` — SQLite (tracked repos, tweet history)
- `cache.json` — latest commit counts (banner reads this)
- `style.txt` — AI system prompt (edit with `postcommit style`)
- `.env` — your OpenAI API key (mode 0600)
- `hook.zsh` — sourced from `~/.zshrc`

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.enzo.postcommit.refresh.plist
rm ~/Library/LaunchAgents/com.enzo.postcommit.refresh.plist
rm -rf ~/.postcommit
# remove the source line + alias from ~/.zshrc manually
bun unlink
```

## Development

```bash
bun test             # bun's built-in test runner
bun run typecheck    # tsc --noEmit
bun run lint         # oxlint
bun run dev <cmd>    # bun src/index.ts <cmd>
```
