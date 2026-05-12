# postcommit

Drafts build-in-public tweets from your recent git commits. Lives in your terminal so you actually use it.

## Install

```bash
git clone https://github.com/<you>/postcommit
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
│  4 commits · Ascend (3), Toasty (1)   │
│  last tweet: 3d ago · run `tweet`     │
└───────────────────────────────────────┘
```

Run `tweet`. It pulls your commits, drafts a tweet via GPT-4o-mini, asks `[a]pprove / [e]dit / [s]kip`. Approve copies it to your clipboard. Paste into x.com.

## Commands

- `postcommit init` — one-time setup
- `postcommit tweet` — draft from new commits
- `postcommit list` — show tracked repos and pending counts
- `postcommit add <path>` — track a new repo
- `postcommit remove <path>` — stop tracking
- `postcommit style` — edit the AI voice prompt
- `postcommit refresh` — re-pull commits (auto-runs every 15 min via launchd)

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
bun run test         # vitest
bun run typecheck    # tsc --noEmit
bun run lint         # oxlint
bun run dev <cmd>    # tsx src/index.ts <cmd>
```
