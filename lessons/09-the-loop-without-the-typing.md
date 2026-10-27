# Lesson 9: The loop without the typing: a headless implementer over the frontier

**Time:** about 75–90 minutes of class time, around a run of one to two hours that nobody has to watch
**Goal:** start one command that builds every unblocked ticket on your fork, one after another, each in a fresh headless Kiro session, each ending in its own pull request with its own AI review, and then do the human half of the loop three times instead of once.

By the end of this lesson you should be able to answer three questions:

1. Why does a shell script orchestrate the loop, and not an agent?
2. What changes when nobody is at the keyboard, and where do those answers live now?
3. What does the loop still refuse to do, and why?

Lesson 7 ran the implement loop once, by hand: the frontier query, the branch, `/implement-ticket`, the demo, the diff, the boxes, CI, and a pull request left open for a human who isn't the author. Lesson 8 ran it a second time and put an AI reviewer on the pull request. Both lessons said the same thing about the versions that run without you: know they exist, and leave them. This lesson picks one of them up. Not `implement-spec`, which needs a harness Kiro isn't; that is Appendix A. The other one, the shell loop, which Matt Pocock's own page calls "faster, cheaper, and more reliable" than an agent orchestrating, "since no agent makes orchestration decisions". It turns out the loop from lesson 7 was already built for it.

---

## 1. The loop without the typing

![Top to bottom. First, you, at a terminal: one command, pnpm implement:frontier, started by a human; the guard refuses it to agents. Second, the script, a slate lane: query the frontier, the open tickets with no open blockers, capped at three; then for each ticket, reset the database, branch from main, run kiro-cli headless with the implementer agent and the saved prompt, report the pull request or that there is none, return to main, next ticket; an arrow loops back. Third, inside each run, an amber box: a fresh process, reads the prompt and the implement-ticket skill, seams from the ticket's Seams line, red-green TDD, pnpm check, commit, review against main, push, pull request with Closes. Fourth, GitHub: three branches, three pull requests, CI and the AI review on each. Fifth, you again, three times: reset by hand, the Demo line, the diff against the criteria, the boxes, and a colleague merges. A red strip says: never merges, never closes, never computes a frontier GitHub doesn't report. A note says: the script does what the guard refuses the agent; a human starts the script.](images/implement-frontier.svg)

Look at what lesson 7's loop needed from you, step by step. Query the frontier: a command. Make the branch: a command. Start the run: a command, plus one yes about the seams. Then wait. Everything the agent needed was on GitHub or in git before the run started, and everything it produced was in git or on GitHub when it ended. The conversation held nothing worth keeping, which is why you cleared it. Lesson 7 insisted on that for the dumb-zone reason. It has a second consequence: a loop whose state is entirely outside the conversation can be driven by something that has no conversation. A script.

So the orchestrator here is forty lines of Bash. It asks GitHub for the frontier, and for each ticket it resets the database, makes the branch, starts one headless Kiro session, and reports what came out. Then back to `main`, and the next ticket, in a new process that has never heard of the last one. Lesson 7's fresh window, kept by construction rather than by `/clear`.

What the script does not do is decide anything. It never merges, so the frontier GitHub reports doesn't move during a pass, and the script doesn't pretend it does: one pass builds the tickets that are unblocked now, each from `main`, and stops. It never closes a ticket. It never retries a failed run, because a retry without a human reading the log is the agent reinterpreting a bad ticket, which lesson 7 section 7 forbids. When a pass ends, you have as many pull requests as tickets, each with CI and lesson 8's review on it, and the human half of the loop waiting for you, three times over. That half is the same as it was. This lesson removes the typing, not the human.

---

## 2. Before you start

You need your fork from lesson 8, on `main`, with both lesson 7's and lesson 8's tickets merged and their branches gone:

```bash
git switch main && git pull
git status --short                                   # expect: nothing
gh issue view 16 --json state -q .state              # your lesson 7 ticket; expect: CLOSED
gh issue view 17 --json state -q .state              # your lesson 8 ticket; expect: CLOSED
gh repo set-default --view                           # expect: <you>/<repo>
gh workflow list                                     # expect: CI and AI review
gh run list --limit 3                                # expect: runs from lessons 7 and 8; empty means Actions is off
kiro-cli --version                                   # 2.34.0 or later
jq --version                                         # any version; the script reads Kiro's event stream with it
```

If the two tickets aren't closed, your colleague hasn't merged yet; finish lesson 8 section 8 first. The frontier for this lesson is the tickets those two unblocked, and with both closed it should hold several.

If `gh run list` prints nothing, Actions was never enabled on your fork, and lesson 7 section 2 says what to press. It matters more here than it did there: the pass opens three pull requests with nobody watching, and every one of them expects CI and the AI review to arrive on their own. On a fork with Actions off, all three arrive with no checks and no review, and you find out an hour later.

Then three things.

**Pull the lesson's files.** This lesson adds four files to the repository, the script, the agent, its brief and the saved prompt, and touches three, the guard, `package.json` and `.gitignore`. Sections 3 to 5 read each of them. Pull from `upstream` the way lesson 8 did, or check they are already in your fork:

```bash
ls scripts/implement-frontier.sh .kiro/agents/implementer.json .kiro/agents/implementer.md .kiro/prompts/implement-unattended.md
grep -n "implement loop" scripts/agent-guard.mjs     # the eighth rule
grep -n "implement:frontier" package.json
```

**Start the stack and leave it.** The script resets the database before every ticket and the demo step needs the app, so Postgres has to be up for the whole lesson:

```bash
pnpm dev:local                                       # or: docker compose up
docker compose ps --services --status running        # expect: postgres among them
```

The script checks this and refuses to start without it.

**Read the frontier first.** The script will do this for you, but do it once by hand so you know what it is about to build:

```bash
gh api "repos/{owner}/{repo}/issues/<spec number>/sub_issues" --paginate \
  --jq '.[] | select(.state=="open" and .issue_dependencies_summary.blocked_by==0) | "#\(.number)  \(.title)"'
```

In our run it printed three lines, `#18`, `#19` and `#20` **[Fill from a real run: the titles]**, and this lesson uses those numbers. Yours are different; lesson 7 section 3 says why. Open each ticket. Check it has `Covers:`, `Demo:` and `Seams:` lines, and that the `Seams:` line names seams you would say yes to, because this time you won't be asked. If one of them is wrong, fix it now, on GitHub, as lesson 7 section 7 says. If the frontier holds more than three, the script takes the three lowest numbers; `--max` changes that.

One more thing to read before you run anything: which of these tickets touch the same files. Two of ours both added a Prisma model and both edited the contracts router. That is going to matter in section 7, and it is fine. Don't try to avoid it.

---

## 3. What changes when nobody is there

Lesson 7's run asked you for one thing, the seams, and lesson 7's loop asked you for four commands. Headless Kiro changes four things about how that run can be started, and each one moved into a file. This section is those four facts and the file each one produced.

**A slash command doesn't expand in headless mode.** `/implement-ticket #18` works in an interactive session because Kiro expands the skill's command into the skill's text. In `--no-interactive` it doesn't: we probed `kiro-cli chat --no-interactive "/grilling ..."` on `kiro-cli 2.34.0`, and the agent replied that no skill named `grilling` had been loaded into its context. What does expand headless is a **saved prompt**, a Markdown file in `.kiro/prompts/`, invoked as `/name arguments` on the V3 engine with `${1}` standing for the first argument. We probed that too: a prompt saying `Reply with exactly: PROBE OK ${1}` run headless as `/probe-hello alpha` printed `PROBE OK alpha`. So the headless entry point is a saved prompt that tells the agent to read and follow the skill. Section 4 reads it.

**Every `ask` is a deny.** Lesson 8 met this rule: in headless mode, any tool call Kiro would have asked you about is refused instead. An interactive `/implement-ticket` run asks you about its first `git commit`, its `pnpm check`, its `gh pr create`, and you say yes or trust the tool. Headless, each of those is a refusal, and the run ends with a branch full of code and no commit. Lesson 8's answer was an agent file with permission rules, and it is the answer here too: `.kiro/agents/implementer.json`, with `allow` where the reviewer had `deny`, and `deny` on the same short list of human verdicts. Not `--trust-all-tools`, for lesson 8's reason: it also approves the guard's confirmations and hands back every command the deny list doesn't name. Section 4 reads this file as well.

**Nobody says yes to the seams.** The `implement-ticket` skill says: before the first test, show the seams and wait. Lesson 7 said why: so you see that the `Seams:` line from lesson 4 is what makes the run test-first. Headless, the wait is a hang, and the `tdd` skill won't write a test at a seam nobody agreed. The answer was always on the ticket. The saved prompt says so: the `Seams:` line is the user's answer, state it and continue. That is why section 2 had you read the `Seams:` lines first. You are saying yes now, three times, in advance.

**Each ticket starts from `main`, so the database has to.** Ticket `#18` runs `prisma migrate dev` and applies its migration. The script switches back to `main` and branches `#19`, whose checkout doesn't have `#18`'s migration folder, but the database still has `#18`'s row in `_prisma_migrations`. Prisma calls that drift, and in a non-interactive run `migrate dev` refuses rather than asking whether to reset. So before every ticket the script resets the database, replays the migrations on `main`, and seeds, which is the state lesson 7's run started from. Lesson 5's guard refuses that command to every agent in this repository. It doesn't refuse it to you, and the script is yours. Section 5 comes back to this.

| What lesson 7 had you do              | Where it lives now                                                       |
| ------------------------------------- | ------------------------------------------------------------------------ |
| Query the frontier                    | The script, same `gh api` line, lowest numbers first, capped by `--max`  |
| Make the branch                       | The script, `ticket/<n>-<slug from the title>`                           |
| `/clear`, then `/implement-ticket #N` | A new process per ticket, running the saved prompt, which runs the skill |
| Say yes to the seams                  | The ticket's `Seams:` line, by way of the saved prompt                   |
| Approve `git commit`, `gh pr create`  | The `implementer` agent's allow rules                                    |
| Never reset the database              | Still true for the agent. The script resets, before every ticket, as you |
| Demo, diff, boxes, CI, merge          | Still you. Section 6                                                     |

The last row is the one that didn't move.

---

## 4. The implementer agent and the saved prompt

Open `.kiro/agents/implementer.json` next to `reviewer.json` from lesson 8. The two files have the same shape and opposite jobs, and the differences are the lesson:

```json
{
  "name": "implementer",
  "prompt": "file://implementer.md",
  "model": "claude-sonnet-5.5",
  "tools": ["@builtin"],
  "excludedTools": ["knowledge"],
  "resources": [
    "file://../../AGENTS.md",
    "file://../../apps/api/AGENTS.md",
    "file://../../apps/web/AGENTS.md",
    "skill://.kiro/skills/*/SKILL.md"
  ],
  "permissions": {
    "rules": [
      { "capability": "fs_read", "match": ["./**"], "effect": "allow" },
      { "capability": "fs_write", "match": ["./**"], "effect": "allow" },
      {
        "capability": "fs_write",
        "match": [".agents/**", ".claude/**", ".kiro/**", ".github/**", "scripts/**"],
        "effect": "deny"
      },
      { "capability": "shell", "match": ["*"], "effect": "allow" },
      {
        "capability": "shell",
        "match": [
          "gh pr merge *",
          "gh pr review *",
          "gh pr close *",
          "gh pr edit *",
          "gh pr comment *",
          "gh issue close *",
          "gh issue edit *",
          "gh issue comment *",
          "gh api *",
          "kiro-cli *"
        ],
        "effect": "deny"
      }
    ]
  },
  "hooks": [
    {
      "name": "agent-guard",
      "trigger": "PreToolUse",
      "matcher": "^(execute_bash|execute_pwsh)$",
      "action": { "type": "command", "command": "node scripts/agent-guard.mjs" }
    }
  ]
}
```

**The tools are `erp`'s, not `reviewer`'s.** `@builtin` minus `knowledge`, the same as lesson 3's agent, because this agent has lesson 7's job: it edits, runs tests, commits, and the `code-review` step inside the skill spawns two sub-agents, so it needs the `subagent` tool. The reviewer had three tools because reading needs three.

**The resources are every skill, not one.** `skill://.kiro/skills/*/SKILL.md`, the same glob as `erp`, because the run is `implement-ticket` calling `implement` calling `tdd` and `code-review`, and then `pr`. A `skill://` resource puts the name in front of the model, not the text; the brief tells it to read the skill in full first.

**The model is pinned** to the same model as the reviewer, so the two agents that touch a pull request on this fork are the same model at a known cost, and so your run and your neighbour's are comparable. Effort goes on the command, as lesson 8 did, and the script passes `--effort high` unless you say otherwise.

**The permissions are the reviewer's, inverted.** Writes are allowed everywhere, then denied in five places: the skills, the agent files, the prompts, the workflows and the scripts. The implementer can't edit the rules it runs under, the guard that watches it, or the reviewer that will read its work. Shell is allowed, then denied for the same list the reviewer had: merge, review, close, edit or comment on a pull request or a ticket, `gh api`, and one new entry, `kiro-cli`, so a run can't start another run. Everything on that list is either a human's verdict or the loop's job. `deny` beats `allow`, so the two allow lines can be as wide as they are.

Why not `--trust-all-tools`, if shell is allowed anyway? Because the allow rule is still subject to the deny rules and to the hook, and `--trust-all-tools` isn't: Kiro's documentation says it approves everything including hook confirmation requests. The rules here are a list you can read. The flag is the absence of one.

**The hook is lesson 5's guard,** same matcher, same script, now with eight rules. The eighth is in section 5.

Check it reads:

```bash
kiro-cli agent validate --path .kiro/agents/implementer.json   # expect: no output, exit 0
kiro-cli agent list                                           # expect: erp, implementer, reviewer, all (v3 format)
```

### The brief

`.kiro/agents/implementer.md` is six paragraphs: read the skill in full first; nobody is watching, so the seams come from the ticket and an ambiguity is a reason to stop, not to guess; stay on the branch; the list of things it never does; a refusal is final; end with the pull request URL or a line starting `NO PR:`. The refusal paragraph is copied from the reviewer's brief for the same reason: a headless agent that hits a denied command will otherwise try the next command, and the next.

### The saved prompt

`.kiro/prompts/implement-unattended.md` is what the script actually sends, as `/implement-unattended #18`:

```
Implement ticket ${1} unattended. Read `.kiro/skills/implement-ticket/SKILL.md` and follow it,
with these three changes, because nobody is at the keyboard:

- Seams: the ticket's `Seams:` line is the user's answer. State the seams you will test at, then continue without waiting.
- Questions: if the ticket is ambiguous, do not ask and do not guess. Stop, and say what the ticket should have said.
- Branch: you are already on the ticket's branch. Stay on it.

Everything else in the skill applies: ...
```

Three changes, and the skill is otherwise untouched. The skill is what you and everyone else type interactively, and it is still right for that: a person at the keyboard should be asked about the seams. The prompt is the headless entry to the same skill, and the three lines are exactly the three places where "nobody is there" changes the answer. It isn't named `implement-ticket` because on the V3 engine a prompt and a skill with the same name would both be `/implement-ticket`. One skill, two doors, and the headless door says on it what is different.

---

## 5. The script and the eighth rule

Open `scripts/implement-frontier.sh`. Read it top to bottom once; it is one screen of preflight, a narrator, and one screen of loop.

**Preflight** refuses to start unless everything the loop assumes is true: `gh` logged in with your fork as default, the agent file validates, the prompt exists, you are on a clean `main`, Postgres is running. Each check is one line and one reason, and every one of them is a thing that cost someone a run in lessons 7 and 8.

**The frontier** is lesson 7's query, with `.number` instead of the title, sorted, and cut at `--max`. The spec number is found the way lesson 7 section 3 found it, or passed with `--spec`.

**The loop** is two processes and the ground between them. The script sends the agent one thing, once: the arguments on the command line, a rulebook and a sentence. The agent sends the script one thing, continuously: its stdout, one event per line. Nothing ever goes the other way during a run; the script can't say yes, and section 3 said why it doesn't have to. When the process ends, the script doesn't ask the conversation what happened. It reads the checkout and GitHub.

![Two lanes side by side with a channel between them, and a strip of shared ground underneath. Left, the script, a slate lane: bash, run from your shell, where no hook runs. Five steps. One, set the stage: prisma migrate reset --force, then git switch -c ticket/18-slug; the guard refuses the reset to the agent, the script is yours. Two, start one process: kiro-cli chat --v3 --no-interactive --output-format stream-json --agent implementer --effort high --trust-workspace "/implement-unattended #18". Three, read the stream: tee to .ai-runs/18.events.jsonl, narrate, tee to .ai-runs/18.log; the screen shows [execute] pnpm check, [edit] a path, and the agent's words. Four, read the ground, not the chat: git status --short, stop if dirty; gh pr list --head; the exit status is printed, not trusted. Five, back to main; the next ticket is a new process. Right, the agent, an amber lane: kiro-cli chat, a fresh process, nothing from the last ticket. What it is given: implementer.json with allow for commit, push and pr create and deny for merge, close, gh api and kiro-cli; implementer.md, the brief; the saved prompt, which reads the implement-ticket skill; and the agent-guard hook, the same guard as lesson 5. What it does with nobody to ask: states the seams from the ticket's Seams line, red, green, pnpm check, commit, code-review against main, fix, push, gh pr create, and ends with the PR URL or a NO PR line. What it can't do: an ask is a deny, a denial is final, it never resets, merges or ticks a box, can't start kiro-cli and can't edit its own rules. What it leaves behind: commits on the branch, a pull request on GitHub, and its words only in the stream. Between the lanes, three channels. In, once, as arguments, from the script to the agent: a rulebook and one sentence, nothing else is ever sent. Out, continuously, on stdout, from the agent to the script: one JSON event per line, tool_call with the command or path, tool_call_update with the status, agent_message_chunk with the words, runFinished; stderr carries startup info and denials to the log. Never, crossed out: an answer. The script can't say yes; the agent file said it in advance, and the guard says no inside the session. Underneath, the shared ground: the checkout, where the branch and the commits are; the database, reset by the script and migrated by the agent; GitHub, where the pull request, CI and the AI review are. The script trusts the ground, not the conversation. A red strip: the eighth rule, pnpm implement:frontier is refused to every agent; the script runs the reset the guard refuses the agent, so the guard refuses the script to the agent.](images/script-and-agent.svg)

The part to read against lesson 7:

```bash
for n in $frontier; do
  branch="ticket/$n-$slug"                                    # from the title, as you did by hand
  # skip if the branch exists: a previous run left it, and a human decides

  pnpm --filter @erp/database exec prisma migrate reset --force   # section 3's fourth fact
  git switch -c "$branch"

  kiro-cli chat --v3 --no-interactive --output-format stream-json --agent implementer \
    --effort "$effort" --trust-workspace "/implement-unattended #$n" |
    tee -a ".ai-runs/$n.events.jsonl" | narrate | tee -a ".ai-runs/$n.log"

  # stop the pass if the run left uncommitted changes: a human looks first
  pr=$(gh pr list --head "$branch" --json url --jq '.[0].url // empty')
  git switch main
done
```

| Line                                              | Why                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Skip an existing branch                           | A branch for this ticket means a run already happened. Building again on top, or deleting it, is a decision, and the script doesn't make those                                                                                                         |
| `prisma migrate reset --force`                    | Section 3's drift. `--force` skips Prisma's confirmation, which a script can't answer. It goes through `pnpm exec` rather than the `db:reset` alias because the alias doesn't pass flags through                                                       |
| `--v3`, `--no-interactive`, `--agent implementer` | The engine that reads permission rules, headless mode, and the file from section 4. Same three as lesson 8's reviewer command                                                                                                                          |
| `--trust-workspace`                               | Since 2.33 the V3 engine asks whether to trust a folder's hooks and agents the first time. Headless, that ask is a deny and the guard wouldn't load. The flag answers yes for this launch only, for a folder you are sitting in                        |
| `/implement-unattended #$n`                       | The saved prompt, section 4. `${1}` becomes `#18`                                                                                                                                                                                                      |
| `--output-format stream-json`                     | Headless text output names the tool and not the command: `[tool] Run Command`, then `status: InProgress` until it is done. This prints the run as events instead, one JSON line each, and the `tool_call` event carries the command or the path        |
| `tee -a .ai-runs/$n.events.jsonl`                 | Every event, as it arrives, before anything is thrown away. The full record of the run                                                                                                                                                                 |
| `narrate`                                         | A `jq` program above the loop, twenty lines. One line per tool call with what it ran or touched, the agent's words as they stream, a `[failed]` line with the first words of why, and `[run]` at the end. Everything else in the stream is bookkeeping |
| `tee -a .ai-runs/$n.log`                          | You see the narrated run and keep it, under the reset's output. Kiro's own stderr goes there too. `.ai-runs/` is in `.gitignore` next to `.ai-review/`                                                                                                 |
| Stop on uncommitted changes                       | A run that ended mid-slice left work on the branch and no commit. Switching to `main` over it could lose it; moving on could build the next ticket on a dirty tree. The pass stops and tells you which branch to look at                               |
| `gh pr list --head`                               | The one measure of success the script trusts: a pull request exists for the branch. No PR is reported, not retried                                                                                                                                     |

At the end it prints one line per ticket: the PR URL, `no PR; see .ai-runs/19.log`, or `skipped`. And then it says what it didn't do: "Nothing merged, nothing closed."

### The eighth rule

Lesson 5 said the guard "isn't a sandbox: a reset wrapped in a script the agent wrote, or a new `package.json` alias someone adds later, gets past it." This lesson just added both. Prove it, with the guard's own test from lesson 5, before reading the rule:

```bash
echo '{"tool_input":{"command":"pnpm db:reset"}}'          | node scripts/agent-guard.mjs; echo "exit $?"   # lesson 5's rule: the message, exit 2
echo '{"tool_input":{"command":"pnpm implement:frontier"}}' | node scripts/agent-guard.mjs; echo "exit $?"   # expect: the message, exit 2
```

Before this lesson's commit, the second line printed nothing and exited 0. We ran it against the seven-rule guard to be sure: a reset inside a script the agent didn't write, named by an alias the guard had never heard of, and the hook waved it through. An agent that ran `pnpm implement:frontier` would reset the database through a script it didn't write and the guard didn't read. So the guard has an eighth rule: any command mentioning `implement:frontier` or `implement-frontier` is refused, with the reason that a human starts the loop from a terminal. The regex is one line, the entry is five, and it is the same move lesson 5 described: a run shows you a command you wish it had refused, you add a rule, everyone has it.

Notice what the rule is for. It is not for the script, which you run from your shell, where no hook exists. It is for the agent that, deep in a stuck run, finds a script in the repository that would "fix" its migration problem. Lesson 5's split, said once more: the hook stops the agent, the human runs the dangerous thing, and when the dangerous thing gets a new name, the hook learns the name.

---

## 6. Run it

One command, from the repository root, in a terminal you can leave alone:

```bash
pnpm implement:frontier --dry-run                    # the frontier and the plan, nothing built
pnpm implement:frontier                              # the pass
```

The dry run prints the repository, the spec, the frontier and the branch each ticket would get. If a ticket you expected is missing, its blockers aren't all closed; if one you didn't expect is there, read it before going on. Then the real one.

### What you'll see

Stay for the first ticket. It is lesson 7 section 4's run, printed to a terminal instead of a chat window. The screen is the narrator's: a bracketed line for each thing the agent does, and what it says in between.

```
[read] .kiro/skills/implement-ticket/SKILL.md
[execute] gh issue view 18 --json title,body
Ticket #18: ...
[execute] pnpm --filter @erp/api test -- orders.controller
[edit] apps/api/src/orders/orders.controller.spec.ts
[failed] Run Command  Output: ... Exit Code: 1
```

`[read]`, `[edit]` and `[execute]` are the tool's kind; the rest of the line is the path, or the command. The command is the point: without it, headless Kiro prints `[tool] Run Command` and a column of `status: InProgress`, which is the same line for `gh issue view` and for `pnpm check`, and you can't tell a run that is working from one that is stuck. A `[failed]` line is a command that exited non-zero or was refused, with the first words of its output. In a red-green run, a `[failed]` after a test command is the red, not a problem. The shape is the same as lesson 7's:

1. **The reset.** Prisma drops and replays the migrations and seeds, in the log, not on screen.
2. **The title.** The skill's first act is to fetch the ticket and state its title. If it isn't `#18`'s title, stop the script with `Ctrl+C`; lesson 7 said why this line exists.
3. **The seams, stated, not asked.** The agent names the seams from the ticket and goes on. This is the saved prompt's first line doing its work, and the moment to notice that nobody was asked.
4. **Red, then green.** Failing test, minimal code, repeat; typechecks and single test files often; `pnpm check` near the end. Horizontal slicing, all tests then all code, is as wrong here as it was in lesson 7, and now nobody is there to say so. If you see it, note it for section 8.
5. **A commit, a review, a fix, a push, a URL.** Two sub-agents under `## Standards` and `## Spec`, as in lesson 7 **[Fill from a real run: whether `code-review`'s sub-agents ran headless; Kiro's documentation doesn't say]**. Then the pull request URL on its own line, and the script prints `#18  https://github.com/...`.
6. **Back to `main`, and the title of `#19`.** A new process. Nothing from `#18`'s run is in it except what `#18` left on GitHub and in git.

**[Fill from a real run]** the console output of one ticket, trimmed to the title, the seams, two red-green slices, the review headings and the URL; and the time per ticket next to lesson 7's 20 to 40 minutes.

After the first title and seams, go and do something else. Three tickets is one to two hours. The AI review from lesson 8 fires on each pull request the moment it opens, so by the time the pass ends, every PR has CI and a review waiting, and none of it was started by hand.

If the pass stops early with "uncommitted changes on `ticket/19-...`", that is section 8. If a ticket says `no PR`, read `.ai-runs/19.log` from the bottom: the last thing the agent said is usually a refusal it reported, or a `NO PR:` line with the ambiguity it wouldn't guess at. The `[failed]` line above it names the command. If the first words of its output aren't enough, the whole output is in `.ai-runs/19.events.jsonl`, in the `tool_call_update` event with that command's `toolCallId`.

---

## 7. Your turn, three times

Lesson 7 section 5, per pull request. The script did none of it, on purpose. The only new line is the first one.

```bash
gh pr list                                           # three PRs, from ticket/18-..., ticket/19-..., ticket/20-...
git switch ticket/18-<slug>
pnpm --filter @erp/database exec prisma migrate reset --force   # your database matches the last ticket, not this one
pnpm dev                                             # if the stack from section 2 is only Postgres
```

**Reset by hand, per branch.** The database is at whatever the last ticket left it. Each branch has its own migration, so before each demo you replay that branch's migrations and seed. This is the same reset the script ran, by the same person who is allowed to run it, and the one time in the course you'll type it three times in an hour. The guard still wouldn't let an agent do it for you.

**Do the `Demo:` line.** Then **read the diff against the criteria.** Then **tick the boxes.** Then **wait for CI** and read the review from `github-actions`, with lesson 8 section 8 as the script. Stop the dev servers before switching to the next branch, or the next `pnpm dev` finds the ports taken.

Two things to read differently this time. First, the review's Criteria table against the seams the agent stated in the log: a **not found** row at a seam the ticket named means the ticket's `Seams:` line was wrong, not the agent, and the fix is on the ticket before the next pass. Second, the Evidence section: the agent wrote it for a reviewer who wasn't in the room, and this time that reviewer is also you, because you weren't.

If CI is red, lesson 7 said to paste the failing step into the same session. There is no session. Open an interactive one on the branch and do it there, and the same session is where the review's findings get fixed: `/address-review #<PR>`, lesson 8 section 9. The implementer that wrote the code is gone, so the author's turn on these pull requests is always this skill, never a paste:

```bash
git switch ticket/19-<slug>
kiro-cli chat                                        # /clear, then /address-review #<PR>, or paste the failing step; let it fix, commit and push
```

Then hand all three to a colleague, one at a time, and let them merge as lesson 8 section 7 did: the review in one hand, the demo in the other. Or, if your colleague is doing the same lesson, swap frontiers.

---

## 8. When branches collide

Three branches from the same `main`, two of which touched `schema.prisma`, the contracts router and `apps/api/src/app.module.ts`. The first merges cleanly. When your colleague goes to merge the second, GitHub says it can't: the branch conflicts with `main`, which now contains the first.

This is not a failure of the run. It is what parallel work costs, and the page for `implement-spec` lists it as that skill's main caveat too: branches that share a file collide at merge time, and worktrees or separate processes only postpone it. The fix is the same as it would be for a human's branch, and the agent can do it, in an interactive session, on the branch, with you watching:

```bash
git switch ticket/19-<slug> && git pull
kiro-cli chat
```

```
/clear
Merge main into this branch and resolve the conflicts. The contracts router, app.module.ts and the
migrations folder are where to look. Both migrations must apply, in order, on a fresh database.
Run pnpm check, commit with #19, and push.
```

Watch the migrations folder in particular. Two migrations created from the same `main` have timestamps that reflect when each run happened, so they apply in run order, and if both alter the same table the second one has to be right about what the first one did. `prisma migrate dev` on the merged branch will tell you, which is why the message says a fresh database: let the agent reset, no, let it ask you to reset, and reset.

The push is a `synchronize` event. Lesson 8's reviewer runs again on the merged branch, and its Merge danger paragraph is now about exactly this: two migrations, one base. Read it before your colleague does. In our run **[Fill from a real run: which two tickets collided, on which files, and whether the migrations needed reordering]**.

Two ways to make the next pass collide less, both from the `implement-spec` page and both on the tickets, not in the script. Add a blocking edge between two tickets that you know share a file, so they land in different passes. Or put exact names into the spec, the way lesson 4's Testing Decisions did for seams: a shared enum, a route prefix, a table name, so two agents that never met pick the same word.

---

## 9. When the run is wrong

The script reports and stops; it never decides. Everything in this table is a decision, and it is yours.

| What you see                                                   | What it is                                                                                      | What to do                                                                                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no PR`, and the log ends with `NO PR:` and a question         | The ticket had a gap, and the brief told the agent to stop rather than guess                    | Answer it on the ticket, as lesson 7 section 7 says. Delete the branch, run the pass again; the ticket is still on the frontier                                              |
| `no PR`, and the log ends with a `[failed]` line for a command | Something the run needed isn't in the allow list, or the guard caught it                        | If it was the guard, good; read why the agent wanted it. If it was a rule, add one narrow line to `implementer.json`. Never `--trust-all-tools`                              |
| `stopped: uncommitted changes`                                 | The run ended mid-slice: a timeout, a crash, a refusal it couldn't recover from                 | `git switch` to the branch, read the log and `git status`. Either finish it interactively with `/implement-ticket #N` and "the branch has partial work", or reset the branch |
| The title in the log isn't the ticket's                        | `#N` resolved against something other than the tracker                                          | `Ctrl+C`. Check `gh repo set-default --view` is your fork                                                                                                                    |
| Tests all written first, then all the code                     | Horizontal slicing, with nobody there to object                                                 | Nothing in the script. Read the diff harder in section 7, and consider a line in the ticket's `Seams:` about slice order                                                     |
| A **not found** row at a seam the ticket named                 | The `Seams:` line didn't lead the agent, or the reviewer, to a test that exists                 | Fix the wording on the ticket. The next pass and the next review both read it                                                                                                |
| The frontier is empty                                          | Nothing is unblocked, because nothing has merged since the last pass, or the edges form a cycle | Merge section 7's pull requests, or fix the edges. The script won't invent a frontier                                                                                        |
| Two runs on the same ticket in one pass                        | Can't happen; the branch check skips it. If you see it, the branch was deleted mid-pass         | Don't delete branches while a pass is running                                                                                                                                |
| The agent edited `implementer.json`, a skill, or the workflow  | The write deny didn't hold                                                                      | Stop. `git diff` on the branch finds it. The rule is in section 4; check `kiro-cli agent validate` and the engine flag before another run                                    |

The first row is the common one, and it is lesson 7 section 7 again: the fix is on the ticket, and the run starts over. The script makes that cheap. Fix, delete the branch, run the pass with `--max 1`.

---

## 10. Three terminals instead

The pass is serial because serial is simple: one database, one checkout, one log at a time. If you want the three tickets built at once, Kiro can do that too, with the same skill and no script, as long as each run has its own directory. A git **worktree** is a second working directory attached to the same repository, on its own branch, sharing the one `.git`:

```bash
git worktree add -b ticket/18-<slug> ../erp-18 main
git worktree add -b ticket/19-<slug> ../erp-19 main
git worktree add -b ticket/20-<slug> ../erp-20 main
```

Then three terminals, one per directory, each a normal interactive session: `cd ../erp-18 && kiro-cli chat`, then `/implement-ticket #18`, and the same for the others. Each is lesson 7's run, with you saying yes to the seams in three windows. Each ends in its own pull request. Kiro treats each directory as its own workspace, with its own sessions and its own trust prompt, so nothing collides until section 8.

What a worktree doesn't have is anything git ignores: no `node_modules`, no `.env`, and no database of its own. Each one needs `pnpm install`, a copy of `.env` with `DATABASE_URL` pointing at a database of its own, `erp_18`, `erp_19`, `erp_20` on the same Postgres, and `createdb` for each, or three agents will run `migrate dev` against one database and section 3's drift arrives in the middle of a run instead of between runs. Only one worktree can run the dev servers on the default ports at a time, so the demo in section 7 is still one branch at a time. It is more to set up and three times the attention, which is why the pass above is the main path. It is the right tool when the tickets are big, the seams need a human's yes, and you have three screens.

This is also where Kiro stops. Kiro's sub-agents run in parallel but "share the workspace environment", and the CLI has no feature that gives a sub-agent a directory of its own. So an agent that orchestrates the three runs, creating the worktrees and starting the sessions itself, is a thing Kiro can't do today except by shelling out to `kiro-cli` from inside `kiro-cli`, which the implementer's deny list forbids and this lesson doesn't recommend. The harness that can is in Appendix A.

---

## 11. Read, don't run yet: the hosted versions

Two things do this loop for you, in the cloud, and both are worth one paragraph.

**Kiro Agent for GitHub.** Install the Kiro GitHub App on a fork, add the `kiro` label to an issue or comment `/kiro`, and a task runs in a sandbox of its own, branches from the default branch, commits, pushes and opens a pull request. Up to ten tasks run at once. It never merges. It is the pass from section 6 with no laptop, and three issues labelled at once are three concurrent runs. What it doesn't have is anything from your machine: no hooks, so lesson 5's guard doesn't run there, and no `.kiro/agents`, so the implementer's rules don't either. It reads the repository's skills, so `implement-ticket` is available to it if the issue says to use it.

**Cloud sessions.** `kiro-cli chat --cloud --repo <you>/<repo> --no-interactive "..."` starts the same kind of sandboxed run from your terminal, up to ten at once, and delivers a pull request. Admin-enabled, paid plans, and the same absence of hooks.

Both move the agent off your machine and keep the human exactly where this lesson keeps them: at the pull request. Neither changes what the human has to do there.

---

## 12. Check that it worked

Read `18`, `19` and `20` as your ticket numbers.

- `pnpm implement:frontier --dry-run` on a clean `main` prints your fork, your spec, and a frontier of at most three tickets with a branch name each, and builds nothing.
- `echo '{"tool_input":{"command":"pnpm implement:frontier"}}' | node scripts/agent-guard.mjs` prints the implement loop message and exits 2.
- `kiro-cli agent list` shows `implementer` as a workspace agent in `(v3 format)`, next to `erp` and `reviewer`, and `kiro-cli agent validate --path .kiro/agents/implementer.json` is silent.
- `.ai-runs/18.log`, `19.log` and `20.log` exist, each starting with Prisma's reset output and containing, as `[execute]`, `[read]` and `[edit]` lines with the agent's words between them, the ticket's title, the seams stated, and either a pull request URL or a `NO PR:` line. Next to each, `18.events.jsonl` holds every event of the run, one JSON object per line. `git status --short` doesn't list them; `.ai-runs/` is in `.gitignore`.
- `gh pr list` shows one open pull request per ticket on **your fork**, each from `ticket/<n>-...` into `main`, each with `Closes #<n>` in the body, Summary, Evidence and Merge Danger sections, a green `check` from `CI`, and at least one `<!-- ai-review -->` review from `github-actions` whose footer names the branch's head commit.
- `gh run list --workflow ai-review.yml` shows one `pull_request` run per PR that nobody started.
- `git log ticket/18-... --oneline` shows several commits, each mentioning `#18`, with at least one after the review. `git log main -1` is unchanged from before the pass.
- The three tickets are still **open**, with their boxes ticked by you and not by the agent, until a colleague merges.
- After the merges, the frontier query prints a different set of tickets, and `pnpm implement:frontier --dry-run` agrees with it.
- The agent didn't edit anything under `.kiro/`, `.agents/`, `.github/` or `scripts/` on any of the three branches: `git diff main...ticket/18-... --stat` lists none of them.

---

## Summary

- **The loop was already a script.** Lesson 7 kept every piece of state in git and on GitHub so a fresh window could pick it up. A shell script is the freshest window there is. Forty lines query the frontier, reset, branch, run, report, and go back to `main`, one new process per ticket.
- **A script orchestrates, an agent implements.** Nothing in the loop needs judgement, so nothing in the loop is given to a model. Matt Pocock's page says the same: for unattended work, a deterministic loop beats an agent making orchestration decisions.
- **Four things changed headless, and each became a file.** A slash command doesn't expand, so a saved prompt opens the skill. Every `ask` is a deny, so `implementer.json` says what is allowed and denies the human verdicts. Nobody says yes to the seams, so the prompt points at the ticket's `Seams:` line. Each ticket starts from `main`, so the script resets the database, and the guard gets an eighth rule so no agent can run the script.
- **The skill didn't change.** `implement-ticket` is still what you type interactively, and still asks a person about seams. The prompt is the headless door to the same skill, with the three differences written on it.
- **The human half is three times as long, not gone.** Reset, demo, diff, boxes, CI, the review, a colleague's merge, per pull request. The script ends by saying "Nothing merged, nothing closed", and means it.
- **Collisions are the price of parallel work.** Two branches from one `main` that touch the same files conflict when the second merges. Resolve on the branch, interactively, let the review run again, and put a blocking edge or an exact name on the tickets so the next pass collides less.
- **Kiro runs the loop; it doesn't orchestrate it.** Three worktrees and three interactive sessions build three tickets at once. An agent that creates the worktrees and runs the sessions is Claude Code's `implement-spec`, in Appendix A.

---

## Optional: try it later

**The second pass.** After your colleague has merged all three, on a clean `main`: `pnpm implement:frontier --dry-run`. The frontier is the tickets those three unblocked. Run the pass. From here on the project is passes and merges: a human merges, the frontier moves, a pass builds it, three humans review. Count how many passes the board takes.

**One ticket, watched.** `pnpm implement:frontier --max 1` on a ticket you fixed in section 9, and stay for the whole run. Compare the log with your lesson 7 window for the same kind of ticket: where it asked you, where it stated instead, and what it did with the one question it couldn't answer.

**Kiro's own version.** Read Kiro's cloud sessions and Kiro Agent for GitHub pages, then label one issue on your fork `kiro`, with the GitHub App installed, and compare the pull request it opens with the ones from section 6: same skill, no guard, no `implementer.json`. Find the difference in the diff.

---

## Appendix A: `implement-spec` in Claude Code, and the row for Codex

The thing this lesson didn't run is the skill it is named after in the skills collection: `implement-spec`, which lesson 6 section 4 described and lesson 7 section 8 said to leave. It is the same loop with the orchestrator as an agent, and today it runs as designed in one harness, Claude Code.

What it does, from its `SKILL.md`: one orchestrating session reads the spec and treats the tickets as a task graph. It may send an exploration sub-agent to leave notes in a folder outside the repository. It creates an integration branch, and then hands every frontier ticket to an **implementer sub-agent**, each in its own git worktree on its own branch, in the background. When one finishes, a **merger sub-agent** merges it onto the integration branch; if that unblocks tickets, more implementers start. When everything is merged, `code-review` runs once over the whole branch, one more sub-agent fixes what it found, and one pull request, marked as closing the spec and every ticket, is made ready for review.

Put that next to section 6 and the differences are the lesson:

| Section 6's pass                                          | `implement-spec`                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A script computes the frontier from GitHub, once per pass | The agent tracks merged tickets itself and recomputes the frontier mid-run; GitHub's count is stale    |
| One ticket at a time, one process each                    | Every frontier ticket at once, one background sub-agent and one worktree each                          |
| One branch and one PR per ticket                          | One integration branch and one PR for the wave                                                         |
| Never merges                                              | Merges every ticket onto the integration branch itself                                                 |
| A human reviews each ticket: demo, diff, boxes, merge     | A human reviews one integration branch at the end; the demo per ticket has no step                     |
| `code-review` inside each ticket's run                    | `code-review` once over everything, at the end, and a fix pass. The page reports hours on five tickets |
| Collisions surface at the second human merge              | Collisions surface at the merger sub-agent, mid-run                                                    |

The Claude Code facts that make it run, checked against its documentation: a sub-agent gets its own worktree with `isolation: worktree` on its agent file or its call; a committed `.worktreeinclude` copies git-ignored files like `.env` into every new worktree; nothing runs `pnpm install` in a new worktree unless the implementer is told to or a `WorktreeCreate` hook does; hooks from `.claude/settings.json` run inside sub-agents and worktrees, so lesson 5's guard still fires; and a skill marked `disable-model-invocation: true` can't be loaded by a sub-agent through the Skill tool, so the implementers' instructions travel in the agent prompt, not in a model-blocked skill. Postgres is the same problem as section 10: one database per worktree, or the implementers fight over `migrate dev`.

What you give up is section 7. The human moves from per ticket to per wave, and a wrong ticket is found after the tickets behind it have been built on it. The page's own caveats say the rest: a review run before every ticket lands produces phantom failures, shared files collide, there is no interactive seams step, and worktrees contain only tracked files so tests that need a local database can skip silently and report green. Run the pass from section 6 enough times to know what a bad ticket looks like before you give an orchestrator the merge.

The same steps, per tool:

| Step                 | Kiro CLI                                                                              | Claude Code                                                                           | Codex                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| One ticket, headless | `kiro-cli chat --v3 --no-interactive --agent implementer "/implement-unattended #18"` | `claude -p "/implement-ticket #18"`; the skill expands, seams still need pre-agreeing | `codex exec "use the implement-ticket skill on #18; seams are on the ticket"`                                    |
| Allow and deny       | `permissions.rules` in `implementer.json`; `ask` is deny headless                     | `--allowedTools` and `--disallowedTools`, plus the hook                               | The sandbox and approval policy, plus the hook                                                                   |
| The pass             | `pnpm implement:frontier`                                                             | The same script with the `kiro-cli` line swapped for `claude -p`                      | The same script with `codex exec`                                                                                |
| Three at once        | Three worktrees, three interactive sessions, section 10                               | The same, or `implement-spec` with background sub-agents in worktrees                 | Three worktrees, three sessions; sub-agents run in parallel but the parent waits and worktrees aren't documented |
| The guard            | The hook in the agent file                                                            | `.claude/settings.json`, applies in sub-agents and worktrees                          | The hook from lesson 5 Appendix A                                                                                |

---

## Further reading

- Matt Pocock, [implement-spec](https://www.aihero.dev/skills-implement-spec) and [implement](https://www.aihero.dev/skills-implement): the orchestrating skill this lesson didn't run, its caveats, and the sentence about deterministic loops; and the [skills collection](https://github.com/mattpocock/skills) for `SKILL.md` itself.
- Kiro, [Headless mode](https://kiro.dev/docs/cli/headless/): `--no-interactive`, `ask` as deny, hooks loading headless since 2.27.1, and the six-hour workflow timeout.
- Kiro, [Permissions](https://kiro.dev/docs/permissions/) and [Custom agent configuration reference](https://kiro.dev/docs/custom-agents/configuration-reference/): the rule syntax in `implementer.json` and why deny beats allow.
- Kiro, [Manage prompts](https://kiro.dev/docs/cli/chat/manage-prompts/): saved prompts, `/name arguments` on V3, and the `${1}` placeholders.
- Kiro, [Subagents](https://kiro.dev/docs/custom-agents/subagents/) and [Managing workflows](https://kiro.dev/docs/workflows/manage/): "share the workspace environment", and "use separate worktrees or workspaces when runs can edit the same files".
- Kiro, [Kiro Agent for GitHub](https://kiro.dev/docs/web/github/) and [Cloud sessions](https://kiro.dev/docs/cloud-sessions/): the hosted versions in section 11.
- Git, [git-worktree](https://git-scm.com/docs/git-worktree): what section 10 creates.
- Prisma, [Development and production: `migrate reset`](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production): why the database is reset between tickets, and what `--force` skips.
- Claude Code, [Worktrees](https://code.claude.com/docs/en/worktrees), [Subagents](https://code.claude.com/docs/en/sub-agents) and [Headless](https://code.claude.com/docs/en/headless): the facts behind Appendix A.
- Lesson 5 section 4, lesson 7 sections 5 and 7, lesson 8 sections 3 and 8: the guard this lesson extends, the human half it repeats, and the agent file it copies.
