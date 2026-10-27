Implement ticket ${1} unattended. Read `.kiro/skills/implement-ticket/SKILL.md` and follow it, with these three changes, because nobody is at the keyboard:

- Seams: the ticket's `Seams:` line is the user's answer. State the seams you will test at, then continue without waiting.
- Questions: if the ticket is ambiguous, do not ask and do not guess. Stop, and say what the ticket should have said.
- Branch: you are already on the ticket's branch. Stay on it.

Everything else in the skill applies: `${1}` in every commit message, `pnpm check` and `pnpm format` before the last commit, review against `main` after committing, push, a pull request against `main` with `Closes ${1}` in the body using the `pr` skill, and never close the ticket or tick its boxes. End with the pull request URL.
