# claude-mods

> Personal Claude Code mods that turn my working rules into hooks.

Each folder is one mod (a Claude Code hooks module). The repository is also a plugin
marketplace, so each mod installs with one line.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## Background

Rules written in `CLAUDE.md` or a memory note are text Claude reads and can miss. A mod
runs in the Claude Code engine and checks every tool call, so a rule holds in every
session. Most mods here enforce one rule and leave a way out when the rule is wrong for
the case at hand.

## Install

At the prompt of a terminal session, one line per mod:

```
/plugin install <mod> --marketplace agopalareddy/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every
session). From a shell:

```bash
claude plugin install <mod> --marketplace agopalareddy/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then
Plugins, Add marketplace with `agopalareddy/claude-mods`, then Add plugin.

After a push to this repository, refresh installed mods with
`claude plugin marketplace update claude-mods`.

This repository is private. Installing needs read access on GitHub and a git credential
for github.com on the machine (an SSH key, or `gh auth login` then `gh auth setup-git`);
the install never prompts for one.

`readme-keeper` also needs its linter, installed once:

```bash
npm i --prefix ~/.cache/readme-keeper remark-cli@12 standard-readme-preset
```

## Usage

Each mod works on its own once installed. Replace `<mod>` above with its name.

| Mod | What it does | Way out |
| --- | --- | --- |
| `no-ai-trailer` | Refuses a `git commit` whose message has an AI co-author trailer (Claude, Copilot, Cursor and others). Human co-authors pass. | None; remove the trailer. A `-F <file>` message is not checked. |
| `native-edits` | Refuses file edits through Bash (`sed -i`, `perl -pi`, `> file`, `tee file`, `open(..., 'w')`) so edits go through the Edit and Write tools. | After Edit or Write fails twice on a file, Bash may edit it until the next successful edit. |
| `voice-check` | Refuses outgoing email, chat messages and `gh pr`/`gh issue` text that uses words from an AI-writing blacklist, listing each word with a plainer one. | Send the same text again unchanged and it goes through. |
| `readme-keeper` | After a commit, asks Claude to update a `README.md` that has not changed in 5 commits; lints any README Claude edits against [standard-readme](https://github.com/RichardLitt/standard-readme). | Asks once per repository per session. |
| `repo-context` | Shows `git: <branch>` in the status line (`*` when the work tree has changes), a git pane (`/git`) to switch branch, pull, push and fetch, with changed files and recent commits, and a band above the prompt when the session is not in a git repository. | Not a guard. |
| `memory-reminders` | Shows a band above the prompt for each `remind: YYYY-MM-DD text` line in `~/.claude/projects/*/memory/*.md` that is due. | "Hide for this session" button. |

Each mod has tests: `claude plugin test <mod>`.

## Maintainers

[@agopalareddy](https://github.com/agopalareddy)

## Contributing

This is a personal repository and does not take outside contributions. To change a mod,
edit it, run `claude plugin test <mod>` and `claude plugin validate <mod>`, then commit
with a Conventional Commits message scoped to the mod, for example
`fix(native-edits): catch dd of=`.

## License

© 2026 Aadarsha Gopala Reddy. All rights reserved.
