---
name: address-review
description: The author's turn after an AI review. Reads the newest ai-review on one pull request, fixes what it can test-first at the file and line each finding names, leaves what it disagrees with, stops on what only the ticket can answer, then one commit and one push so the reviewer runs again. Never posts, comments, approves, merges or closes anything. Only when invoked with a pull request number, e.g. /address-review #18.
argument-hint: "#<pull request number>"
disable-model-invocation: true
---

The invocation names a pull request, `#N`. If there is no number, ask for one and stop.

You are the author's agent, working the findings of a review that a cold reviewer wrote with the `review-pr` skill. You fix what the review is right about, you leave what it is wrong about with one sentence of reasoning, and you stop on what only the ticket can answer. You never argue in the pull request thread. The human does that, by hand, with your report in front of them.

## Before anything else

1. `gh pr view N --json title,url,headRefName,headRefOid,body,reviews`. From the body, the ticket is the issue referenced by `Closes #T` (or `Fixes`, `Resolves`).
2. The review is the newest entry in `reviews` whose body contains `<!-- ai-review -->`. If there is none, say "no AI review on #N yet", point at `gh run list --workflow ai-review.yml`, and stop.
3. The review's footer names the commit it reviewed: `reviewed commit <sha>`. If that is not `headRefOid`, a push happened after this review and a fresher one is on its way or failed. Say which commit the review is about and which the branch is at, and stop. Do not fix findings about code that may have changed.
4. State, on four lines: the PR title, the branch, the ticket number and title, the reviewed commit. The human checks the number was right before you edit anything.
5. The working tree must be clean. If it is not, say so and stop. If you are on another branch, `gh pr checkout N`. Then `git pull`.
6. `gh issue view T` for the ticket, in full. Its criteria and its `Seams:` line decide the hard cases below.

## Triage every finding

Walk the Findings list and the **not found** rows of the Criteria table. Every one lands in exactly one of three places:

- **Fixed.** You changed code or the pull request body so the finding no longer holds.
- **Left.** You disagree, with the file and line that shows why, in one sentence. Only a **Should fix** can be left, or a **not found** row whose test exists (see below). A **Blocker** is never left.
- **Needs the ticket.** The finding can't be settled without a decision the ticket should have made. You make no guess.

Rules by kind of finding:

- **A `not found` row.** Decide by looking, not by the review's word. Find the seam the ticket's `Seams:` line names for that criterion. If a test is there and asserts the criterion's observable outcome, the reviewer missed it: **Left**, with the test's file and line. If no such test exists, write it, test-first, at that seam, with the `tdd` skill, and make it pass: **Fixed**. If the ticket names no seam for the criterion, or the criterion can be read two ways: **Needs the ticket**, and say what the ticket should have said.
- **A Standards or Security finding.** Fix it at the file and line named, and no further. A Security finding is always fixed. If the fix needs a change the `AGENTS.md` rules don't settle, **Needs the ticket**.
- **A Test adequacy finding.** Make the test prove the criterion: the real seam, the observable outcome, no `skip`, no mock of the thing under test. **Fixed**.
- **An Evidence finding.** The pull request body is yours; the `pr` skill wrote it. Rewrite the Evidence section so a reviewer who was not in the room could run the `Demo:` line from it alone, and update it with `gh pr edit N --body-file`. Never change the `Closes` line. **Fixed**.
- **A Merge danger finding.** Usually information for the human, not a fix. Fix it only when it names a concrete defect, such as a migration that can't apply on a fresh database. Otherwise **Left**, one sentence.
- **A finding that cites a rule `AGENTS.md` does not contain.** **Left**. The fix is in `review-pr/SKILL.md`, and that is the human's edit, not yours.

Change nothing the findings don't name. No refactors, no style passes, no second `code-review`: the reviewer in CI reviews the push.

## Finish

1. `pnpm check` and `pnpm format` must pass.
2. One commit for the whole set, with `#T` in the message and one line per finding fixed, so the next review's "what changed since" sentence has something to read. Then one push. One push is one review; don't push twice.
3. Report, in the terminal, and nowhere else:

```
Fixed:
- <severity> <file:line>: <what changed>
Left:
- <severity> <file:line>: <why>
Needs the ticket:
- <criterion or finding>: <what the ticket should say>
Pushed <sha> to <branch>. The AI review runs again on it.
```

You never post this report, never comment on, approve, request changes on, merge or close the pull request, and never close the ticket or tick its boxes. A refusal from a tool is final: report it under Left and carry on.
