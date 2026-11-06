# claude-mods

Personal Claude Code mods (hooks modules), one folder per mod. The repository is
also a plugin marketplace, so each mod installs with one line.

## Mods

### no-ai-trailer

Refuses any `git commit` run through Claude's Bash tool when the message carries an
AI co-author trailer (`Co-Authored-By: Claude`, Copilot, Cursor and similar). Human
co-authors pass. A message given with `git commit -F <file>` is not checked.

## Install

At the prompt of a terminal session:

```
/plugin install no-ai-trailer --marketplace agopalareddy/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install no-ai-trailer --marketplace agopalareddy/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then
Plugins, Add marketplace with `agopalareddy/claude-mods`, then Add plugin.

This repository is private. Installing needs read access on GitHub and a git credential
for github.com on the machine (an SSH key, or `gh auth login` then `gh auth setup-git`);
the install never prompts for one.
