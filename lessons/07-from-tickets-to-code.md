# Lesson 7: From tickets to code: one turn of the implement loop

**Time:** about 45–60 minutes
**Goal:** take the first unblocked ticket from lesson 4, have an agent build it in a fresh context window, and end with a pull request that you and CI have proven and a human reviewer can merge.

By the end of this lesson you should be able to answer three questions:

1. Why does the agent get one ticket, in a fresh window, and nothing else?
2. What does the `implement` skill do, and what does the loop around it have to do?
3. What is your job in each turn, and why does the loop pause before the merge?

Lesson 4 ended with a spec and 15 to 25 tickets on your fork, each a vertical slice with the TOR requirements it covers, the seams it is tested at, and the tickets that block it. Lesson 5 put a guard hook between the agent and the shell, and lesson 6 explained the sub-agents you are about to see at work. This lesson spends one of the tickets. The point is not the ticket. The point is the loop around it, because the same loop runs for every ticket on the board.

---

## 1. The loop, and why a human is in it

![The implement loop as a cycle of eight steps. Top row, left to right: query the frontier, the open tickets with no open blockers; create a branch by hand; run /implement-ticket with the ticket number in a fresh window, where the agent confirms seams, does red-green TDD, reviews and commits; the agent pushes and opens a pull request. Bottom row, right to left: you do the demo line, read the diff against the criteria, tick the boxes and wait for CI; merge, greyed and marked after class, after a reviewer who is not the author has looked; the ticket closes and the dependency gate opens, also greyed; clear the conversation. An arrow runs from clear back to the frontier query. A note in the middle says: state lives in git and on GitHub, never in the conversation.](images/implement-loop.svg)

Lesson 2 made the case: an agent that has read the TOR, explored the codebase and built two features is deep in the dumb zone before the third one starts. So every ticket gets a fresh window, and nothing the agent needs may live only in a previous conversation. That is why lesson 4 put the decisions in a spec issue, the work in tickets, and the order in dependency edges. The conversation is disposable. Git and GitHub are the state.

The skill that does the building is `implement`, installed in lesson 4. Open `.kiro/skills/implement/SKILL.md`. It is seven lines. Paraphrased:

1. Fetch the ticket from the tracker and state its title before starting. Ask if the reference is ambiguous.
2. Call the `tdd` skill where possible, at pre-agreed seams.
3. Typecheck regularly, run single test files regularly, run the full suite once at the end.
4. Call the `code-review` skill.
5. Commit to the current branch.

Read what it does **not** say. It does not create a branch. It does not open a pull request. It does not close the ticket, tick its boxes, or move anything on the board. It does not look for the next ticket. Matt Pocock's own page on the skill says it "never touches the work item". Everything outside those seven lines is the loop, and the loop is your job: find the frontier, make the branch, start the run, prove the result, and clear.

One more file sits next to it: `.agents/skills/implement-ticket/SKILL.md`, this repository's own. It calls `implement` with the ticket and adds the six rules the loop needs that the skill doesn't carry: commit first and review against `main`, push and open the pull request, never touch the ticket. Section 4 reads it line by line. What you type is `/implement-ticket` followed by the ticket's number, `/implement-ticket #16` in our run, and every ticket on the board gets the same rules.

One more thing it doesn't do: merge. A ticket closes when its pull request merges, and until it closes, every ticket it blocks stays blocked. In this lesson nothing merges. By the end of the run the code has been reviewed by two sub-agents, by you, and by CI, but not by a human who isn't you, and that is the rule for the merge. The loop pauses at the PR, on purpose.

---

## 2. Before you start

You need your fork from lesson 4, on `main`, with the lesson 4 commit on it:

```bash
git switch main && git pull
git status --short                                   # expect: nothing
ls .kiro/skills                                      # expect: implement, tdd, code-review, implement-ticket among them
cat docs/agents/issue-tracker.md | head -5           # the tracker config from lesson 4
grep -rl agent-guard .kiro                           # expect: the file lesson 5 registered the guard in
```

If any of those is missing, lesson 4 section 8 or lesson 5 was skipped. Do it now.

Then four things that lesson 4 didn't need.

**Tell `gh` which repository is yours.** Your clone has two remotes, `origin` (your fork) and `upstream` (the workshop). When both exist, `gh` asks which one to use for issues and pull requests, or picks the parent. Settle it once:

```bash
gh repo set-default                                  # pick your fork, not VaridenTech
gh repo set-default --view                           # prints <you>/<repo>
```

Without this, the agent's `gh pr create` opens a pull request against the workshop repository, and the frontier query below reads the wrong issues.

**Switch on Actions for your fork.** GitHub disables workflows on every fork until the owner says otherwise. Open your fork on github.com, click the **Actions** tab, and press the button that enables workflows. Then check:

```bash
gh workflow list                                     # expect: CI (and AI review, from lesson 8)
```

`gh workflow list` is necessary but not sufficient: a fork lists its workflows as `active` even while Actions is still switched off, and `gh api repos/{owner}/{repo}/actions/permissions` can report `enabled: true` on a fork that has never run a thing. The signal that actually proves the button was pressed is a run appearing once a pull request exists. If section 5's `gh pr checks` reports "no checks" and `gh run list` is empty right after the agent opens the PR, the button wasn't pressed: open the **Actions** tab and enable workflows, then re-run the job from the PR's Checks tab or push an empty commit. Without this, the "CI green" step later in the loop never happens.

While you are here, read the workflow that `CI` names. It is one job, and it has been in the repository since the first commit:

```bash
cat .github/workflows/ci.yml
```

It runs on every pull request and on every push to `main`. The job installs with `--frozen-lockfile`, so a lockfile the agent forgot to commit fails here instead of on someone else's machine. Then `pnpm format:check`, then `pnpm turbo run lint typecheck test build`: the same four tasks as `pnpm check`, plus Prettier, on a clean Ubuntu runner with the Node version from `.nvmrc`. No database is started; the api specs stub Prisma, so the job is green in under a minute on a fresh fork. Everything the agent is told to run before its last commit, this job runs again without the agent.

One thing to notice: the trigger is `pull_request`, with no branch filter, so it fires for whichever repository the PR is opened on. That is the second reason `gh repo set-default` above must point at your fork. A PR opened against the workshop repository by mistake still gets a CI run, but on VaridenTech's Actions tab, not yours, and `gh pr checks` in section 5 won't find it.

**Install one more skill.** The agent is going to write the pull request body, and the `pr` skill gives it a template a reviewer can use: Summary, Evidence with before and after, Merge Danger. Same installer as lesson 4:

```bash
npx skills@latest add mattpocock/skills --skill pr   # pick Kiro CLI, and Claude Code or Codex if you use them
git add .kiro/skills/pr skills-lock.json
git commit -m "Install the pr skill"
git push
```

Commit it now, on `main`, before you branch. Otherwise it ends up inside the ticket's pull request.

**Start the database.** The first ticket changes the Prisma schema, which means a migration, and `prisma migrate dev` needs a running Postgres. You also need the app running for the demo step. Either of lesson 1's routes works:

```bash
pnpm dev:local                                       # Postgres in Docker, migrate, seed, then both apps
# or: docker compose up
```

Leave it running in its own terminal. Open Kiro CLI in the repository root in another one.

---

## 3. The board

There is no kanban board. There are open issues with the `ready-for-agent` label, sub-issues of the spec, with dependency edges between them. The "to do" column is a query: the open tickets whose blockers are all closed. Matt Pocock calls it the **frontier**.

```bash
gh issue list --label ready-for-agent --limit 1 --search "sort:created-asc"      # the spec; note its number
gh api "repos/{owner}/{repo}/issues/<spec number>/sub_issues" --paginate \
  --jq '.[] | select(.state=="open" and .issue_dependencies_summary.blocked_by==0) | "#\(.number)  \(.title)"'
```

The second command walks the spec's sub-issues and keeps the ones that are open with zero open blockers. `blocked_by` counts open blockers only, so the moment a blocker closes, the tickets behind it appear here. In our run the spec was `#15` and the query printed one line:

```
#16  Roles & user-to-store assignment (foundation)
```

Yours will print different numbers and possibly a different first ticket. Whatever it prints is what you implement. If it prints nothing, no ticket is unblocked, which means the edges from lesson 4 form a cycle; fix the tickets before going on. If it prints more than one, any of them is fine. Pick the smallest.

Open the spec on github.com as well. The sub-issue list has a progress bar at zero. That bar, and this query, are the board.

> **Your numbers are not ours.** GitHub numbers issues and pull requests per repository, in the order they were created. Your fork started its own count, and lesson 4 created the spec and tickets in whatever order the agent wrote them, so your spec and first ticket have different numbers from `#15` and `#16`, and from your neighbour's. Write both down now. Every command in the rest of this lesson uses the numbers from our run so that it reads as a real command. Wherever it says `#16`, in the invocation, the branch name, `gh issue view` and `Closes #16`, type your first ticket's number. Wherever it says `#15`, type your spec's number.

---

## 4. The agent's turn: branch, then `/implement`

Read the ticket first, the way you'd read it before handing it to a colleague:

```bash
gh issue view 16                                     # your ticket number
```

Check it has `Covers:`, `Demo:` and `Seams:` lines and that every criterion fails against today's code. If something is wrong, section 7 says what to do, and you do it **before** the run, not during. In our run `#16` replaced the two-value `ADMIN|STAFF` role enum with the TOR's four roles, gave each user an assigned store, extended the guard so routes can require a role, and seeded the TOR's test users. Seams S1 and S2, no Postgres tests. A good first ticket: every layer, small, and the gate for everything else.

### Make the branch yourself

```bash
git switch -c ticket/16-roles-and-stores            # your ticket number, then a slug from its title
```

The skill commits to whatever branch it finds itself on and never creates one. One shell command is more reliable than asking the agent to remember.

### Start fresh

In Kiro CLI, `/clear` if the session has anything in it, then `/context show`. You should see `AGENTS.md`, the steering files and the skill list, and nothing from your home directory. Lesson 3 made sure of that. If the window already has the lesson 4 conversation in it, this is exactly the state the loop exists to avoid.

### The invocation

The skill fetches the ticket and states its title, so `/implement #16` on its own would run. It would also review before committing, stop at the commit, and ask you about seams without telling you where to look. So, like lesson 4 did with `to-tickets`, the invocation has to carry the repository's rules. Lesson 4 pasted them as a block under the command, once. This loop runs once per ticket, so the block is a skill of its own, committed in the repository, and the invocation is one line, with your ticket number after it:

```
/implement-ticket #16
```

Open `.agents/skills/implement-ticket/SKILL.md`. After the frontmatter it says: take the ticket reference the user typed after the command, call the `implement` skill with it, and then apply these rules on top:

```
- Stay on the current branch. Commit as you go, with `#N` in every message.
- Before the first test, show the seams you will test at and wait for the user's yes.
- `pnpm check` and `pnpm format` must pass before the last commit.
- Review after committing, not before: run `code-review` with `main` as the fixed point, fix what it finds, commit again.
- Then push the branch and open a pull request against `main` with `Closes #N` in the body. Use the `pr` skill for the body.
- Don't close the ticket or tick its boxes. The pull request does that when it merges.
```

`#N` is whatever you typed. All three tools hand it over: Claude Code and Kiro append the text after the command to the skill, and in Codex it stays in your message next to the `$implement-ticket` mention. Each line is there for a reason:

| Line                             | Why                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stay on the current branch       | The skill already does this. Saying it stops the agent "helpfully" switching to `main` when it sees the branch is new.                                                                                                                                                              |
| Show me the seams, wait          | The `tdd` skill refuses to write a test at a seam you haven't confirmed. The ticket's `Seams:` line is the answer. You confirm it once, out loud, so you see that the line from lesson 4 is what makes the run test-first instead of "just write the code".                         |
| `pnpm check` and `pnpm format`   | The repository rule from `AGENTS.md`. CI runs the same commands, so a run that skips them fails ten minutes later on GitHub instead of now.                                                                                                                                         |
| Review after committing          | A known bug across the two skills: `code-review` diffs committed history against a fixed point, and `implement` calls it before committing, so the review often sees an empty diff and reports nothing. Committing first and reviewing against `main` is the documented workaround. |
| Push and open a PR, `Closes #16` | The skill stops at the commit. The PR is how the ticket will close, and `Closes #16` is what makes the merge close it. The `pr` skill gives the body a shape a reviewer who wasn't in the room can read.                                                                            |
| Don't close or tick              | The agent proving its own work is the thing the loop is designed not to trust. Closing is the merge's job. Ticking is yours, in section 5.                                                                                                                                          |

The rules are a file for the reason lesson 2 gave: one kind of task, done many times, the same for everyone. When a run shows you a seventh rule, edit the file, commit it on `main`, and the next turn has it, the way lesson 5 said to add a guard rule. It is laid out like the repository's other skills: the real file in `.agents/skills/`, which Codex reads directly, and symlinks from `.claude/skills/` and `.kiro/skills/`, so one edit reaches all three tools. The frontmatter marks it as user-invoked only (`disable-model-invocation: true`, and `allow_implicit_invocation: false` in `agents/openai.yaml` for Codex), so no agent starts a ticket because a prompt happened to sound like one.

### What you'll see

The run has a shape, and it is worth watching for it:

1. **It states the ticket's title** before anything else. If the title isn't your ticket, stop. `#16` can resolve against a local numbered list instead of the tracker, and the skill was changed to say the title precisely so you can catch this.
2. **It explores**, reads the spec and the ticket, and then **proposes seams** with a line each on what they catch and miss. For `#16`: contract schema tests for the role and user shapes, and controller specs with a stubbed `PrismaService` for the role guard. Say yes. If it proposes a seam the ticket doesn't name, ask why before you agree.
3. **Red, then green, one slice at a time.** A failing test at one seam, the minimal code to pass it, repeat. Typechecks and single test files run often. The full `pnpm check` runs once near the end. If you see all the tests written first and then all the code, that is the horizontal slicing the `tdd` skill warns about; say so.
4. **A commit, then the review.** Two sub-agents report under `## Standards` and `## Spec`. Lesson 6 explained what they are: two fresh windows that never saw the code being written, each given the diff and one question. It fixes what they found and commits again. Watch how little of their work reaches your window: a short report each, not the files they read.
5. **A push and a pull request.** The run ends with a URL. That is the hand-off.

Expect the run to take 20 to 40 minutes and well over 100k tokens. That is normal for a ticket of this size. Don't `/compact` in the middle: the agent would lose the seams it agreed and the slices it has done. If the window fills before the PR exists, have it commit whatever is green, `/clear`, and run `/implement-ticket #16` again with one line under it: "The branch already has partial work. Read the commits first."

While it works, stay with it. It will ask about seams once, and it may ask about an ambiguity in the ticket. Answer the first from the ticket. For the second, fix the ticket and restart; section 7 explains why.

---

## 5. Your turn: demo, diff, boxes, CI

The code has been reviewed, by two sub-agents with fresh windows. That is not nothing, and lesson 6 said why it is better than the author re-reading its own diff. But the sub-agents were briefed by the author, read the same ticket the same way, and never ran the app. Before anyone else looks, you prove the ticket the way the ticket said it would be proved.

```bash
gh pr view --web                                     # the PR the agent just opened
gh pr checks --watch                                 # CI, in another terminal
```

**Do the `Demo:` line.** It is on the ticket for exactly this moment. For `#16` it was: log in as each of the seeded TOR users and confirm that `/api/auth/me` returns the right role and assigned store for each. The agent's PR body has an Evidence section; the new accounts and their passwords should be in it, and the login page lists the seeded accounts. If the demo doesn't work, the ticket isn't done, whatever the tests say.

**Read the diff against the criteria.** Not for style; the review did that. For each acceptance criterion on the ticket, find the test or the code that makes it true. A criterion you can't find is a criterion the agent decided was already satisfied, and lesson 4 warned that some criteria pass before any work is done.

**Tick the boxes.** On the ticket on github.com, tick each criterion you have seen proven. The agent didn't, because you told it not to. This is the record that a human looked.

**Wait for CI.** It is the workflow you read in section 2: `pnpm format:check`, then lint, typecheck, test and build, the same as `pnpm check`, on a runner that has none of your local state. If it is red, paste the failing step's output into the **same** Kiro session, let the agent fix and push, and watch again. Only when the check is green do you `/clear`.

Why this step is not optional: the moment this PR merges, every ticket blocked by `#16` becomes available, and the next run builds on whatever `#16` left behind. An unproven ticket that closes doesn't just leave a bug. It opens the gate for every ticket behind it.

---

## 6. Nothing merged, nothing moved

Run the frontier query from section 3 again. It prints the same line:

```
#16  Roles & user-to-store assignment (foundation)
```

The PR is open, the ticket is open, the progress bar on the spec is still at zero, and the tickets it blocks still show one open blocker. That is correct. A ticket closes when its PR merges, and merging is the one step this lesson doesn't do. The rule is that a human who isn't the author reads the pull request before it merges. In the workshop that is a colleague, after the session, with the PR body's Evidence section as their script. Lesson 8 puts an AI reviewer on that PR before the colleague opens it. When that review passes and the PR merges, `#16` closes, the gate opens, and the next turn of the loop starts with the same query returning a different ticket.

Nothing to do between now and then. Leave the PR open and the branch pushed.

---

## 7. When the ticket is wrong

The agent must never reinterpret a ticket. A ticket that is wrong gets fixed where it lives, on GitHub, and the run starts over. The rule is: **stop, fix the issue, `/clear`, start again.** Never let the implementing agent decide what the ticket meant; that decision was the point of lesson 4, and it belongs to you.

Fixes are cheap. `gh issue edit <n> --body-file body.md`, or ask the agent in plain words to use the commands in `docs/agents/issue-tracker.md`, exactly as lesson 4 section 7 did. Things that have come up in real runs:

| What you see                                                                                        | What it is                                                                              | What to do                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A `Blocked by` section listing `#T01`-style draft numbers, next to real dependencies in the sidebar | A leftover from the draft list. The native edges are right; the text wasn't updated     | Delete the section. Harmless to a human, confusing to an agent that reads the body literally. See lesson 4, step 7                                           |
| The spec says Thai UI; lesson 4's Appendix A says English                                           | The spec and the room disagree, and the agent will pick one silently                    | Decide, edit the spec issue, check the tickets that inherit it. Don't start a run with an open contradiction                                                 |
| No `Seams:` line                                                                                    | The `tdd` step has nothing to agree to, and the run degrades into "just write the code" | Add the line from the spec's Testing Decisions. Then run                                                                                                     |
| A ticket called "document numbering service" or "idempotency key infrastructure"                    | A horizontal slice. Nothing is demoable when it closes                                  | Dissolve it into the first ticket that needs it; make the later ones blocked by that                                                                         |
| The first stock-writing ticket adds Postgres integration tests, and `ci.yml` has no database        | The tests pass on your laptop and fail or skip in CI                                    | Add a criterion to that ticket: "CI runs the integration tests against a Postgres service". Then run                                                         |
| The agent asks a question the ticket should have answered                                           | A gap in the ticket                                                                     | Answer it on the ticket, not in the chat. Then `/clear` and restart, so the answer is in the state and not in a conversation that is about to be thrown away |

The last row is the general case. If an answer only exists in the chat, the next session doesn't have it, and neither does the reviewer.

---

## 8. Read, don't run yet: the loop without a human

Two things in the skills collection run this loop without you, and both would merge tickets on their own. Lesson 6 section 4 described them: `implement-spec`, which hands every frontier ticket to an implementer sub-agent and merges the results onto one integration branch, and a shell loop that calls the agent headless once per ticket. Both remove the human from section 5. That is the step this lesson spent the most time on, and the one the guard from lesson 5 cannot replace: a hook can stop a command, not judge a diff. Know they exist, and leave them. Lesson 9 picks up the shell loop, and keeps the human exactly where this lesson put them: at the demo, the diff and the merge.

---

## 9. Check that it worked

Read `16` below as your ticket number.

- `gh pr list` shows one open pull request on **your fork**, from `ticket/16-...` into `main`, with `Closes #16` in the body and a green check.
- `gh pr checks` lists one passing check named `check`, from the `CI` workflow, triggered by `pull_request` on your fork. Its log on the Actions tab shows the format step and then lint, typecheck, test and build. If `gh pr checks` says there are no checks, Actions is off or the PR is on the wrong repository; see section 2.
- `gh issue view 16` shows the ticket still **open**, with its acceptance criteria ticked.
- `git log main -1` is the "Install the pr skill" commit, and `main` has none of the ticket's changes.
- The frontier query from section 3 still prints only `#16`.
- The PR body has Summary, Evidence and Merge Danger sections, and the Evidence section tells a reviewer how to reproduce the demo.
- `git log ticket/16-... --oneline` shows several commits, each mentioning `#16`, with at least one after the review.
- Kiro's `/context show` in a fresh session lists `pr` and `implement-ticket` next to `implement`, `tdd` and `code-review`.

---

## Summary

- **One ticket, one fresh window.** The conversation is disposable. The spec, the tickets, the edges, the branch and the PR are the state, and anything that only exists in a chat is lost at `/clear`.
- **The `implement` skill is seven lines.** Fetch, name, `tdd` at agreed seams, check, review, commit. It doesn't branch, doesn't open a PR, doesn't close or tick anything. The loop around it does, and the loop is yours.
- **The repository's rules ride in `implement-ticket`**, the block lesson 4 pasted, now a committed skill: commit before reviewing, review against `main`, push and open a PR, never touch the ticket. One line per ticket, one edit to change the rules for everyone.
- **Your turn is the demo.** The `Demo:` line, the diff against the criteria, the boxes, CI. An unproven ticket that closes opens the gate for everything behind it.
- **When the ticket is wrong, fix the ticket.** Stop, edit the issue, `/clear`, start again. The implementing agent never reinterprets.
- **Nothing merged.** The loop pauses at the PR. Two sub-agents, you and CI have reviewed it; a human who isn't the author hasn't. When they have, the merge, the closed ticket and the moving frontier follow.

---

## Optional: try it later

This isn't part of the session and merges nothing. In a **fresh** session on the ticket branch, run the reviewer again without the author's briefing:

```
/code-review main
```

Compare its Standards and Spec findings with the ones the sub-agents reported in section 4. Those sub-agents had fresh windows, but the implementing agent wrote their brief. A reviewer that picked the branch up cold tends to find different things. That difference is lesson 6's point, measured.

Then finish the turn. Swap pull requests with a colleague, review theirs from the Evidence section, and merge it if it holds. Run the frontier query from section 3 on their fork: `#16` is gone, and the tickets it blocked have appeared. That is the gate opening, and the next turn of the loop starts there.

---

## Appendix A: the same turn in Claude Code and Codex

The skills are the same files. The loop is the same. Only the commands around it change.

| Step             | Kiro CLI                                                            | Claude Code                                                                  | Codex                                                               |
| ---------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Install `pr`     | `npx skills@latest add mattpocock/skills --skill pr`, pick Kiro CLI | Same command, pick Claude Code. Commit `.agents/skills` and `.claude/skills` | Same command, pick Codex. Commit `.agents/skills`                   |
| Fresh window     | `/clear`, then `/context show`                                      | `/clear`, then `/context`                                                    | `/new`, then `/status`                                              |
| Invoke           | `/implement-ticket #16`                                             | `/implement-ticket #16`                                                      | `$implement-ticket #16`, or "use the implement-ticket skill on #16" |
| Seams prompt     | Answer in the chat                                                  | Answer in the chat                                                           | Answer in the chat                                                  |
| Fix a red CI     | Paste the failing step into the same session                        | Same                                                                         | Same                                                                |
| Headless (later) | `kiro-cli chat --no-interactive --trust-all-tools "..."`            | `claude -p "/implement-ticket #16"`                                          | `codex exec "..."`                                                  |

---

## Further reading

- Matt Pocock, [implement](https://www.aihero.dev/skills-implement), [implement-spec](https://www.aihero.dev/skills-implement-spec), and the [skills collection](https://github.com/mattpocock/skills): the skill sources, including `tdd`, `code-review` and `pr`.
- GitHub, [Sub-issues REST API](https://docs.github.com/en/rest/issues/sub-issues) and [Issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies): where the frontier query comes from.
- GitHub, [Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue): what `Closes #16` does on merge.
- Kiro, [Headless mode](https://kiro.dev/docs/cli/headless/) and [Subagents](https://kiro.dev/docs/custom-agents/subagents/); Claude Code, [Headless](https://code.claude.com/docs/en/headless) and [Subagents](https://code.claude.com/docs/en/sub-agents): what each harness can and can't do unattended.
- Hunt and Thomas, _The Pragmatic Programmer_, "Tracer Bullets": why one thin slice at a time, all the way through.
