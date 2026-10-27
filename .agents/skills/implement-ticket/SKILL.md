---
name: implement-ticket
description: One turn of the implement loop on a GitHub ticket, with this repository's rules on top of the implement skill - TDD at agreed seams, pnpm check, commit, review against main, push, pull request. Only when the user invokes it with a ticket number, e.g. /implement-ticket #16.
argument-hint: "#<ticket number>"
disable-model-invocation: true
---

The user typed a ticket reference after the command, for example `/implement-ticket #16`. That reference is `#N` below. If there is no reference, ask for one and stop.

Call the `implement` skill with `#N` (Claude Code: the Skill tool; Kiro and Codex: read its `SKILL.md` and follow it). It fetches the ticket from the tracker and states its title, builds with the `tdd` skill at agreed seams, runs `code-review`, and commits.

For this repository, on top of that skill:

- Stay on the current branch. Commit as you go, with `#N` in every message.
- Before the first test, show the seams you will test at and wait for the user's yes.
- If the ticket has a `Demo:` line, the last seam is a Playwright test in `apps/e2e` that walks that line, written with the `write-e2e` skill. Run `pnpm e2e` before the last commit. If Chromium is not installed on this machine, say so in the PR body's Evidence section and let the `e2e` check in CI run it; do not install system packages.
- `pnpm check` and `pnpm format` must pass before the last commit.
- Review after committing, not before: run `code-review` with `main` as the fixed point, fix what it finds, commit again.
- Then push the branch and open a pull request against `main` with `Closes #N` in the body. Use the `pr` skill for the body.
- Don't close the ticket or tick its boxes. The pull request does that when it merges.

End with the pull request URL.
