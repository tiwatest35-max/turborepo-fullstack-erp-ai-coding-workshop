# Lesson 8: An AI reviewer on every pull request: Kiro in GitHub Actions

**Time:** about 45 minutes, plus 30–40 minutes for the second turn in section 8 and 10–15 minutes for section 9
**Goal:** put a read-only reviewer agent on your fork that reads the ticket, the diff and the PR body of every pull request, runs one committed review skill on them with a pinned model, writes one review in a fixed shape that the job checks and posts as a comment, and never approves, merges or closes anything. Then let a human merge the lesson 7 pull request with that review as their script, and run the loop once more so the next pull request gets its review without anyone asking.

By the end of this lesson you should be able to answer three questions:

1. What can a reviewer that never saw the code being written find that the author's own review can't, and what can it still not do?
2. How do you make an agent read-only, and why is "never approve, never merge" enforced three times instead of asked once?
3. Why is the AI review advice for the human reviewer, and not a GitHub state?

Lesson 7 ended with a pull request open on your fork and a rule: it merges when a human who isn't the author has read it. That human is going to be busy, and the PR is going to be one of many. This lesson gives them a colleague. Every pull request on your fork gets a review from an agent that opened it cold, under the same guard and the same `AGENTS.md` as every other agent in the repository. The review is advice. The verdict and the merge stay human.

---

## 1. What this is, and what it is not

![Top to bottom in four rows. First, a trigger: a push to the pull request branch, or a manual dispatch with the PR number. Second, a GitHub Actions job that checks out the repository, installs Node and Kiro CLI, and runs kiro-cli headless with the reviewer agent and the API key from a repository secret. Third, the reviewer agent, an amber row, reads four things: the ticket, the diff against main, the pull request body and the CI status, under the same guard hook as every other agent, with read-only permissions. Its only write is one review file, which the job posts as a comment-state review on the pull request. A red strip in the row says: never approves, never requests changes, never merges, never closes. Fourth, the human: reads the review as a script, runs the demo line, reads the diff against the criteria, and merges by hand. A note across the bottom says: the review is advice; the verdict and the merge are a human's.](images/ai-review.svg)

You have met this product category. CodeRabbit, GitHub Copilot code review and a dozen others install as a GitHub App, read every pull request and leave comments. They are good, and if your company pays for one, use it. This lesson builds the small version by hand, for three reasons that matter more in this repository than the polish does:

| Hosted reviewer                     | The one you build here                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Reviews the diff with its own brief | Reviews the diff **against your ticket's acceptance criteria** and your `AGENTS.md`. The checks are a skill in the repo you can edit |
| Knows your code, not your process   | Knows the `Covers:`, `Demo:` and `Seams:` lines from lesson 4 and the Evidence section from lesson 7's `pr` skill                    |
| Runs under the vendor's permissions | Runs under **the same guard hook** as lesson 5 and a read-only permission set you can read in thirty seconds                         |

Kiro also has a GitHub App of its own, part of Kiro Web. It implements issues and fixes review comments on its own pull requests, and its documentation says it never merges. It is not documented as a reviewer of other people's pull requests, so this lesson doesn't use it. One mention is all it needs.

What the reviewer is **not**: it is not the human in lesson 7's rule. Lesson 6 explained why a fresh window finds things the author's window can't, and lesson 7 said why even two fresh sub-agents weren't enough: they were briefed by the author and never ran the app. This reviewer fixes the first problem. It picks the branch up cold, with the ticket as its only brief. It does not fix the second. There is no database and no app in the review job, and the `Demo:` line is still yours. So the review's last line is a **verdict for the human reviewer**, not an approval. GitHub will show it as a comment, never as a green tick.

---

## 2. Before you start

You need your fork from lesson 7, on `main`, with the lesson 7 PR still open:

```bash
git switch main && git pull
git status --short                                   # expect: nothing
gh pr list                                           # expect: the ticket/16-... PR, open
gh repo set-default --view                           # expect: <you>/<repo>, from lesson 7
gh workflow list                                     # expect: CI, from lesson 7
kiro-cli update && kiro-cli --version                # same as lesson 5
```

Then two things no earlier lesson needed.

**Pull this lesson's files from the workshop repository.** Lessons 4 to 7 put things on your fork: the tickets, the `pr` and `implement-ticket` skills, one pull request. This lesson's files went the other way. The reviewer agent, the `review-pr` skill, the workflow and the `.ai-review/` line in `.gitignore` are on the workshop repository's `main`, and your fork doesn't get them until you ask. Lesson 4's `gh repo fork --remote` kept the workshop as `upstream` for exactly this. Hand it to the `erp` agent, in a fresh session on `main`:

```
Bring my fork's main up to date with the workshop repository. The workshop is the upstream remote,
VaridenTech/turborepo-fullstack-erp-ai-coding-workshop; add it if it is missing. Fetch it and merge
upstream/main into main with a merge commit. Do not rebase and do not force-push: an open pull request
branches from main. If the merge has conflicts, stop and show me the files; do not resolve them yourself.
When the merge is clean, push main to origin and show me `git log --oneline -3` and `gh workflow list`.
```

What you should see it run, and what to check when it is done:

```bash
git remote -v                                        # expect: origin = your fork, upstream = VaridenTech/turborepo-fullstack-erp-ai-coding-workshop
git fetch upstream
git merge upstream/main                              # brings reviewer.json, reviewer.md, review-pr, ai-review.yml, .gitignore
git push                                             # Actions only runs a dispatched workflow that is on your fork's default branch
ls .kiro/agents .agents/skills/review-pr             # expect: reviewer.json, reviewer.md; SKILL.md and agents/
gh workflow list                                     # expect: CI and AI review
```

Three things in that prompt are there for a reason. Merge, not rebase, because the lesson 7 pull request branches from your `main` and rewriting `main` under it would need the force-push lesson 5's guard refuses. Conflicts come back to you, because a conflict is in a file you changed in lesson 4 or 7, not in anything this lesson adds, and the agent doesn't know which side you want: keep yours there, `upstream`'s for anything under `.kiro/agents`, `.agents/skills/review-pr` and `.github/workflows`, then `git add` and `git commit` to finish. And the push happens now, before you read a line of the workflow, because `workflow_dispatch` in section 6 only sees a workflow that is already on the fork's default branch.

**A Kiro API key.** Everything so far ran Kiro with the login in your terminal. A GitHub Actions runner has no browser and nobody to press "allow", so headless Kiro authenticates with an API key in the `KIRO_API_KEY` environment variable instead. Two facts about that key, from Kiro's documentation: it is a **long-lived credential**, and it is only available on **Kiro Pro and above**. Create your own at app.kiro.dev under API Keys, and treat it like a password: your fork's secret store and your shell, nowhere else, and never in a file in the repository.

```bash
gh secret set KIRO_API_KEY                           # paste the key when prompted; stored on your fork, encrypted
gh secret list                                       # expect: KIRO_API_KEY
```

Don't share one key across the room. Twenty forks with one long-lived credential in them is exactly the thing lesson 5 exists to prevent, and revoking it would stop everyone's reviews at once.

If you are on the free tier, you can still do sections 3 and 4 and run section 5's command once your key exists; skip section 6 and read it instead. The agent and the skill are the lesson. Actions is where they run.

---

## 3. The reviewer agent

Lesson 3 built the `erp` agent so the project, not your home directory, decides what the agent loads. This lesson adds a second agent with a different job, and the difference between the two files is the lesson. Open `.kiro/agents/reviewer.json`:

```json
{
  "name": "reviewer",
  "description": "Read-only pull request reviewer for this ERP repository. ...",
  "prompt": "file://reviewer.md",
  "model": "claude-sonnet-5.5",
  "tools": ["read", "write", "shell"],
  "includeMcpJson": false,
  "includePowers": false,
  "resources": [
    "file://../../AGENTS.md",
    "file://../../apps/api/AGENTS.md",
    "file://../../apps/web/AGENTS.md",
    "skill://.kiro/skills/review-pr/SKILL.md"
  ],
  "permissions": {
    "rules": [
      { "capability": "fs_read", "match": ["./**"], "effect": "allow" },
      { "capability": "fs_write", "match": [".ai-review/**"], "effect": "allow" },
      {
        "capability": "fs_write",
        "match": ["./**"],
        "exclude": [".ai-review/**"],
        "effect": "deny"
      },
      {
        "capability": "shell",
        "match": [
          "mkdir -p .ai-review*",
          "gh pr view *",
          "gh pr diff *",
          "gh pr checks *",
          "gh issue view *",
          "git log *",
          "..."
        ],
        "effect": "allow"
      },
      {
        "capability": "shell",
        "match": [
          "gh pr merge *",
          "gh pr review *",
          "gh pr comment *",
          "gh pr close *",
          "gh issue close *",
          "gh api *",
          "git push *",
          "..."
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

The full file has the complete lists. The picture is the file, field by field, and the paragraphs under it are the parts a picture can't carry: the things that cost us a run each.

![Five rows, each pairing a field of reviewer.json on the left with what it means on the right. First, prompt: file://reviewer.md. The brief is a file, Markdown next to the agent, diffable, and its first instruction is to read the skill in full. Second, model: claude-sonnet-5.5. The model is pinned so the laptop and the runner run the same one instead of auto; Sonnet 5.5 costs 1.3x credits and Opus 5.5 2.0x; effort is not a field, so --effort high goes on the command and the footer records both. Third, resources: three AGENTS.md files and skill://.kiro/skills/review-pr/SKILL.md. A skill resource puts the name in front of the model, not the text; the brief opens the file; no tdd, implement, pr or code-review. Fourth, an amber row, permissions.rules, as a table with allow and deny columns: fs_read allows the whole checkout; fs_write allows only .ai-review and denies everything else with that directory excluded; shell allows gh pr view, diff and checks, gh issue view, git log and mkdir, and denies gh pr merge, review, comment and close, gh issue close, gh api, git push and commit. Two notes: deny beats allow, so the exclude line keeps the output directory writable; and .ai-review is inside the checkout because a write outside the workspace is an ask. A red strip says: headless, every ask is a deny; never --trust-all-tools. Fifth, hooks: agent-guard, the same guard as lesson 5; the rules are Kiro's, the guard is ours and runs in Claude Code and Codex too. A banner at the bottom says: V3 only. Rules and skill resources are V3 fields; every command passes --v3; on V2 the agent is not found.](images/reviewer-agent.svg)

**The brief is a file.** `"prompt": "file://reviewer.md"` points at Markdown next to the agent, which can be diffed and reviewed; the same text escaped inside a JSON string can't. Section 4 reads it.

**The resources are three rule files and one skill.** A `skill://` resource puts the skill's name in front of the model, not its text: lesson 2's progressive disclosure. So the brief's first instruction is to read `.kiro/skills/review-pr/SKILL.md` in full before touching the pull request, and in our probe it did, and reported six checks back. It doesn't use `code-review`: that skill spawns two sub-agents, and Kiro's headless documentation doesn't say whether sub-agents run there.

**The model is pinned** so your laptop and the runner run the same one instead of `auto`, which picks per task. The IDs and credit multipliers come from `kiro-cli chat --list-models`. Effort isn't a field, so it is `--effort high` on the command, by hand in section 5 and from one workflow variable in section 6. If the pinned model isn't available to the account, headless Kiro warns on stderr and continues on the default rather than failing, which is why the job writes the model it used into the review's footer.

**The permissions make it read-only,** and `deny` beats `allow`. Three lines cost us a run each. `.ai-review/` is inside the checkout and in `.gitignore`, not under `/tmp`, because Kiro sends every write outside the workspace to `ask` whatever the rules say: our first version pointed at `/tmp/ai-review/`, and the agent finished the review and couldn't save it. The repository-wide write deny carries `"exclude": [".ai-review/**"]`, because without it the deny would cover the output directory too. And the rule that makes any of this work in CI is one line in Kiro's documentation: **in headless mode, every `ask` is treated as a deny.** That is why the workflow never passes `--trust-all-tools`, which turns every `ask` into an `allow` and hands the agent back every command the deny list doesn't name. Posting is in the deny list next to merge, close and push; it is the workflow's job, in section 6.

**The hook is lesson 5's guard,** same matcher, same script. The rules are Kiro's; the guard is ours and runs in Claude Code and Codex too.

**It only exists on the V3 engine.** Permission rules and `skill://` resources are V3 fields. On `kiro-cli 2.34.0` the default engine is V2, and V2 stops with `Mode 'reviewer' not found`, because its way to say "read-only" is `allowedTools`, which can't express "write only under `.ai-review/`". Every command in this lesson passes `--v3`, which overrides the default for that run. If you set `chat.agentEngine` to `v3` in lesson 3, the flag is redundant and harmless.

Check that Kiro reads the file:

```bash
kiro-cli agent validate --path .kiro/agents/reviewer.json     # expect: no output, exit 0
kiro-cli agent list                                           # expect: reviewer  Workspace  (v3 format) ...
```

In our run on `kiro-cli 2.34.0` the validator accepted the file and the list showed both `erp` and `reviewer` as `(v3 format)`.

---

## 4. The skill and the brief

![Top to bottom in three rows. First, the brief, reviewer.md, a slate row: not the author, read-only, a refused command is reported and never worked around, run review-pr on the pull request number. The agent file next to it pins the model and loads the skill. Second, the skill, review-pr, an amber row with four bands. Reads: the PR and its body, the ticket from the Closes line and the spec it points at, the diff and every test file it touches, CI status, the three AGENTS.md files; never the app. Checks, six boxes in a row: Criteria, Standards, Security, Test adequacy, Evidence, Merge danger. Grades: Blocker gives Do not merge yet, Should fix gives Read the findings first, Nit is dropped, no findings gives Looks mergeable after the demo; the verdict follows the highest level present. Writes: one file, .ai-review/review.md, in a fixed template with a marker, a verdict line, a criteria table, findings with a level and a file and line, evidence, merge danger and questions. Third, the job, a green row: checks the marker, one verdict line, the five headings and that a Blocker means Do not merge yet, appends model, effort, commit and run, and posts with --comment. A file that fails a check never reaches the PR.](images/review-pr-skill.svg)

Open `.agents/skills/review-pr/SKILL.md`. It is the whole review, and it is about two pages. It is a skill rather than a paragraph in the agent file for the reason lesson 2 gave: one kind of task, done many times, the same for everyone. Claude Code and Codex in Appendix A read the same file through the symlinks in `.claude/skills` and `.kiro/skills`, and a person can run it by hand with `/review-pr #18` in any of the three tools. Its frontmatter says `disable-model-invocation: true`, like lesson 7's `pr` skill, so the `erp` agent sees it in the list and can't start it on its own.

The brief in `.kiro/agents/reviewer.md` is what is left once quality moved out: who it is, that it is read-only, that a refused command is something to report and never to work around, and "run `review-pr` on `#N`". The refusal sentence is for the dumb zone: an agent that hits a denied command will otherwise try `gh api` and then a `curl`. The skill's shape:

**What it reads.** The PR by number; the ticket from the `Closes #T` line in the PR body; the spec if the ticket points at it; the diff, and every test file it touches in full; CI status with `gh pr checks`. It does not run tests, typecheck or build, because CI already did, and it does not start the app or the database.

**What it checks, in order.** The four things you did by hand in lesson 7 section 5, minus the one that needs the app, plus two that a human reviewer skips when they are in a hurry:

| Check             | What it does                                                                                                                                                                                          | Why it is on the list                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Criteria**      | For every acceptance criterion on the ticket, find the test or code line that makes it true, with file and line, or write **not found**                                                               | Lesson 7's "a criterion you can't find is a criterion the agent decided was already satisfied", done by a reader with no stake in the answer |
| **Standards**     | The diff against `AGENTS.md`: contract-first, `.js` on relative imports, the `@/` alias in the web app, tests at the named seams                                                                      | The Standards pass from lesson 6, without the author writing the brief                                                                       |
| **Security**      | Every new route carries the guard and the role the ticket names; input only through the contract's Zod schemas; no string-built SQL; no secrets in the diff; env vars validated and in `.env.example` | The one category where a miss costs more than a re-review. Every Security finding is a Blocker                                               |
| **Test adequacy** | A criterion is proven only by a test at a named seam that asserts the outcome, isn't skipped, and doesn't mock the thing under test. Red or missing CI is a Blocker                                   | Lesson 7's run wrote tests; this asks whether they prove anything. A green test that mocks the guard it tests proves the mock                |
| **Evidence**      | Could a reviewer who wasn't in the room reproduce the `Demo:` line from the PR body alone? What is missing?                                                                                           | The Evidence section exists for the human reviewer. This checks it is usable before they open it                                             |
| **Merge danger**  | Migrations, whether they reverse and what they do to existing rows, seed, shared packages, renamed routes or schemas, what the blocked tickets inherit. An edited applied migration is the first line | Lesson 7's "an unproven ticket that closes opens the gate for everything behind it"                                                          |

**How it grades.** Every finding carries one of three levels, and the levels decide the verdict:

| Level          | Means                                                                                                              | Verdict it forces                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **Blocker**    | A criterion unproven, an `AGENTS.md` rule broken, a Security finding, CI not green, an applied migration edited    | `Do not merge yet`                                    |
| **Should fix** | An evidence gap, a risky migration or seed change, a missing `Closes` line, a test that proves less than it claims | `Read the findings first`                             |
| **Nit**        | Anything else. Never written down; the formatter and the human have them                                           | None. No findings is `Looks mergeable after the demo` |

The verdict follows from the highest level present, not from the model's overall impression. That is what makes two runs on the same diff land on the same verdict, and it is what lets the job in section 6 check the verdict against the findings before it posts. A model asked for its impression gives a different one each run; a model asked to apply a rule mostly applies it, and when it doesn't, the job notices.

**What it writes.** One file, `.ai-review/review.md`, in a fixed template: a verdict line for the human, a criteria table, findings with a level, a file and a line, Evidence, Merge danger, questions for the author. A hidden `<!-- ai-review -->` marker so later runs can find earlier ones. It does not post the file. The workflow posts it in section 6, and in section 5 you do, after reading it. Every run is a new review rather than an edit of the old one; the human reviewer wants the history, and so does the author who pushed a fix.

**Why the agent doesn't post.** GitHub has three review states. Approve and request changes are verdicts, and lesson 7's rule says the verdict belongs to a human who isn't the author. An agent that approves is the author's agent approving the author's work with extra steps. So the verdict line in the review says `Looks mergeable after the demo`, `Read the findings first` or `Do not merge yet`, in words, as advice, and the GitHub state is chosen by whoever posts the file: one line in the workflow that says `--comment`, which a human reads in a diff, instead of a flag the model picks at run time. The permission rules deny every posting command to the agent, the posting step in the workflow is the only place a review state is chosen and it is not the agent's to run, and the brief says not to. Three times, because an instruction is the weakest of the three and the only one that lives in the prompt.

Read the template at the bottom of the skill once, and then read the review it produces in section 5 against it. Where the two differ, the skill is what you edit. The brief only changes when the agent does something it was told not to do.

---

## 5. Prove it locally first

Before the workflow exists, run the exact command it will run, on your laptop, against the lesson 7 PR. Debugging a headless agent through Actions logs is the slowest way to meet it. Kiro's documentation says headless mode needs the API key, and on the runner it does. On `kiro-cli 2.34.0` a laptop that is already logged in ran `--no-interactive` on the login alone in our probes, so if your key hasn't arrived yet, try the command without the `export` line first. When you do use the key, put it in this shell only:

```bash
export KIRO_API_KEY="..."                            # this terminal only; don't add it to your profile
gh pr list                                           # note the PR number; ours was 18
kiro-cli chat --v3 --no-interactive --agent reviewer --effort high "Review pull request #18."
```

`--v3` selects the engine that reads the permission rules; `--no-interactive` is headless mode, which needs the instruction as an argument and uses the key; `--agent reviewer` picks the file from section 3 instead of `cli.json`'s default `erp`, and the model with it; `--effort high` is the reasoning effort for this run, the one setting the agent file can't hold. Nothing else: no `--trust-all-tools`, for the reason in section 3.

### What you'll see

The run prints its tool calls as it goes, and it has a shape:

1. **It reads before it writes.** `gh pr view`, then `gh issue view` on the ticket from the `Closes` line, then `gh pr diff`, then whole files from the checkout where the diff needs context, then `gh pr checks`. If it tries anything outside that list, you see Kiro refuse it, and the brief and the skill both tell it to carry on and report the refusal.
2. **It writes one file**, `.ai-review/review.md`, and nothing else. If it tries to post it, with any flag, you see Kiro refuse the command, and the brief tells it to carry on.
3. **It says the file is written and stops.** Two to six minutes, well under the tokens lesson 7's run took, because it reads a diff instead of exploring a codebase.

**[Fill from a real run]** the console output of one run, trimmed to the tool calls and the final URL, and the time it took.

Read the file, then post it yourself. This is the only time a person posts the review by hand, and it is worth doing once, because the command is the one the workflow runs in section 6:

```bash
cat .ai-review/review.md
gh pr review 18 --comment --body-file .ai-review/review.md
```

Open the PR on github.com. The review is there, from you, in comment state, with the template from section 4 and no footer: the model, effort and commit line is the job's to add in section 6, not the agent's. Read it against the lesson 7 ticket:

- Does the criteria table have a row per criterion, quoted verbatim, each with a file and line or **not found**? Open one `not found` row and check it is really not there. In our run **[Fill from a real run: how many rows, how many not found, and whether the not-found ones were right]**.
- Does every finding carry **Blocker** or **Should fix**, and does the verdict match the highest one present? If not, the job in section 6 would have refused to post this review, and the Severity table in the skill is where to look.
- Are the findings things `AGENTS.md` actually says? A finding that cites a rule not in the file is the skill drifting, and the fix is in `SKILL.md`, not in the code.
- Does the Evidence paragraph say the same thing you concluded in lesson 7 section 5 when you did the demo?

If the run refused something it needed, or needed something the allow list doesn't have, the fix is in `reviewer.json`'s allow list, one glob, as narrow as the command. Don't reach for `--trust-all-tools`. The one thing a glob can't fix is a write outside the checkout; keep the output under `.ai-review/`.

---

## 6. Put it in Actions

Now the same command, on every pull request, with nobody at the keyboard. Open `.github/workflows/ai-review.yml`. It is its own workflow, not a step in `ci.yml`, and that separation is the first decision:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:
    inputs:
      pr: { description: Pull request number to review, required: true, type: string }

permissions:
  contents: read
  issues: read
  pull-requests: write

concurrency:
  group: ai-review-${{ github.event.pull_request.number || inputs.pr }}
  cancel-in-progress: true
```

| Part                              | Why                                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Its own file                      | CI is a test and may block a merge. This is an opinion and may not. Keeping them apart means a slow model, an empty credit balance or a bad review can never turn CI red                                                              |
| `opened, synchronize, reopened`   | Every push to the PR branch gets a fresh review, the CodeRabbit behaviour                                                                                                                                                             |
| `workflow_dispatch` with `pr`     | Review a PR that already exists, like lesson 7's, without pushing to it. Also "review it again" on demand                                                                                                                             |
| `permissions`                     | The job's `GITHUB_TOKEN` can read the repo and issues and write pull request reviews, nothing else. It can't push, and the permission rules stop the agent asking it to merge                                                         |
| `concurrency`                     | Two pushes in a minute start one review, not two. The second run cancels the first                                                                                                                                                    |
| `continue-on-error` on the review | The step's exit code never marks the PR red. An advisory check that fails loudly teaches people to ignore it                                                                                                                          |
| `timeout-minutes: 20`             | A stuck agent is a stuck runner. Kiro's own default headless timeout is six hours                                                                                                                                                     |
| `actions/setup-node`              | The guard hook is `node scripts/agent-guard.mjs`. No Node, no guard, and the hook would fail open. `package-manager-cache: false`, because this job never installs pnpm and the cache step would fail looking for it                  |
| The `KIRO_API_KEY` check          | Pull requests opened from **other** forks don't receive your secrets, by GitHub's design. The step says so in the log and exits 0 instead of failing. Your own branches, like lesson 7's, get the key                                 |
| `EFFORT: high`                    | The one knob the agent file can't hold. The review step passes it to `--effort`, and the footer records it, so what ran and what was asked are the same variable                                                                      |
| The `Post the review` step        | The agent only writes the file. This step checks the file has the shape the skill asked for, appends a footer, and posts with `--comment`. A file that fails a check gets a one-line comment with the reason and the run link instead |

The review step is the command from section 5 with the PR number from the event, the install line is the one from Kiro's headless documentation, and the posting step is the command you ran by hand at the end of section 5, behind the checks:

```yaml
- name: Install Kiro CLI
  run: curl -fsSL https://cli.kiro.dev/install | bash

- name: Review the pull request
  id: review
  continue-on-error: true
  env:
    KIRO_API_KEY: ${{ secrets.KIRO_API_KEY }}
  run: |
    mkdir -p .ai-review
    kiro-cli chat --v3 --no-interactive --agent reviewer --effort "$EFFORT" "Review pull request #${PR_NUMBER}."

- name: Post the review
  if: steps.review.outputs.skipped != 'true'
  run: |
    FILE=.ai-review/review.md
    [ -s "$FILE" ]                       || reject "the reviewer did not write .ai-review/review.md"
    grep -q '<!-- ai-review -->' "$FILE" || reject "the review has no ai-review marker"
    grep -Eq '^\*\*Verdict for the human reviewer:\*\* `(Looks mergeable after the demo|Read the findings first|Do not merge yet)`' "$FILE" \
                                         || reject "the verdict is not one of the three allowed values"
    if grep -q '\*\*Blocker\*\*' "$FILE" && ! grep -q '`Do not merge yet`' "$FILE"; then
      reject "the review has a Blocker but the verdict is not Do not merge yet"
    fi
    MODEL=$(node -p "require('./.kiro/agents/reviewer.json').model")
    printf '\n---\n\nModel `%s`, effort `%s`, reviewed commit `%s`, [run log](%s).\n' "$MODEL" "$EFFORT" "$HEAD_SHA" "$RUN_URL" >> "$FILE"
    gh pr review "$PR_NUMBER" --comment --body-file "$FILE"
```

The full file has two more checks, for exactly one verdict line and for the five headings, and `reject` is a four-line function: print the reason as a warning, print the file into the log, leave a one-line comment on the PR with the reason and the run URL, exit 0. A review that fails a check never reaches the PR, and a silent empty run is the one failure a reviewer can't notice from the PR, so the comment is there instead.

Two things about those lines. The checks are the shape the skill asked for, enforced by the job instead of asked of the model: the skill says the verdict follows from the severities, and the job refuses a file where it doesn't. And the footer is the job's, which is why the review you posted in section 5 has none. The model ID is read out of `reviewer.json`, so it is written in one place, and the commit is the PR head at review time, so the human can tell whether a later push made the review stale.

**[Verify in a real run]** that `kiro-cli` is on `PATH` in the step after the installer, as the official example assumes. If it isn't, add the installer's target directory to `$GITHUB_PATH` in the install step.

The `gh` CLI is preinstalled on GitHub's runners and reads `GH_TOKEN` and `GH_REPO` from the job's environment, so the agent's `gh pr view` reads, and the job's `gh pr review` posts, as `github-actions` on your fork without any extra setup.

### How the job finds the agent and the skill

![Top to bottom in four rows. First, the checkout, a slate row: actions/checkout puts the repository at the job's working directory. On pull_request that is the merge of the PR into main, so the agent, the skill and the workflow are the pull request's versions. A file list shows what is in the checkout: the workflow, reviewer.json, reviewer.md, the .kiro/skills/review-pr symlink into .agents/skills/review-pr, the real SKILL.md, and the guard hook script. Second, kiro-cli, a slate row: run from that directory with --agent reviewer, it discovers the workspace agent in .kiro/agents, the same way kiro-cli agent list does on a laptop. Nothing is installed or registered. Third, the reviewer agent, an amber row, loads reviewer.json in three parts: the model pin and the permission rules; the resources line, skill://.kiro/skills/review-pr/SKILL.md, which puts the skill's name in front of the model and not the file; and the prompt, reviewer.md, whose first instruction is to read .kiro/skills/review-pr/SKILL.md in full. That instruction opens the file, through the symlink, to the one copy in .agents/skills that Kiro, Claude Code and Codex all read. Fourth, the skill, a green row: it runs the six checks and writes .ai-review/review.md, and the job checks the shape and posts it with --comment. A note at the bottom says what lives where: everything in the checkout, Node and kiro-cli and gh on the runner, the key in a secret.](images/job-finds-skill.svg)

Nothing in the workflow installs the agent or registers the skill. They arrive the same way every other file does, in the checkout, and the four rows of the picture are the four hops from that checkout to a review.

**The checkout.** `actions/checkout` puts the repository at the job's working directory, with `fetch-depth: 0` so the diff against `main` is there. That directory contains `.kiro/agents/reviewer.json`, the brief next to it, the `.kiro/skills/review-pr` symlink and the real `SKILL.md` under `.agents/skills`, the guard hook and the workflow itself. Git stores the symlink as a symlink, the Ubuntu runner restores it, and the `setup-node` step gives the hook its Node. Which checkout matters. On `pull_request` the job checks out the merge of the PR into `main`, so the agent, the skill and the workflow are the pull request's versions of those files. A PR that edits `reviewer.md`, `review-pr` or `ai-review.yml` is reviewing itself with its own rules, which is the one kind of PR to read before you read its review. `workflow_dispatch` checks out `main`, which is why section 2 pushed there.

**`kiro-cli`, run from that directory.** Workspace agents are discovered in `.kiro/agents/` under the directory the command runs in, the same way `kiro-cli agent list` finds them on your laptop, and from nowhere else. So `--agent reviewer` means the file in the checkout and nothing else. One thing we checked rather than assumed: a V3 headless run in a folder Kiro has never seen loads the workspace agent, its model pin and its permission rules without a trust prompt. We ran the reviewer in a fresh copy of the repository and it refused a denied command the same way it does in the trusted one.

**The agent loads `reviewer.json`, in three parts.** The model pin and the permission rules, which section 3 covered. The resources line, `skill://.kiro/skills/review-pr/SKILL.md`, which puts the skill's name in front of the model and not its contents, as section 3 said. And the prompt, `reviewer.md`, whose first instruction is to read `.kiro/skills/review-pr/SKILL.md` in full before touching the pull request. That one line is what opens the skill. It reads through the symlink to the single copy in `.agents/skills/review-pr`, the same copy Claude Code reads through `.claude/skills` and Codex through its `agents/openai.yaml`, so an edit to the skill changes the review in the job and in all three tools at once.

**The skill takes over.** From here the run is section 4's diagram: the six checks, the severities, the template, one file written to `.ai-review/review.md`. The agent exits, and the job's posting step checks the shape and posts the file with `--comment`.

Three places, then. The checkout holds the agent, the brief, the skill, the hook and the workflow. The runner holds Node, `kiro-cli` and `gh`. The secret holds the key. If the review ever behaves differently in Actions than it did in section 5, the difference is in one of those three, and the first two are files you can diff.

### Check it is on `main`

Everything this lesson added is repository configuration, and like lesson 5's hook and lesson 7's `pr` skill it lives on `main`, not on a ticket branch. The merge in section 2 put it there and pushed it, so this is a check, plus one commit if you edited anything while reading sections 3 to 5:

```bash
git log --oneline -1 upstream/main                   # the workshop commit your main now contains
git branch --contains upstream/main                  # expect: main
git status --short                                   # expect: nothing, or the file you edited
git add -A && git commit -m "Tune the AI reviewer"   # only if status showed something
git push
gh workflow list                                     # expect: CI and AI review
```

### Run it on the lesson 7 PR

The PR was opened before the workflow existed. A `pull_request` workflow on `main` applies to it on its next push, but you aren't going to push to it, so use the dispatch:

```bash
gh workflow run ai-review.yml -f pr=18
gh run watch                                         # pick the AI review run
```

Then open the PR. A second review from `github-actions`, same template, probably a few findings different from the local one in section 5: same skill, different run. **[Fill from a real run]** the run time from the Actions page and one line on how the two reviews differed.

Three things to notice. The hook fires: every shell command the agent ran shows the guard being consulted first, in a runner nobody is watching. That is lesson 5's argument finished: a hook runs whether or not anyone is there. The review is posted in a separate step, after the agent has exited. The agent never held the ability to post. And the posted review ends with a line the agent didn't write and couldn't have: model, effort, commit, run. The job knows those four things and the agent knows none of them. The `pull_request` row of the trigger, the one the workflow is really for, still hasn't fired. Section 8 is where it does.

---

## 7. Your turn: demo, diff, merge by hand

Nothing above changed lesson 7's rule. A human who isn't the author reads the pull request before it merges. What changed is what they open it with: a verdict line, a criteria table with file and line for every criterion, a list of what the Evidence section doesn't say. That is a script.

Swap with a colleague. On their fork, with their PR:

1. **Read the AI review first**, top to bottom. Note the verdict and every **not found** row.
2. **Do the `Demo:` line** from the PR body's Evidence section, on your machine, with their branch checked out and the app running. The review told you whether the section is good enough to follow. If it isn't, that is a comment on the PR, from you.
3. **Open every `not found` row** and decide: is the criterion really unproven, or did the reviewer miss it? Either answer is a one-line comment.
4. **Read the Merge danger paragraph** against `git log main..` on their branch. Migrations and seed changes especially.
5. **Merge, by hand**, if it holds. `gh pr merge <n> --squash`, from your terminal, as you. Not from an agent, not from the workflow. The permission rules would refuse an agent anyway; this step is the reason they do.

Then run lesson 7's frontier query on their fork. The ticket is gone from it, the tickets it blocked have appeared, and the spec's progress bar has moved. That is the gate opening, for the first time in the course, and it opened because a human read a review and ran a demo, with an agent's notes in one hand. Section 8 picks one of those tickets up.

Working alone? Review and merge your own PR the same way, and know that it is the weaker form: the AI review is cold, but you are not.

---

## 8. The second turn: a ticket, a PR, and a review nobody asked for

Every review so far was started by hand. Section 5 ran the command, section 6 ran the dispatch, and both reviewed a pull request that existed before the workflow did. The row the workflow is for, `opened, synchronize, reopened`, hasn't fired once. It fires when a pull request is opened on your fork, and section 7 just opened the gate for exactly that: your lesson 7 ticket is merged, and the tickets it blocked are on the frontier. So run lesson 7 once more, on your own fork, end to end, and start nothing by hand this time. The ticket comes from the frontier, the pull request comes from `/implement-ticket`, and the review comes from the push.

### Pick the ticket

Your colleague merged on github.com, so your local `main` is behind:

```bash
git switch main && git pull                          # the squash commit from section 7
git branch -d ticket/16-roles-and-stores             # your lesson 7 branch; it is merged
gh issue view 16 --json state -q .state              # expect: CLOSED, by the merge
```

Then lesson 7's frontier query. In lesson 7 it printed one line and in section 7 it printed the same line; now `#16` is gone and the tickets it blocked are there:

```bash
gh api "repos/{owner}/{repo}/issues/<spec number>/sub_issues" --paginate \
  --jq '.[] | select(.state=="open" and .issue_dependencies_summary.blocked_by==0) | "#\(.number)  \(.title)"'
```

Pick the smallest number. The rest of this section calls it `#17`; type your own. Read it the way lesson 7 section 4 said, `gh issue view 17`, and check its `Covers:`, `Demo:` and `Seams:` lines before you start, not during.

### Run the turn

```bash
git switch -c ticket/17-<slug from its title>
```

Then, in Kiro CLI, `/clear`, and `/context show`. One line is new since lesson 7: `review-pr` is in the skill list, because section 2 merged it. The `erp` agent can see it and can't start it, the frontmatter says so, and that is the right shape: the implementing agent is the author, and an author running the review skill on its own diff is lesson 6's warm window again. The review happens in the job, not in this window.

```
/implement-ticket #17
```

Everything lesson 7 section 4 described happens again: the title, the seams and your yes, red then green, a commit, two sub-agents under `## Standards` and `## Spec`, a fix, a push, a pull request URL. Same 20 to 40 minutes. Stay with it, and when it prints the URL, don't open the PR yet.

### Watch the review arrive

```bash
gh pr checks --watch                                 # two workflows now: CI and AI review
gh run list --workflow ai-review.yml --limit 2       # the newest run says: pull_request
```

Nobody ran `gh workflow run`. The push that opened the pull request fired the `pull_request` event, the job checked out the merge of your branch into `main`, found `reviewer.json` and the skill in that checkout, and ran the command from section 5 with the PR number from the event. **[Fill from a real run]** how long the review took next to CI. Two things to read off the output. The `review` job turns green whether or not the review found anything, because `continue-on-error` means the only thing the check reports is that the job ran; the review's opinion is in the comment, never in the check. And a review that was still running when CI finished is normal: a model at `high` effort on a full ticket takes longer than lint and tests.

Now open the PR. The review from `github-actions` is there, same template as the two on the lesson 7 PR, and its footer names the commit, which is the one the agent pushed. This PR has now been read by three reviewers that never saw it being written: the two sub-agents from the `code-review` step in the implement run, and this one. Put the review next to the `## Standards` and `## Spec` reports still in your Kiro window. The sub-agents had fresh windows but the author's brief, and they reviewed before the pull request body existed. The cold reviewer had the ticket and the PR body and nothing from the author. The rows it marks **not found**, and the Evidence section findings, are things the sub-agents couldn't have seen. That difference is lesson 6's point, measured on your own diff, and it is what the lesson 7 "Optional" section asked you to try. You just did it without trying.

### Your turn, then the push that reviews again

Do lesson 7 section 5 on this PR: the `Demo:` line, the diff against the criteria, the boxes on the ticket, CI. Use the review as the script, the way section 7 did on your colleague's. If CI is red, paste the failing step into the same Kiro session and let the agent fix and push, as lesson 7 said. Then watch the Actions tab: the push is a `synchronize` event, and a **second** review arrives, under the first, with a different commit in its footer. The first review is now stale and says so. Two pushes inside a minute start one review, not two, which is the `concurrency` block from section 6 doing its job. One line on cost: every push to an open pull request is one review at `high` effort on a 1.3x-credit model, so a branch pushed fifteen times gets fifteen reviews. That is what you asked for in section 6, and it is the reason to let the agent finish a slice before it pushes.

Before you hand it over, one check that the review you are about to rely on is of the code that is there:

```bash
gh pr view --json headRefOid -q .headRefOid          # the commit the PR is at
```

The footer of the newest review names the same commit, or a run is still in progress. If there is no run, the push didn't fire the event; `gh run list --workflow ai-review.yml` and section 10's table are where to look.

If the review has findings, section 9 comes first: the author fixes what the reviewer found, and the reviewer runs again. Then swap with your colleague again and do section 7 on this PR: read the review first, run the demo on their machine, open every **not found** row, read the Merge danger paragraph, and merge by hand. The frontier moves again. From here on, every turn is this section: a ticket off the frontier, one `/implement-ticket`, a pull request, a review that arrived because the pull request did, a human with the review in one hand and the demo in the other, a merge. Nothing in the turn is started by hand except the ticket and the merge, and those are the two steps that are supposed to be yours.

---

## 9. When the review is right: fix the pull request from the findings

Section 7 said what the human reviewer does with a review. Nobody has said what the author does. A `Do not merge yet` is a reason not to merge, and lesson 7's rule puts the fix on the author: the same person, with the same agent, the way a red CI was fixed in lesson 7 section 5 by pasting the failing step into the same session. Except the review doesn't arrive in that session. It arrives minutes after the push, usually after `/clear`, and in lesson 9 there is no session at all. So the author's turn is a skill, the same move lesson 7 made with `implement-ticket`: once per pull request, one line to type, one file to change for everyone.

### The skill

`.agents/skills/address-review/SKILL.md`, symlinked from `.kiro/skills` and `.claude/skills` like its two siblings, invoked as `/address-review #<PR>` with the pull request number, in a fresh session, on the branch. Read it once; it is one page. In order:

1. **It reads before it writes.** `gh pr view` with the reviews, the ticket from the `Closes` line, and the newest review carrying the `<!-- ai-review -->` marker. It states four lines, the PR title, the branch, the ticket, the reviewed commit, and that is the moment to check the number was yours, as lesson 7's title line was.
2. **It stops if the review is stale.** The footer's `reviewed commit` must be the branch head. If a push happened since, a fresher review is on its way or failed, and fixing findings about code that may have changed is guessing. No review at all: it says so and sends you to `gh run list --workflow ai-review.yml`.
3. **It triages every finding** and every **not found** row into one of three places, and the skill says which is allowed for which level. Then three more rules, below the table.

| Outcome              | Means                                                                 | Allowed for                                      | Who acts next                                                          |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| **Fixed**            | Code or the PR body changed so the finding no longer holds            | Any finding                                      | The reviewer, on the push                                              |
| **Left**             | The agent disagrees, with a file and line and one sentence            | Should fix; a `not found` row whose test exists  | You. A comment on the PR, by hand, as you, if you agree with the agent |
| **Needs the ticket** | The finding turns on a decision the ticket should have made. No guess | Any finding; the only way a Blocker is not fixed | You, on the ticket, lesson 7 section 7. Then run the skill again       |

A **not found** row is the common Blocker and has three causes, so the skill decides by looking rather than by the review's word: a test at the seam the ticket names that asserts the criterion means the reviewer missed it, **Left**; no such test means the agent writes one, test-first, at that seam, **Fixed**; no seam on the ticket for that criterion, or a criterion that reads two ways, **Needs the ticket**. An Evidence finding is about the PR body, which the author's agent wrote, so the agent rewrites the Evidence section with `gh pr edit --body-file` and never the `Closes` line. A finding that cites a rule `AGENTS.md` doesn't contain is **Left**; section 10 says the fix for that is in `review-pr/SKILL.md`, and it is yours.

**It changes nothing the findings don't name.** No refactor, no style pass, and no second `code-review`: the cold reviewer in Actions is the review of the fix, and paying twice for one commit buys nothing.

**One commit, one push.** `pnpm check` and `pnpm format`, then a commit with `#<ticket>` and one line per finding fixed, so the next review's "what changed since" sentence has something to read, then one push. Section 8 priced a push at one review on a 1.3x model; the skill pushes once.

**It reports in the terminal and nowhere else.** Three lists, Fixed, Left, Needs the ticket, and the pushed commit. It never comments, approves, merges or closes, never touches the ticket. The guard would stop the verdicts; the skill doesn't try.

### Run it

On your own PR from section 8, as soon as its review is there and before you swap:

```bash
git switch ticket/17-<slug>                          # your lesson 8 ticket's branch
kiro-cli chat
```

```
/clear
/address-review #<PR>
```

The four lines, then `gh issue view` on the ticket, then the findings one at a time: a test file opened, a failing test, a green one, or a sentence saying why a finding is left. Then `pnpm check`, the commit, the push, and the report. Five to fifteen minutes, mostly `pnpm check`. **[Fill from a real run]** the verdict and findings the review had, the report the skill printed, and the time.

If your review has no findings, `Looks mergeable after the demo`, there is nothing to fix, and that is the review working. Do this section when you swap, on your colleague's PR, sitting next to them while they run it on theirs.

### The review again

The push is a `synchronize` event, and the reviewer from section 6 runs on the fixed commit, under the first review. Wait for it. Section 8's check tells you when it has arrived:

```bash
gh pr view --json headRefOid -q .headRefOid          # the commit the skill pushed
```

The footer of the newest review names that commit, and the verdict has moved, or hasn't, and either is information. **[Fill from a real run]** the verdict before and after, and the minutes between the push and the second review. In our run the first review said `Do not merge yet` and the second **[Fill]**.

Three things to do with the report, none of them in the code:

- **Left.** Read each line against the file it names. If you agree with the agent, that is your comment on the PR, by hand, as you, one sentence, under the review. If you agree with the reviewer, run the skill's step yourself in the same session: "fix the Should fix on `<file>:<line>`", and let it commit and push once more.
- **Needs the ticket.** Lesson 7 section 7: the fix is on the ticket, on GitHub, before anything else. Then `/address-review #<PR>` again. The skill re-reads the ticket, the row that had no seam now has one, and the test gets written.
- **Nothing left.** Hand the PR to your colleague. Section 7, with the newest review as the script, and the rule in words: the merge waits for a review of the commit that is there, after the demo, never against a stale one.

The skill is the author's half of lesson 7's rule, and it has the same shape as the reviewer's: a model does the reading and the typing, the verdicts stay with people. The reviewer never approves; the author's agent never argues in the thread. What they exchange is commits and reviews, and what the humans exchange is the comment and the merge.

---

## 10. When the review is wrong

The reviewer is an agent in a fresh window with a two-page skill. It will be wrong sometimes, and the fix is almost never in the code it reviewed. Each symptom in the table below traces back to one of five places, and the picture sorts them by which one.

![When the review is wrong, the fix is rarely in the code it reviewed: five rows, ticket or PR body, the skill, the agent file, the secret, the workflow, each with the symptom you see and what to do, and a strip saying to check the row yourself and rerun once before editing anything](images/review-is-wrong.svg)

Before any edit, check the row yourself and rerun once with `gh workflow run ai-review.yml -f pr=<n>`. A single odd run is the model; the same odd run twice is the file. The table is the same five rows in detail:

| What you see                                                    | What it is                                                                                                            | What to do                                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `file:line` that doesn't say what the review claims           | The agent summarised from the diff and guessed the line                                                               | Check the row yourself; comment on the PR. If it keeps happening, add "quote the line" to the skill's Criteria check                                                               |
| **not found** on a criterion that is plainly covered            | The test is at a seam the reviewer didn't look at, or the criterion is worded loosely                                 | The ticket's `Seams:` line should have led it there. If the wording is the problem, fix the ticket, as lesson 7 section 7 says                                                     |
| A finding that cites a rule `AGENTS.md` doesn't contain         | The skill drifted into general opinion                                                                                | Edit `review-pr/SKILL.md`. The Standards check names the rules on purpose; keep it that way                                                                                        |
| "No `Closes` reference found" as the first finding              | The PR body lacks `Closes #T`, so there is no ticket to review against                                                | Edit the PR body. Lesson 7's invocation asked for the line; the `pr` skill doesn't add it on its own                                                                               |
| A refused command in the review text                            | The allow list is missing something the skill needs                                                                   | Add one narrow glob to `reviewer.json`. Never `--trust-all-tools`                                                                                                                  |
| A comment saying the run produced no review                     | The agent exited without writing `.ai-review/review.md`                                                               | Open the linked run log. Usually a refused command it kept retrying, or a write to the wrong path. Fix the brief or the allow list, then `gh workflow run ai-review.yml -f pr=<n>` |
| The step logs "KIRO_API_KEY is not set" and exits 0             | The PR came from another fork, or the secret was never set                                                            | `gh secret list`. For a colleague's PR into your fork, run the review locally with section 5 instead                                                                               |
| A comment saying the review had a Blocker but the wrong verdict | The model graded a finding and then judged the verdict by impression                                                  | Nothing in the code. `gh workflow run ai-review.yml -f pr=<n>` once; if it repeats, the Severity table in the skill is ambiguous for that kind of finding. Tighten the table       |
| Two runs on the same commit give different verdicts             | A finding sits on the line between Blocker and Should fix and was graded differently each time                        | Add the case to the Severity table, on whichever side you want it. The verdict rule is only as stable as the table                                                                 |
| The review approved or requested changes                        | The agent can't post, so the posting line in `ai-review.yml` changed, or a person posted the file with the wrong flag | Stop. `git log -p .github/workflows/ai-review.yml` finds the change. Put `--comment` back before another run                                                                       |

The last row hasn't happened in our runs. It is in the table because the day it does, the fix is in the workflow file and the permission rules, and nothing else is worth doing first.

---

## 11. Check that it worked

- `kiro-cli agent list` shows `reviewer` as a workspace agent in `(v3 format)`, next to `erp`, and `kiro-cli chat --list-models` lists the model `reviewer.json` pins.
- `ls -la .kiro/skills/review-pr` and `ls -la .claude/skills/review-pr` are symlinks into `.agents/skills/review-pr`.
- `gh secret list` on your fork shows `KIRO_API_KEY`, and `git grep KIRO_API_KEY` finds it only in the workflow file as `${{ secrets.KIRO_API_KEY }}`.
- `git status --short` is clean after the section 5 run: `.ai-review/` is in `.gitignore`.
- The lesson 7 PR has two `<!-- ai-review -->` reviews, one from you (section 5) and one from `github-actions` (section 6), both in comment state, neither approved. Every finding in both carries **Blocker** or **Should fix**, and only the second ends with the model, effort, commit and run footer.
- `gh workflow list` shows `CI` and `AI review`. `gh run list --workflow ai-review.yml` shows one successful run.
- `git branch --contains upstream/main` prints `main`, and the lesson 7 ticket branch is unchanged.
- After section 7, on your colleague's fork: the PR is merged by a human, the ticket is closed, and the frontier query prints the tickets it unblocked.
- After section 8, on your fork: `gh pr list` shows the `ticket/17-...` PR, `gh pr checks` lists `check` from `CI` and `review` from `AI review`, and `gh run list --workflow ai-review.yml` shows runs whose event is `pull_request`, none of which you started.
- The new PR has at least one `<!-- ai-review -->` review from `github-actions`, in comment state, and the footer of the newest one names the commit `gh pr view --json headRefOid` prints. If the agent pushed twice, there are two reviews with two commits.
- After section 9: `ls -la .kiro/skills/address-review` and `ls -la .claude/skills/address-review` are symlinks into `.agents/skills/address-review`. The PR has one more commit, mentioning `#17` and the findings it fixed, and one more review from `github-actions` whose footer names that commit. Every **Left** line in the skill's report is either a comment on the PR from you or a fix in a later commit, and every **Needs the ticket** line is an edit on the ticket. Nothing on the PR was posted by an agent: `gh pr view --json comments,reviews` shows only `github-actions` and people.
- `/context show` in a fresh `erp` session lists `review-pr` next to `implement-ticket`, and the implement run never invoked it.

---

## Summary

- **A cold reviewer finds different things.** It reads the ticket, the diff, the PR body and CI, with no memory of writing the code and no brief from the author. It can't run the demo, so its last line is advice for the person who will.
- **Read-only is three things.** Permission rules in the agent file (`fs_write` allowed only under `.ai-review/`, shell allow-listed, `ask` means deny in headless), the posting step in the workflow, which only the job runs, and the brief. The brief is the weakest of the three.
- **Never approve, never merge.** The agent writes a file and can't post. The one line that posts it, in the workflow, says `--comment`. Approve, request changes and merge are a human's verdict, and lesson 7's rule stands: a human who isn't the author.
- **Quality is a skill, consistency is the job.** The six checks, the severities and the template are in `review-pr`, one file for all three tools. The job checks the file has that shape and that the verdict matches the worst finding before it posts, then appends the model, the effort and the commit. What is asked of the model is in the skill; what is enforced is in the workflow.
- **Advisory, in its own workflow.** It never fails the PR, runs on every push and on demand, and skips cleanly when the key isn't there.
- **The second turn starts nothing by hand.** A ticket off the frontier, `/implement-ticket`, and the review arrives because the pull request opened. The job is green when it ran, not when it liked the code; the opinion is in the comment, and the footer's commit says whether it is still current.
- **The author's turn is a skill too.** `address-review` reads the newest review, fixes what it is right about test-first at the line it names, leaves what it is wrong about with a reason, stops on what only the ticket can answer, and pushes once so the reviewer runs again. It never posts. The comment and the merge are the humans' exchange.
- **The skill is yours.** When the review is wrong, edit `review-pr/SKILL.md` or fix the ticket. Don't argue with the review in the PR thread and don't widen the permissions to make it go away.

---

## Optional: try it later

Four extensions, none part of the session.

**Inline comments.** `gh pr review --comment --body-file` posts one body. The reviews API accepts a `comments` array with a path and line per entry, which is how hosted reviewers put findings next to the code. Have the skill write a second file, `.ai-review/comments.json`, and add a `gh api repos/{owner}/{repo}/pulls/$PR_NUMBER/reviews --input` line to the posting step. Keep `gh api` out of the agent's allow list: it can do anything the token can, and the agent still never posts.

**Run the demo in the job.** The one thing the reviewer can't do is the `Demo:` line, because there is no app. `ci.yml` could start Postgres as a service, run the migrations and seed, start the API, and the skill could then be allowed `curl http://localhost:3000/api/*`. Lesson 7 section 7's table has a row about exactly this. It roughly doubles the job and the lesson, which is why it is here and not above.

**Read the human's comments too.** `address-review` reads only reviews carrying the `<!-- ai-review -->` marker, because this lesson is about the AI review and a colleague's comment is a conversation between people. Drop the marker filter in its first step and it reads your colleague's section 7 comments as findings, with no severity, so every one of them is a Should fix. Decide first whether you want an agent answering a person.

**See the rules do their work.** Run section 5's command once with `--trust-all-tools` added, in a scratch clone, with a PR you don't care about, and watch what the agent now runs that it couldn't before. Then take the flag away again. Nothing explains "`ask` becomes `allow`" better than watching it.

---

## Appendix A: the same reviewer in Claude Code and Codex

Both vendors ship an official GitHub Action, and both read the same `AGENTS.md` and the same `review-pr` skill through their own skills folder. The guard registration from lesson 5 Appendix A applies to each. Only the plumbing differs:

| Step                | Kiro CLI                                                             | Claude Code                                                                                              | Codex                                                               |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Action              | Hand-rolled: install `kiro-cli`, run headless                        | `anthropics/claude-code-action`                                                                          | `openai/codex-action`                                               |
| Secret              | `KIRO_API_KEY` (Pro and above)                                       | `ANTHROPIC_API_KEY`                                                                                      | `OPENAI_API_KEY`                                                    |
| The review          | `review-pr`, loaded by the `reviewer` agent, one-paragraph brief     | `/review-pr #N` from the action's `prompt` input, or a `.claude/agents` subagent that calls it           | `/review-pr #N` from the action's `prompt` input                    |
| Model and effort    | `model` in `reviewer.json`, `--effort` on the command                | The action's model input; see its README                                                                 | The action's model input; see its README                            |
| Read-only           | `permissions.rules` in the agent file                                | `--allowedTools` and `--disallowedTools` in the action's arguments, plus the hook                        | The action's sandbox and approval settings, plus the hook           |
| Headless `ask`      | Treated as deny                                                      | Denied unless the tool is allow-listed                                                                   | Depends on the configured approval policy                           |
| Posting the review  | The job posts `.ai-review/review.md` with `gh pr review --comment`   | The action can comment on the PR itself; keep it to comment state, or keep the file and the posting step | The same posting step; the agent only writes the file               |
| Fix from the review | `/address-review #<PR>` in a fresh interactive session on the branch | `/address-review #<PR>`, same skill through `.claude/skills`                                             | `$address-review #<PR>`, or "use the address-review skill on #<PR>" |

Read each action's README before copying the table; both move quickly. The decisions don't: one skill in the repo, a pinned model, read-only tools, a job that checks the shape and posts in comment state only, a human merges.

---

## Further reading

- Kiro, [Headless mode](https://kiro.dev/docs/cli/headless/): `KIRO_API_KEY`, the flags, and the GitHub Actions example this lesson's workflow is built from.
- Kiro, [Permissions](https://kiro.dev/docs/permissions/) and [Custom agent configuration reference](https://kiro.dev/docs/custom-agents/configuration-reference/): capability rules, `deny` over `allow`, `ask` as deny in headless, and the `prompt`, `resources` and `permissions` fields.
- Kiro, [Models](https://kiro.dev/docs/models/) and [Effort](https://kiro.dev/docs/models/effort/): the IDs behind `kiro-cli chat --list-models`, the credit multipliers, and what `--effort` means per model.
- Kiro, [Authentication](https://kiro.dev/docs/getting-started/authentication/): API keys, which tiers have them, and the precedence between a login session and `KIRO_API_KEY`.
- Kiro, [Kiro Agent for GitHub](https://kiro.dev/docs/autonomous-agent/github/): the hosted agent this lesson mentions and doesn't use.
- GitHub, [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) and [`gh pr review`](https://cli.github.com/manual/gh_pr_review): `pull_request` versus `workflow_dispatch`, why forks don't get secrets, and the three review states.
- Claude Code, [GitHub Actions](https://code.claude.com/docs/en/github-actions); OpenAI, [codex-action](https://github.com/openai/codex-action): the official actions in Appendix A.
- Lesson 6, section 3, and lesson 7, section 5: the two reviewers this one is built to improve on, and the step it still can't do.
