# claude-mods

Personal Claude Code mods (hooks modules), one folder per mod. The repository is
also a plugin marketplace, so each mod installs with one line.

## Mods

### no-ai-trailer

Refuses any `git commit` run through Claude's Bash tool when the message carries an
AI co-author trailer (`Co-Authored-By: Claude`, Copilot, Cursor and similar). Human
co-authors pass. A message given with `git commit -F <file>` is not checked.

### repo-context

Shows the current git branch in the status line (`git: main`, with `*` when the work
tree has changes), and a yellow band above the prompt when the session's folder is not
inside a git repository. Refreshes at session start and after each turn.

### native-edits

Refuses file edits made through Bash (`sed -i`, `perl -pi`, `> file`, `>> file`,
`tee file`, `open(..., 'w')` in a script) so Claude uses its Edit and Write tools.
When Edit or Write fails twice on the same file, Bash may edit that file until the
next successful Edit or Write on it. Matching is by regex over the command text, not
a shell parser, so some writes (`dd of=`, `cp`, `mv`) are not caught.

## Install

At the prompt of a terminal session, one line per mod:

```
/plugin install no-ai-trailer --marketplace agopalareddy/claude-mods
/plugin install repo-context --marketplace agopalareddy/claude-mods
/plugin install native-edits --marketplace agopalareddy/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install no-ai-trailer --marketplace agopalareddy/claude-mods
claude plugin install repo-context --marketplace agopalareddy/claude-mods
claude plugin install native-edits --marketplace agopalareddy/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then
Plugins, Add marketplace with `agopalareddy/claude-mods`, then Add plugin.

This repository is private. Installing needs read access on GitHub and a git credential
for github.com on the machine (an SSH key, or `gh auth login` then `gh auth setup-git`);
the install never prompts for one.
