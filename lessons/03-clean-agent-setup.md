# Lesson 3: Start clean: reset your agent, lock the project settings, switch off memory

**Time:** about 15–20 minutes
**Goal:** make sure everyone in the room runs the same agent on the same repository, with nothing loaded that you can't see in git.

By the end of this lesson you should be able to answer three questions:

1. Where does an agent's configuration come from, and why does your personal setup change how it behaves in this repo?
2. How do you reset an agent to a fresh install without losing anything and without signing out?
3. Why do we switch off automatic memory, and what replaces it?

Lesson 2 treated the context window as a budget and showed how this repository keeps its share of it small. This lesson is about the parts of that budget that **don't come from the repository at all**.

---

## 1. Same repository, different agents

When you open this repo in Claude Code, Codex or Kiro, the agent loads configuration from three places:

- **Your global config**, in your home directory: your settings, a personal instructions file, your own skills, MCP servers, plugins, hooks and output styles. It loads in every project you open.
- **The project config**, in the repository: `AGENTS.md`, the skills in `.agents/skills/`, and project settings. It is committed, so it's the same for everyone.
- **Memory**: notes the agent wrote for itself in earlier sessions and loads again in later ones.

![Three layers, before and after this lesson. Global config: personal MCP servers, plugins, hooks, skills and instructions that differ on every laptop, reset to fresh-install defaults in step 1. Project config: AGENTS.md and skills, plus a settings file that switches off what the repository does not need, in step 2. Memory: notes loaded silently from earlier sessions, switched off in step 3 and replaced by a handoff file.](images/agent-config-layers.svg)

Only the middle layer is the same on every laptop. The other two are invisible to everyone except their owner, and they can change the outcome a lot:

- One person has a GitHub MCP server with forty tools. Lesson 2 showed that every tool definition is a fixed cost paid at the start of every session.
- Another has a personal `~/.claude/CLAUDE.md` that says "always use npm". This repository uses pnpm.
- A third has memory notes from a different project with a similar layout, and the agent "remembers" a folder that doesn't exist here.

All three type the same prompt and get different results, and nobody can tell why. In a team this becomes "it works with my agent". In a workshop it makes it impossible to compare results.

The rest of this lesson deals with each layer in turn: **reset** the global layer, **lock** the project layer, and **switch off** memory.

---

## 2. Step 1: reset your global config

You don't want to lose your setup. You want it out of the way for the workshop and back afterwards. Nobody remembers where all of it lives, and the locations change with every release, so this is a job for the agent itself.

Run this prompt **once in each tool you use**, from the repository root. Each tool resets its own configuration.

```markdown
You are the expert on your own configuration. Reset me to a clean slate (the config a fresh install would have) with everything I have now preserved so you can restore it on request later.

**1. Inventory.** Consult your own documentation for where your configuration lives, then find every piece of it that applies to me, both global (user-level) and local (this project). Cover settings files, instruction/memory files, MCP servers, skills, plugins/extensions, subagents, custom commands, hooks, and output styles. Report every path you find with a one-line description of what it does. Done when every location named in your docs has been checked and reported, including the ones that turned out to be empty.

**2. Back it up.** Create `~/agent-config-backup-<today's date>/` and MOVE each item there, mirroring its original path inside the backup so the layout is self-describing. The backup is the only surviving copy, so verify each move landed before continuing.

**3. Write the restore instructions.** Add `RESTORE.md` at the root of the backup listing every backed-up item, its original absolute path, and the exact commands to put it all back. Written well enough that a future agent with no memory of this conversation can restore everything from that file alone.

**4. Verify.** Re-run the inventory from step 1. Report what remains and confirm each remaining item is a genuine default rather than something I configured.

Keep me signed in - leave auth, credential, and session files exactly where they are. Keep this project's source code untouched; only configuration moves. Files tracked by git in this repository are the team's shared configuration: report them, but leave them in place. Only move untracked, per-user files.

Finish with a table of what was moved and the one-line command I can give you later to restore it.
```

When you want your setup back, start a session in any directory and say:

```
Restore my agent configuration from ~/agent-config-backup-<date>/RESTORE.md
```

### Why the prompt is written this way

- **"Consult your own documentation."** Configuration locations move between versions. In the last few months Codex moved its docs to a new site, and Kiro added a memory feature. An agent answering from its training data will miss whatever is new. Making "checked and found empty" part of the definition of done stops it from skipping locations it isn't sure about.
- **Move, don't delete, and mirror the paths.** The backup folder looks like your home directory, so each file's original location is obvious and restoring it is the same move in reverse.
- **Verify each move.** After a move, the backup is the only copy. A move that silently fails halfway through is the one way this prompt can lose data.
- **`RESTORE.md` for an agent with no memory.** After step 3 of this lesson, that's literally true: the agent that restores your config won't remember this conversation. The file has to stand alone.
- **The last line about git-tracked files.** This is the only line we added to the original prompt. Without it, a thorough agent finds `AGENTS.md`, `.claude/skills/` and `.kiro/steering/` in this repo, correctly recognises them as agent configuration, and moves them. That would break the workshop for you. Files tracked by git belong to the team. Untracked per-user files such as `.claude/settings.local.json` are yours, so they move.

### Staying signed in

"Leave auth files where they are" sounds simple. It isn't, because in all three tools the sign-in lives in the same folder as the configuration:

| Tool        | Leave in place                                                                                                                                                                 | Watch out for                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | The macOS Keychain entry, or `~/.claude/.credentials.json` on Linux. Session transcripts in `~/.claude/projects/` and `~/.claude/history.jsonl`.                               | `~/.claude.json` holds your account details and folder trust decisions next to your MCP servers. The agent should move the `mcpServers` entries out, not the file.           |
| Codex       | `~/.codex/auth.json`, or the OS keyring. `sessions/`, `history.jsonl` and the `*.sqlite` files in `~/.codex`.                                                                  | Your personal Codex skills live in `~/.agents/skills/`, outside `~/.codex`.                                                                                                  |
| Kiro        | Kiro doesn't document where it keeps sign-ins. Treat anything under `~/.kiro` that isn't listed on the right, plus `~/Library/Application Support/kiro-cli/`, as session data. | Configuration and sign-ins share `~/.kiro`. Move `steering/`, `skills/`, `agents/`, `hooks/`, `powers/`, `prompts/`, `settings/mcp.json` and `settings/cli.json` one by one. |

You don't need to tell the agent any of this. If the inventory in step 1 of the prompt is done properly, it finds these details in its own docs. The table is here so you can **check its work**.

### Before you approve the moves

- **Read the inventory.** It's the agent's plan. If something you care about is missing from the list, it won't be backed up.
- **Don't run this in an auto-approve mode.** You want to see every move. It's your home directory.
- **Open `RESTORE.md` afterwards.** If you can follow it, so can a future agent.

---

## 3. Step 2: let the project decide what the agent loads

After step 1 your laptop is clean, but that lasts only until you restore your setup or install something new. Step 2 makes the repository enforce it. We commit a project settings file that switches off everything this codebase doesn't need, so a personal setup stays out of this repo as far as each tool allows.

**What stays on:**

- the instruction files: `AGENTS.md`, and the `CLAUDE.md` files and Kiro steering files that point to it
- the skills in `.agents/skills/`
- the built-in tools for reading, editing and searching files, running commands, delegating to subagents, and searching the web for docs

**What goes off:** MCP servers, plugins, extensions and powers, hooks, apps and connectors, computer use, image generation, custom output styles, knowledge bases, and memory. None of these is needed to build a NestJS and React app, and each one adds tools or instructions from outside the repository. Off is not forever: lesson 5 switches one hook back on, chosen by the project and committed with it.

Each tool names its project file differently and has different switches. Rather than hand-write three files, we gave each tool the same prompt:

```markdown
You are the expert on your own configuration. Make this repository's project-level configuration contain only what we need to develop this application, so every developer who opens it gets the same agent whatever their personal setup.

**1. Find the project scope.** Consult your own documentation for the configuration files you read from inside a project, as opposed to my home directory. Report each path, whether it exists, and whether it is meant to be committed or is per-user.

**2. Decide what stays.** Keep only what serves this codebase: the instruction files already in the repo (AGENTS.md and the files that point to it), the skills in `.agents/skills/`, and your built-in tools for files, shell commands, subagents and web search. Everything else is out of scope: MCP servers, plugins/extensions, hooks, apps/connectors, computer use, image generation, custom output styles, knowledge bases, and anything else that adds instructions or tools from outside this repository.

**3. Write the project settings.** In your shared, committed project settings, set every documented switch that turns off an out-of-scope feature or stops user-level additions from leaking into this project. Only use keys your documentation names; never guess a key. If a settings file already exists, keep its keys and add yours. Don't change model, authentication, approval mode, telemetry or update settings: those are each developer's own choice. Only write your own tool's files, and don't edit anything in my home directory.

**4. Report.** Finish with a table: key, value, what it turns off, and the documentation page that names it. Then list everything you could not turn off from the project scope, with the exact user-level step a developer would need instead.
```

Three details carry most of the weight:

- **"Never guess a key."** Most tools ignore settings they don't recognise. An invented key fails silently and leaves you believing something is switched off when it isn't.
- **"Don't change model, authentication, approval mode, telemetry."** Those are personal choices, and a shared file that overrides them makes people stop trusting it.
- **"List everything you could not turn off."** No tool lets a project switch off everything. The gaps are as important as the settings, and section 3.2 lists them.

### 3.1 What it produced in this repository

#### Claude Code: `.claude/settings.json`

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "autoMemoryEnabled": false,
  "disableAllHooks": true,
  "enableAllProjectMcpServers": false,
  "outputStyle": "default",
  "spinnerTipsEnabled": false
}
```

| Key                          | What it does                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `autoMemoryEnabled`          | Switches off auto memory for this project. See step 3.                        |
| `disableAllHooks`            | Switches off every user and project hook, and the custom status line.         |
| `enableAllProjectMcpServers` | Never auto-approves MCP servers from a `.mcp.json` someone adds later.        |
| `outputStyle`                | Forces the built-in default style, whatever personal style you have selected. |
| `spinnerTipsEnabled`         | Hides feature tips while the agent works. It's noise in a workshop.           |

`.claude/settings.json` is committed and shared. Personal overrides go in `.claude/settings.local.json`, which Claude Code adds to your global git excludes. That file sits higher in the precedence order, so treat it with care.

#### Codex: `.codex/config.toml`

```toml
[features]
memories = false
apps = false
plugins = false
hooks = false
computer_use = false
image_generation = false

[memories]
generate_memories = false
use_memories = false
```

Codex loads a project's `.codex/` folder **only after you trust the project**. It asks the first time you open the repo. If you said no, nothing in this file applies. To check, run `codex features list` in the repo root. The six features above should show `false`.

#### Kiro: `.kiro/agents/erp.json` and `.kiro/settings/cli.json`

Kiro has no single project file of off-switches. Its lever is a **custom agent**, a JSON file that lists exactly which tools and resources the agent gets:

```json
{
  "name": "erp",
  "description": "Coding agent for this ERP repository: repo instructions and skills only, built-in tools only.",
  "tools": ["@builtin"],
  "excludedTools": ["knowledge"],
  "includeMcpJson": false,
  "includePowers": false,
  "resources": ["skill://.kiro/skills/*/SKILL.md"]
}
```

- `"tools": ["@builtin"]` gives the agent Kiro's built-in tools and no MCP tools.
- `includeMcpJson` and `includePowers` set to `false` keep your MCP servers and installed powers out.
- This lock is not forever. Lesson 11 opens exactly one server, for one new agent, with the tools listed by name, and leaves `erp` as it is here.
- `excludedTools` removes the knowledge-base tool, which stores content between sessions.
- The `skill://` line is needed because custom agents don't load skills unless you list them. The steering files and `AGENTS.md` still load as usual.

The workspace settings file makes `erp` the default agent for the CLI in this repo and switches off the knowledge base:

```json
{
  "chat.defaultAgent": "erp",
  "chat.enableKnowledge": false
}
```

It's the same file that `kiro-cli settings --workspace chat.defaultAgent erp` writes. Two caveats apply. Kiro loads workspace agents only after you trust the workspace. And the Kiro IDE has no default-agent setting, so in the IDE you pick `erp` from the agent picker when you start a session.

### 3.2 What a project file can't do

| Tool        | Can't be switched off from the project                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | Your user-scope MCP servers. There is no project key for them. Use `/mcp` to disable them per project, or remove them in step 1. |
| Claude Code | Personal plugins, skills and subagents, unless you name each one. A project file can't say "none of the user's".                 |
| Codex       | Anything at all, until you trust the project. User-level MCP servers and skills can only be disabled by name.                    |
| Kiro        | Powers, which only exist at user level. Kiro IDE's MCP and memory settings, which are user settings only.                        |

This is why step 1 exists. The project file narrows what loads. The reset makes sure there's nothing left to narrow.

---

## 4. Step 3: switch off automatic memory

All three tools can now take notes on their own and bring them back in later sessions:

| Tool        | Feature     | Default | Where the notes live                                                                              |
| ----------- | ----------- | ------- | ------------------------------------------------------------------------------------------------- |
| Claude Code | Auto memory | on      | `~/.claude/projects/<project>/memory/`. The first 200 lines of `MEMORY.md` load in every session. |
| Codex       | Memories    | off     | `~/.codex/memories/`, written in the background after a session goes idle.                        |
| Kiro        | Memory      | off     | Stored per user account and shared by the IDE and CLI on one machine. Added in October 2026.      |

It's a useful feature for one person working alone. For this workshop we switch it off everywhere, for four reasons:

- **It's invisible context.** Memory loads at the start of a session, but it isn't in git, nobody reviews it, and it's different on every laptop. It's exactly the global layer that step 1 removed, growing back.
- **It goes stale.** "The tests need the database seeded first" was true last week. If the seed step has changed since, the note becomes one of the distractors from lesson 2, and the agent trusts it because it wrote it itself.
- **It can't be shared.** Your agent's memory doesn't help your teammate. A file in the repository does.
- **It hides cause and effect.** In a workshop we want to see which instruction changed the agent's behaviour. A hidden note makes that impossible to tell.

### What replaces it: a handoff file

Context still needs to survive between sessions. We just carry it on purpose. At the end of a session, ask the agent to write what it did, what's left, and the decisions made into a short markdown file in the repository. At the start of the next session, point the agent at that file.

![Auto memory compared with a handoff file. Auto memory: the agent decides what to keep, stored on one machine outside git, nobody reviews it, loads in every later session even when stale, your teammate never sees it. Handoff file: you ask for it when you stop, a markdown file in the repository, you read it and fix it, loads only when you point the next session at it, anyone can pick up the work.](images/memory-vs-handoff.svg)

This is the "intentional compaction" from lesson 2, section 6. A later lesson turns it into a `handoff` skill, so the format is the same every time.

### The prompt

```markdown
We don't use automatic memory in this project. Context passes between sessions only through files we write on purpose, so anything you remember on your own is hidden, unreviewed context.

**1. Find it.** Consult your own documentation for every feature that stores information from one session and brings it back in a later one without me asking: auto memory, memories, knowledge bases, learned preferences. Ignore plain conversation history and resume, which only load when I ask for them.

**2. Switch it off.** Turn each feature off for this project in your committed project settings. If your documentation says a switch only works at user level, tell me the exact setting and how to change it, and change it only after I confirm.

**3. Show what exists.** Tell me where any existing memories for this project are stored and how many there are. Don't delete them.

**4. Verify.** Give me the command that proves a new session starts with no memory loaded.

Finish with a table: feature, where it's switched off, key and value, and the documentation page.
```

### What it produced

| Tool                    | Switch                                                                                | Scope               | Where                                                 |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------- |
| Claude Code             | `"autoMemoryEnabled": false`                                                          | project             | `.claude/settings.json`                               |
| Codex                   | `features.memories = false`, plus `generate_memories` and `use_memories` set to false | project, if trusted | `.codex/config.toml`                                  |
| Kiro IDE                | **Kiro Agent: Memory** set to **Off**                                                 | user only           | Each person, once. It's the default since IDE 1.4.10. |
| Kiro CLI                | `/memories`, then `config`, then `off`                                                | user only           | Each person, once.                                    |
| Kiro CLI knowledge base | `chat.enableKnowledge: false`, and the `knowledge` tool excluded                      | workspace           | `.kiro/settings/cli.json` and `.kiro/agents/erp.json` |

Kiro is the one tool where memory can't be switched off from the repository. Its docs say plainly that "a value in workspace settings has no effect", so every Kiro user does this step by hand.

Claude Code also reads an environment variable, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, which overrides the setting. If someone has it set to `0` in their shell, auto memory comes back on. `/memory` shows the real state.

---

## 5. Check that it worked

Open the repo in each tool, accept the trust prompt, and run:

```
# Claude Code
/status     # lists which settings files loaded: .claude/settings.json should be there
/memory     # auto memory: off
/context    # no MCP tools, no memory, only this repo's instruction files
/mcp        # no servers

# Codex (in the repo root, in a terminal)
codex features list    # memories, apps, plugins, hooks, computer_use, image_generation: false

# Kiro CLI
/context show    # only AGENTS.md, steering and the repo skills
/memories        # then config: off
```

Compare the `/context` numbers with what you saw in lesson 2. The fixed cost should now be the same on every laptop in the room.

---

## Summary

- An agent loads **three layers**: your global config, the project config, and memory. Only the project config is in git, so only it is the same for everyone.
- **Step 1, reset:** a prompt that has the agent inventory its own config from its own docs, move it to a dated backup, write a `RESTORE.md`, and leave sign-ins and the repository's tracked files alone.
- **Step 2, lock:** one generic prompt, run in each tool, produced `.claude/settings.json`, `.codex/config.toml` and a Kiro custom agent. Together they switch off MCP servers, plugins, hooks and the rest of what this codebase doesn't need. The project can't switch off everything, which is why step 1 comes first.
- **Step 3, no memory:** automatic memory is hidden, stale-prone, unshareable context. It's off in Claude Code and Codex from the repo, and off by hand in Kiro. A handoff file in the repository replaces it.

---

## Optional: try it later

This isn't part of the session. After the workshop, restore your setup and look at the difference:

```
Restore my agent configuration from ~/agent-config-backup-<date>/RESTORE.md
```

Then open this repo again and run `/context`. Your personal MCP servers and skills are back in every other project. In this one, the project settings still keep most of them out.

---

## Further reading

- Claude Code: [Settings](https://code.claude.com/docs/en/settings), [Memory](https://code.claude.com/docs/en/memory), and [The .claude directory](https://code.claude.com/docs/en/claude-directory) for the full file map.
- Codex: [Config basics](https://learn.chatgpt.com/docs/config-file/config-basic), [Config reference](https://learn.chatgpt.com/docs/config-file/config-reference), and [Memories](https://learn.chatgpt.com/docs/customization/memories).
- Kiro: [Configuration](https://kiro.dev/docs/configuration/), [Custom agents](https://kiro.dev/docs/custom-agents/), [CLI settings](https://kiro.dev/docs/reference/settings/), and [Memory](https://kiro.dev/docs/memory/).
- HumanLayer, [Advanced Context Engineering for Coding Agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents): intentional compaction, the idea behind the handoff file.
