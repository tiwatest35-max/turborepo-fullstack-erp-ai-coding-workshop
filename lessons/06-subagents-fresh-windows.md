# Lesson 6: Subagents: fresh windows that work for the main one

**Time:** about 10–15 minutes
**Goal:** understand what a subagent is, where the implement loop in lesson 7 already uses them, and what each tool can and can't do with them.

By the end of this lesson you should be able to answer three questions:

1. What is a subagent, and what does it share with the window that started it?
2. Where do subagents appear in the implement loop, and why are they there?
3. What differs between Kiro, Claude Code and Codex, and why does that matter for running tickets in parallel?

Lesson 2 treated the context window as a budget and listed "delegate exploration" as one of the levers. Lesson 5 put a guard between the agent and the shell. This lesson is a read, not a build: the skills you installed in lesson 4 already use subagents, and lesson 7 is easier to follow if you know what you are watching.

---

## 1. What a subagent is

![A main context window on the left holds the fixed cost, the conversation, and a three-sentence report. A sub-agent window on the right receives a short brief, reads twenty files and runs commands, and sends only the report back. A note says that everything the sub-agent read stays in its own window and is thrown away.](images/subagent-context.svg)

A **subagent** is a second agent session started by the first one. It gets its own context window, its own instructions, its own tool list, and sometimes its own model. The main agent writes it a brief and waits. The subagent reads files, runs commands and thinks, all inside its own window. When it is done, it returns a report. The report enters the main window. Nothing else does.

What the two windows share: the filesystem, the git checkout, the repository's instruction files and skills, and the permissions the harness gives them. What they don't share: the conversation. The subagent has not seen the main agent's chat, and the main agent does not see the subagent's steps. Think of handing a question to a colleague down the corridor rather than reading over their shoulder.

Three consequences follow, and all three show up in the next lesson:

- **The brief is everything.** The subagent knows nothing the main agent didn't write down. Matt Pocock's `implement-spec` skill puts it as "communicate primarily through context pointers": the ticket number, the spec, a commit, a file path. The same rule lesson 4 applied to tickets applies to briefs, for the same reason.
- **The report is all that comes back.** If the subagent learned something and didn't write it in the report, it is gone when its window closes. A good subagent brief says what the report must contain and how long it may be.
- **The main window stays small.** A subagent can read twenty files and return three sentences, and only the three sentences count against the main agent's budget. This is the lever lesson 2 named.

One main agent can start more than one subagent, and often does: it writes several briefs, sends them out together, and collects each report as it arrives. The subagents don't see each other any more than they see the main chat. Section 3 shows the case you will meet first, and the diagram there draws it.

Subagents are not free. Each one pays the fixed cost from lesson 2 again, and each one starts cold. They pay off when the work produces a lot of tokens the main agent doesn't need to keep, or when two pieces of work would contaminate each other if done in one window.

---

## 2. Where you have already met them

You have been using subagents since lesson 4 without being told.

- **The grilling skill** in this repository, `.agents/skills/grilling/SKILL.md`, says: "When a frontier question needs a fact from the environment, dispatch a sub-agent to find it." The interview stays in the main window; the file reading happens elsewhere and comes back as a sentence.
- **Kiro CLI** has two internal subagents it uses on its own, with no configuration: one for gathering context and a general-purpose one for parallel work. When Kiro reads a lot of the codebase and your window barely grows, that is what happened.
- **Claude Code** does the same with a built-in explorer, and the harness you are reading this in has a tool for launching them.

---

## 3. In the implementation phase: the two reviewers inside `code-review`

Lesson 7 step 4 ends with "two sub-agents report under `## Standards` and `## Spec`". That is the `code-review` skill, which `implement` calls after the commit. Its own description says why it is built this way: both reviews "run as parallel sub-agents so they don't pollute each other's context".

The main agent, the one that wrote the code, does the preparation. It resolves the fixed point (`main`), confirms the diff is non-empty, finds the spec issue, and lists every file that documents how code should be written in this repository. Then it spawns two subagents at once:

| Subagent      | Gets in its brief                                                                        | Is asked for                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Standards** | The diff, the list of standards files, and a baseline list of code smells pasted in full | Every place the diff breaks a documented standard, citing the rule, plus any smell, quoting the hunk. Under 400 words.                                 |
| **Spec**      | The diff and the spec, as a path or its contents                                         | Requirements that are missing or partial, behaviour nobody asked for, and requirements that look done but wrong. Quote the spec line. Under 400 words. |

![A main context window on the left sends three briefs at the same time to three subagent windows on the right: a Standards reviewer, a Spec reviewer, and a third subagent standing for any other job. Each subagent works in its own window and sends back one short report. The main window ends up with the three reports and nothing else. A note says the subagents never see each other and that each one pays the fixed cost again.](images/subagent-fan-out.svg)

The main agent prints the two reports side by side and does not merge them. The skill's note on "why two axes" is the point: code can follow every standard and implement the wrong thing, or do exactly what the issue asked and break every convention. One reviewer asked both questions at once tends to answer the easier one.

Notice what the subagents do and don't have. They have fresh windows, so neither remembers writing the code, and neither has the other's findings. They don't have the main agent's reasons for its choices, which is the point. But they were **briefed by the author**: the main agent chose which files count as standards and where the spec is, and it reads the ticket the same way it did while building. And they never ran the app. That is why lesson 7's section 5 is still yours: the demo line, the diff against the criteria, the boxes. A fresh window is a better reviewer than the author re-reading its own diff. It is not a human who wasn't in the room.

Budget is the other reason this design works. A ticket run costs well over 100k tokens by the time the commit lands. Two reviews that read the whole diff would push the main window further into the dumb zone just when it has to fix what they found. Done in subagents, they cost the main window under 800 words.

---

## 4. Subagents as implementers: the loop without a human

The skills collection also has a mode where subagents don't review the work but **do** it. Lesson 7 says "read, don't run yet" about it. Here is what it is.

**`implement-spec`** is one orchestrating session that treats the tickets from lesson 4 as a task graph. It reads the spec, optionally sends an exploration subagent to take notes in a folder outside the repository where later subagents can read them, creates an integration branch, and then hands every frontier ticket to an **implementer subagent**, each in its own git worktree on its own branch, in the background. When one finishes, a **merger subagent** merges it onto the integration branch. If that unblocks tickets, more implementers start. When everything is merged, `code-review` runs once over the whole branch, one implementer fixes what it found, and the worktrees are cleaned up. You review one integration branch at the end instead of one ticket at a time.

![Three lanes. Top: one orchestrator window reads the spec, sends an explorer subagent to leave notes outside the repo, creates an integration branch, dispatches the frontier tickets, and at the end runs code-review once, fixes, and cleans up. Middle: implementer subagents, one per frontier ticket, each in its own git worktree and branch, running in the background; a third one is blocked until ticket 16 is merged. Bottom: a merger subagent lands each finished ticket on the integration branch, main to integration to merge 16, merge 17, merge 18, review and fix, and then you review that one branch. Notes say this needs background subagents with a worktree each, which today means Claude Code, and that nobody does the demo-diff-boxes step, so seams must be in the tickets.](images/subagent-implementers.svg)

It needs a harness that runs subagents in the background with worktree isolation, which today means Claude Code. Kiro's subagents run in parallel but share the one checkout, so two implementers editing the same files overwrite each other. Codex runs subagents in parallel and waits for all of them, and its documentation doesn't mention worktrees. The skill's own page warns about the rest: tickets that touch the same shared files collide at merge time, the final review-and-fix pass on a five-ticket run took hours, and nobody agrees the seams interactively, so they have to be in the tickets.

**A shell loop** is the simpler version: call the agent non-interactively once per frontier ticket, `claude -p "/implement-ticket #16"` in Claude Code, `codex exec` in Codex, `kiro-cli chat --no-interactive --trust-all-tools "..."` in Kiro, with the seams pre-agreed in the prompt because nobody is there to answer. Matt Pocock's page notes that for truly unattended work a deterministic script or CI job is faster and cheaper than an orchestrating agent. Kiro's documentation doesn't confirm that a skill slash command expands in headless mode, so on Kiro the prompt would carry the skill's text.

Both remove the human from the demo-diff-boxes step. The guard from lesson 5 still runs in every subagent and still blocks the same commands, but a hook can stop a command, not judge a diff. Know they exist, and leave them until you have run the loop by hand enough times to know what a bad ticket looks like. Lesson 9 builds the shell loop, on Kiro, with a human still proving every ticket; `implement-spec` is its Appendix A.

---

## 5. Three tools, three answers

Skills are an open format: the same `SKILL.md` folder works in every tool. Subagents are not. Each tool defines them in its own file, in its own format, with its own rules about who starts them.

| Question                       | Kiro CLI                                                                                         | Claude Code                                                        | Codex                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Where a subagent is defined    | `.kiro/agents/<name>.json`. The custom-agent format from lesson 3 doubles as the subagent format | `.claude/agents/<name>.md`, YAML front matter plus instructions    | `.codex/agents/<name>.toml`                                               |
| Built in, no definition needed | Two internal subagents: context gathering and general purpose                                    | An explorer and a general-purpose agent, among others              | Not documented                                                            |
| Who decides to delegate        | The main agent, from each agent's `description`, or you by name                                  | The main agent, from each agent's `description`, or you by name    | Only on a direct request, or an instruction in `AGENTS.md` or a skill     |
| Parallel and background        | Parallel, yes. Background only with workflows switched on; otherwise the main agent waits        | Parallel and background, up to 20 at once by default               | Parallel; the main agent waits for all of them                            |
| Own checkout                   | No, shares the working tree                                                                      | Yes, `isolation: worktree` gives the subagent its own git worktree | Not documented                                                            |
| Own tools and model            | Own tool list and permissions, from the agent file                                               | Own tool list and model, from the front matter                     | Own model and reasoning settings; tools can be narrowed, not fully chosen |
| Switch them off                | Exclude the `subagent` tool from the agent, or list `availableAgents`                            | Deny the agent-launching tool in permissions                       | `agents.enabled = false`                                                  |

Two details matter for this course. In Kiro, the general-purpose subagent runs "using the default agent configuration", and lesson 3's workspace settings make `erp` the default, so a subagent gets the same built-in tools and the same guard hook as the main session. We confirmed this: asked to "use a subagent to run `pnpm db:reset`", Kiro spawned a subagent, and the guard from lesson 5 blocked the reset inside it exactly as it does in the main window. And the `code-review` skill's two reviewers work in all three tools, because they run in the foreground and only need a fresh window. It is only `implement-spec`'s implementers, which need background runs and separate checkouts, that today work as designed in one tool.

---

## Summary

- A **subagent** is a second session with its own window, started by the first. They share the files and the repository's rules; they don't share the conversation. The brief goes in, the report comes out, everything in between is thrown away.
- Subagents pay the fixed cost again and start cold. They win when the work produces tokens the main window shouldn't keep, or when two questions would contaminate each other.
- **In the implementation phase** you meet them inside `code-review`: a Standards reviewer and a Spec reviewer, each in a fresh window, each briefed by the author, each under 400 words back. Better than the author re-reading its own diff. Not a substitute for your demo.
- **`implement-spec`** turns subagents into implementers, one per frontier ticket, in worktrees, in the background. It needs Claude Code today, removes the human from the loop, and stays "read, don't run" in this course.
- Skills are portable, **subagents are not**: a file per tool, in a format per tool, with different rules about who delegates and whether the subagent gets its own checkout.

---

## Optional: try it later

This isn't part of the session. In Claude Code, in the repo root, run `/context` and note the total. Then:

```
Use a subagent to explain how login works end to end in this repo, from the form in apps/web to the users table in packages/database. Report back in under ten sentences, with file paths.
```

Run `/context` again. The main window grew by roughly the ten sentences, not by the files the subagent read. Now ask the same question without the word "subagent" and compare.

In Kiro CLI, Kiro decides when to use its context-gathering subagent and you don't invoke it by name, so the comparison is less clean. Ask the same question, then `/context show`, and see whether the files it read ended up in your window or not. In our run on `kiro-cli 2.34.0`, Kiro answered this question in the main window: it ran its own grep and file reads rather than delegating, so the files it read did count against the main window. Kiro delegates when it judges a task worth a fresh window, not on every exploration; when you ask it explicitly to "use a subagent", it does spawn one.

---

## Further reading

- Kiro, [Subagents](https://kiro.dev/docs/custom-agents/subagents/) and [Custom agents](https://kiro.dev/docs/custom-agents/): the two internal subagents, delegation by description, and the shared checkout.
- Claude Code, [Subagents](https://code.claude.com/docs/en/sub-agents): the front-matter format, background runs, and worktree isolation.
- Codex, [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents): when Codex delegates and what a subagent can override.
- Matt Pocock, [code-review](https://github.com/mattpocock/skills/tree/main/skills/engineering/code-review) and [implement-spec](https://www.aihero.dev/skills-implement-spec): the two uses of subagents this lesson describes, in the skill authors' own words.
- Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (June 2025): why briefs matter more than anything else when one agent hands work to another.
