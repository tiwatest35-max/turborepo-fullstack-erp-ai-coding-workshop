# Lesson 11: One server, on purpose: planning into Jira through MCP

**Time:** about 60–75 minutes
**Goal:** run lesson 4's three planning skills against Jira instead of GitHub, by giving one agent one MCP server and swapping one file, and measure what that server costs before and after you narrow it. The implement loop stays where it is.

By the end of this lesson you should be able to answer three questions:

1. What is an MCP server to an agent, why did lesson 3 switch them all off, and what does it take to switch exactly one back on without undoing lesson 3?
2. Why do `to-spec` and `to-tickets` publish to Jira after this lesson without a single edit to either skill?
3. What would have to change downstream, in lessons 7 and 9, for the implement loop to follow, and why does this lesson not do it?

Lesson 3 was a reset: every laptop in the room runs the same agent, built-in tools only, no MCP servers, no plugins, nothing from your home directory. Lesson 2 gave the reason in one line, "count your tools": every server loads all of its tool definitions at startup. Then lessons 4 to 10 built a whole loop without ever needing a server, because `gh` was already on the machine and the guard could read every command it ran. Most companies don't track work on GitHub. They track it on Jira, and there is no `jira` command on the laptop. So this lesson does the thing lesson 3 forbade, once, deliberately, in a way you can read in the diff: one agent gets one server, with a list of the tools it may see, and the three skills from lesson 4 publish an Epic and its Stories to a Jira project you made ten minutes earlier.

---

## 1. The tracker was a choice all along

![Four rows. First, two agents side by side. Left, slate: erp, implementer and reviewer from lessons 3, 8 and 9, built-in tools only, includeMcpJson false, no MCP servers, unchanged in this lesson. Right, amber: the planner agent, the same lock plus one MCP server, Atlassian, declared inline, with an allow-list of thirteen named tools out of the 258 the server offers; authorised once in the browser, no secret on disk; used for grill, spec and tickets, never to implement. Second row, one file: docs/agents/issue-tracker.md, the only switch. The skills never name GitHub; they read this file; swap it on a branch and they publish to Jira. Third row, the three steps from lesson 4, run by the planner: grill CR-01, reading TOR 10.3 and the GitHub spec, writing nothing; to-spec, publishing one Epic, ERP-1, labelled ready-for-agent; to-tickets, publishing Stories with the Epic as parent, Blocks links and the same label. Fourth row, greyed: the implement loop, CI, the review and Playwright stay on GitHub; section 11 lists what would change downstream.](images/one-server-on-purpose.svg)

Open `.kiro/skills/to-tickets/SKILL.md` and search it for `gh`. There is no match. Search `to-spec` and `implement`. No match either. The three skills say "publish to the issue tracker" and "fetch the relevant ticket", and one line near the top of each says the tracker configuration "should have been provided to you". It is provided by `docs/agents/issue-tracker.md`, the file `/setup-matt-pocock-skills` wrote in lesson 4 section 4 and the "Agent skills" block in `AGENTS.md` points at. That file is where "make it a sub-issue" became `gh issue create --parent` and "blocked by" became a native GitHub dependency. The skills never knew.

So switching trackers is not a skill change. It is a different `issue-tracker.md`, with the same section headings, whose entries name Jira operations instead of `gh` commands. The setup skill offers this route itself: pick "Other (Jira, Linear, etc.)" and it asks you to describe your workflow in a paragraph and writes the file from that. We don't use that route here, for lesson 3's reason: twenty students dictating twenty paragraphs produce twenty trackers. This lesson ships the file, you read it, and the only thing you dictate is the spec.

What is different is **how the agent reaches Jira**. GitHub had a CLI, so the agent ran shell commands, the guard read every one of them, and lesson 9's deny list could name `gh issue close *`. Jira has a REST API and, since 2025, an MCP server Atlassian runs. The agent will call that server's tools directly, and no shell is involved. That moves the control from the guard to the agent's tool list, which is the half of this lesson that is about MCP and not about Jira.

---

## 2. Before you start

**Your fork, on `main`, with lessons 4 to 10 done.** This lesson reads the spec issue lesson 4 published, so it needs your fork and your spec number:

```bash
git switch main && git pull
git status --short                                   # expect: nothing
gh repo set-default --view                           # expect: <you>/<repo>
gh issue list --label ready-for-agent --limit 1 --search "sort:created-asc"   # the spec; note its number
cat docs/agents/issue-tracker.md | head -3           # the GitHub tracker doc from lesson 4
kiro-cli --version                                   # 2.34.0 or later
```

**Pull this lesson's files from the workshop repository.** Same prompt as lesson 8 section 2, to the `erp` agent in a fresh session on `main`:

```
Bring my fork's main up to date with the workshop repository, the upstream remote. Fetch it and merge
upstream/main into main with a merge commit. Do not rebase and do not force-push. If the merge has
conflicts, stop and show me the files. When the merge is clean, push main to origin and show me
`git log --oneline -3` and `ls .kiro/agents docs/agents`.
```

Afterwards:

```bash
ls .kiro/agents/planner.json docs/agents/issue-tracker-jira.md lessons/11-*.md
```

**A Jira site of your own.** Jira Cloud has a free plan for up to ten users. Sign up at [atlassian.com/software/jira](https://www.atlassian.com/software/jira) with the e-mail address you will authorise with later. When it asks what to create, make a **Software** project, **team-managed**, from the **Kanban** template, named `Retail ERP` with the key **`ERP`**. Team-managed matters: it comes with Epic, Story and Task work item types and no admin screens, and the tracker doc assumes those types. Jira calls issues "work items" since 2025; the tools and the URLs still say `issue`.

Check it by opening `https://<your site>.atlassian.net/jira/software/projects/ERP/boards/1`, an empty board. Then open the project's settings and confirm **Epic** is in the list of work item types. **[Verify in a real run: whether the Atlassian MCP server works on a Free site. Atlassian's pages don't say. If it needs Standard, the room needs one trial site each, and this paragraph changes.]**

Nothing else. No Docker, no Postgres, no browser install. This lesson never runs the app.

---

## 3. What MCP is

Every tool the agents have had since lesson 3 was built in: read a file, edit it, run a shell command, start a subagent, search the web. The people who wrote the agent wrote those tools, which is why `"tools": ["@builtin"]` was a complete sentence. The **Model Context Protocol** is how a tool written by someone else gets onto the same list. Anthropic published it in November 2024 as an open standard. Kiro, Claude Code, Codex, Cursor and most other agents implement the client side; Atlassian, GitHub, the Playwright team and thousands of others publish servers. One protocol, so a server written once works in every agent, and an agent written once can use every server.

### Three parts

![Three parts left to right. The host, kiro-cli running the planner agent, contains the model with its context window and an MCP client, one per server. The server, mcp.atlassian.com, is remote over HTTP, offers 258 tools with tools equals all, and runs as the account you authorised; behind it sits your Jira site. Four numbered arrows between client and server. One, initialize, once per session, with OAuth in the browser the first time. Two, tools slash list, and back come 258 definitions, each a name, a description and an input schema, which the host writes into the context window before your first prompt. Three, tools slash call with a name and JSON arguments, sent only after the host checks its allow-list and you say yes. Four, the result, content plus an isError flag, goes into the context like shell output. A note says steps one and two are paid once per session whether or not a tool is ever called, and steps three and four repeat per call.](images/mcp-how-it-works.svg)

- **The host** is the program you type into: `kiro-cli`, `claude`, `codex`. It owns the model, the context window, the permission prompt and the agent file. Everything that decides what the model may do lives here.
- **The client** is a connection the host opens to one server. It speaks JSON-RPC to the server, over a pipe or over HTTP. It is the host's code: the server never runs anything inside your agent, it only answers requests.
- **The server** is a program that offers three kinds of thing. **Tools** are functions the model can call. **Resources** are data the host can read in, like a file or a record. **Prompts** are templates the host can offer you. This lesson uses tools and nothing else, and so does almost every server you will meet.

### What happens in a session

| Step          | Who                   | What crosses the wire                                                                                                                                                                                            | What you see                                                               |
| ------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **1 Connect** | client → server       | `initialize`: each side says which protocol version and features it supports. A remote server wants to know who you are first, so your browser opens on an OAuth consent page, once                              | `/mcp` shows the server connecting, then connected                         |
| **2 List**    | client → server       | `tools/list`. Back comes one entry per tool: a `name`, a `description` written for the model, and an `inputSchema` in JSON Schema. The host writes every entry into the context window, before your first prompt | `/context show` is higher than it was; `/mcp` shows the count              |
| **3 Call**    | model → host → server | The model writes a tool call: the name and a JSON object of arguments that fits the schema. The host checks its allow-list, shows you the arguments and asks. On yes, the client sends `tools/call`              | Kiro's prompt, with the tool name and the payload, waiting for your answer |
| **4 Result**  | server → model        | `content`, usually text, and an `isError` flag. The host puts it into the context like the output of a shell command, and the model reads it and goes on                                                         | The agent's next sentence                                                  |

Steps 1 and 2 happen once, before you type anything. Steps 3 and 4 happen per call. That split is the whole of lesson 2's "count your tools": the price of a server is paid at step 2, for every tool it offers, in every session, whether or not step 3 ever happens. A server with 250 tools costs more than every instruction file in this repository, every session, before the first prompt. Section 5 puts that number on your screen.

### Local or remote

A **local** server is a process the host starts on your machine and talks to over stdin and stdout. The Playwright server lesson 10 mentioned is one. It runs as you, sees your files and your environment variables, and any secret it needs goes into the config that starts it. A **remote** server is a URL the host connects to over HTTP. It runs on someone else's machine, so it can't see your files, and it authorises with OAuth in your browser: you sign in, you read what it asks for, you accept, and the token lives in the host's credential store. Nothing goes in the repository. The Atlassian server is remote, at `mcp.atlassian.com`, and from then on it acts as you, with your permissions, on your site.

### Where the control is

![Two rows, same start. Top row, lessons 4 to 9 on GitHub: you prompt, the agent writes a shell command as text, gh issue create with a parent flag. The PreToolUse guard reads that text and exits 0 or 2; then gh runs on the laptop and talks to GitHub. The control is a pattern on text, in the guard and in the deny list. Bottom row, this lesson on Jira: you prompt, the agent writes a tool call as JSON, createJiraIssue with projectKey ERP and type Epic. The guard box is greyed out: it never sees the call. The host checks the allow-list, thirteen of 258 tools are in the context at all, and asks you; the MCP client sends the call over HTTP to the Atlassian server, which talks to Jira. The control is which tools the model is shown, plus a yes per call. A note says the skills and the tracker doc are the same in both rows; only the lever changed.](images/mcp-shell-vs-tool-call.svg)

Lessons 4 to 9 reached GitHub through `gh`, a shell command. A shell command is text, so lesson 5's guard could read it before it ran and refuse `pnpm db:reset`, and lesson 9's deny list could name `gh issue close *`. A tool call isn't text the guard sees. It is a JSON object the host hands to the client, and `scripts/agent-guard.mjs` never runs. Three controls remain, and all three live in the host or behind the server:

- **What the model is shown.** The host decides which of the server's tools go into the context at step 2. In Kiro that is the `tools` list in the agent file, the same lever lesson 3 used to say `@builtin`: `@atlassian/createJiraIssue` names one tool, `@atlassian` names all 258. A tool that isn't in the context cannot be called, by mistake or otherwise. This is the control this lesson leans on.
- **The yes before each call.** The host shows the tool name and the arguments and waits. Kiro asks by default unless the agent file says otherwise. This lesson leaves it asking, and sections 8 and 9 are mostly about reading the payload before you say yes.
- **The account.** A remote server does what the signed-in account may do and nothing more. On your own site that is everything, which is why the first two controls matter.

The model decides which tool to call. The host decides which tools exist and which calls go through. The server decides what the call does. Keep those three apart and every configuration key in section 4 and Appendix A lands in one of them.

Two things MCP does **not** give you. It does not give you the guard: a tool call is not a shell command, so `scripts/agent-guard.mjs` never sees it. The equivalent is to not allow the tool. And it does not give you a diff: `gh issue create` left nothing on the machine, and neither does `createJiraIssue`, but the first one was a command you could read in the log and the second is a JSON object you can read if the client shows it. Kiro shows every tool call before it runs and asks, unless the agent file says otherwise. This lesson leaves it asking.

The server has its own answer to the cost problem, which section 5 uses. By default, `mcp.atlassian.com` offers a handful of tools: `discover`, which searches a catalogue, and three `execute` tools that run whatever `discover` found. Add `?tools=all` to the URL and it offers the whole catalogue flat, 258 tools across Jira, Confluence and the rest. Claude Code does the same trick on the client side, under the name tool search. We use the flat list on purpose, so the allow-list can name tools, and so you can see the number it saves.

---

## 4. What ships: the planner agent, the Jira tracker doc

### `.kiro/agents/planner.json`

A fourth agent, next to `erp`, `reviewer` and `implementer`. Read it beside `erp.json`; the diff is three keys:

| Key              | `erp`          | `planner`                                                                                                                                                                                  |
| ---------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mcpServers`     | absent         | One entry, `atlassian`, `"type": "http"`, URL `https://mcp.atlassian.com/v2/mcp?tools=all`. Declared inline, so no other agent can pick it up through `.kiro/settings/mcp.json`            |
| `tools`          | `["@builtin"]` | `@builtin` plus thirteen `@atlassian/<tool>` entries: the ones the tracker doc names, and no others. `@atlassian` alone would be all 258                                                   |
| `includeMcpJson` | `false`        | Still `false`. Your personal servers stay out, exactly as in lesson 3                                                                                                                      |
| `hooks`          | the guard      | The same guard. The planner still runs `gh issue view` in section 7 and `git` in section 6, and both go through it                                                                         |
| `permissions`    | absent         | Absent. The planner is interactive, you are in the chair, and every tool call asks. The implementer's deny list is not copied, because the planner never pushes, merges or closes anything |

The thirteen tools, grouped: one to find your site (`getAccessibleAtlassianResources`), two to read the project's shape (`listJiraProjects`, `getJiraIssueTypeMetaWithFields`), four to create, read, edit and search work items, two for links (`listJiraIssueLinkTypes`, `createJiraIssueLink`), one to comment, two to transition. No delete. No Confluence. No user management. The agent does not have a tool it is not supposed to use, which is a stronger rule than a deny list, because a tool that is not in the context cannot be called by mistake.

**[Verify in a real run: Kiro's OAuth against this server.** Kiro's documentation says it runs the browser flow itself and uses Dynamic Client Registration where the server supports it, and Atlassian's server supports OAuth 2.1. Nobody in the workshop has pressed the button yet. If `/mcp` shows the server stuck at connecting and no browser opens, replace the `atlassian` entry with a local proxy that does the OAuth for it:

```json
"atlassian": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "https://mcp.atlassian.com/v2/mcp?tools=all"]
}
```

Same tools, same allow-list; the proxy only owns the login. **Remove this box once one of the two is known to work.]**

### `docs/agents/issue-tracker-jira.md`

The Jira counterpart of the file lesson 4 generated. Open the two side by side. The headings are the same: Conventions, "When a skill says publish to the issue tracker", "When a skill says fetch the relevant ticket". Under each, where the GitHub file has a `gh` command, this one has a tool name and the fields that matter. Four decisions in it are worth reading before you let an agent act on them:

| Decision                                   | What the file says                                                                                                                                                   | Why                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Spec is an **Epic**, ticket is a **Story** | The one-to-one map of lesson 4's spec issue and sub-issues                                                                                                           | The Epic page lists its children with a progress bar, the same page lesson 7 started from on GitHub                     |
| Blocking is a **Blocks** link              | Blocker on the outward side, blocked item on the inward side, confirmed with `listJiraIssueLinkTypes` first; a `Blocked by:` line in the body only if the link fails | Native edges show in the sidebar; text is the fallback, exactly as the GitHub file had it                               |
| `cloudId` first, once                      | `getAccessibleAtlassianResources` at the start of every session, and ask if there is more than one site                                                              | Every Jira tool needs the site's id; an agent that guesses it writes into the wrong tenant                              |
| **No delete, no closing from GitHub**      | The delete tools are not described, and a `Closes` line in a pull request closes nothing in Jira                                                                     | Section 11. The loop's "closed on merge" step has no Jira equivalent without an integration this lesson doesn't install |

The file also fixes the project key, `ERP`, and the reference form, `ERP-12`. `/to-tickets ERP-1` is the invocation, where lesson 4 had `#15`.

---

## 5. Connect, authorise, measure

Three sessions, each a fresh window. The first two exist only to show you a number.

![Four horizontal bars on one scale, each the fixed cost of a session before the first prompt. Every bar starts with the same slate segment: system prompt, built-in tools, AGENTS.md and skill names. First bar, the erp agent with built-in tools only: the slate segment and nothing else, the baseline. Second bar, the planner with the whole Atlassian server, tools at-atlassian: a long amber segment, 258 tool definitions, taking most of the bar. Third bar, the planner with thirteen named tools: a short amber segment. Fourth bar, the planner with the server's own discover mode, no tools equals all: a sliver, four tools, discover plus three execute. A note says the lengths are relative and section 5 fills in the numbers from your own context show, and that the cost is paid at tools list, before the first prompt, whether or not a tool is ever called.](images/mcp-tool-cost.svg)

**Baseline.** Start the agent you have used since lesson 3 and read its fixed cost:

```
kiro-cli chat --agent erp
/context show
```

Write down the total. In our run it was **[Fill from a real run: the erp agent's context total]**.

**Everything.** Now edit `.kiro/agents/planner.json` and replace the thirteen `@atlassian/...` lines with one: `"@atlassian"`. Don't commit this. Start the planner:

```
kiro-cli chat --agent planner
```

Kiro connects to the server, and your browser opens on Atlassian's consent page. Sign in with the account that owns the site, read what it asks for, and accept. Back in the terminal:

```
/mcp              # atlassian: connected, N tools
/context show
```

**[Fill from a real run: the tool count `/mcp` reports and the context total.]** Compare it with the baseline. The difference is what the room's "one person has a GitHub MCP server with forty tools" cost in lesson 3, times six, and it is paid before the first prompt.

If the browser never opens, `/mcp auth` forces the flow again, and if that also does nothing, the box in section 4 is for you.

**Thirteen.** Put the file back and start again:

```bash
git checkout .kiro/agents/planner.json
```

```
kiro-cli chat --agent planner
/mcp              # atlassian: connected, 13 tools
/context show
```

**[Fill from a real run: the context total with the allow-list.]** The authorisation is still valid; you don't sign in again. The number should be a little above the baseline and far below the previous one. That gap is the lesson. A server is not expensive. A server you didn't narrow is.

Before going on, one read-only call to prove the tools work and the site is the right one. In the same session:

```
Which Jira sites can you see, and which projects are in the first one? Read only, create nothing.
```

Kiro asks before the two calls, `getAccessibleAtlassianResources` and `listJiraProjects`, and you say yes to each. Expect one site and the `ERP` project. If it lists a company site as well, the account you signed in with sees both; the tracker doc says the agent must ask, and the answer in this room is always your own.

---

## 6. Swap the tracker doc on a branch

The skills read `docs/agents/issue-tracker.md`. On `main` that is the GitHub file, and lessons 7 to 10 need it to stay that way. So the swap is a branch:

```bash
git switch -c lesson-11-jira
cp docs/agents/issue-tracker-jira.md docs/agents/issue-tracker.md
grep -n "Issue tracker" -A 2 AGENTS.md
```

The grep shows the "Agent skills" block the setup skill wrote in lesson 4, with a one-line summary that still says GitHub. Change that one line to say Jira, leave the `See docs/agents/issue-tracker.md` sentence as it is, and commit:

```bash
git add docs/agents/issue-tracker.md AGENTS.md
git commit -m "Point the planning skills at Jira"
```

That is the whole switch. Nothing under `.kiro/skills/` changed. If you want to prove it, `git diff main --stat` shows two files, and neither is a skill.

Start the planner once more, in this branch, for the rest of the lesson. Don't clear it until section 9 is done, for lesson 4's reason: `to-spec` writes the spec from the conversation.

```
kiro-cli chat --agent planner
/context show       # issue-tracker.md loads through AGENTS.md; the Jira version is now what the agent sees
```

---

## 7. Grill CR-01

Lesson 4 grilled the whole TOR and left one thing out on purpose: section 10.3, change request CR-01, damaged goods on receipt, "under consideration and excluded from the approved baseline". It is the right size for this lesson. It touches goods receipts, stock, history and reports, it lists its own acceptance scenarios, and it has decisions nobody has made. Read it once, it is one paragraph and a list.

The grill reads two things: the change request, and the spec you published in lesson 4, because the baseline is decided and the agent must not reopen it. The spec is on GitHub, and the planner still has `gh`:

```
/grill-me Read docs/tors/Retail_ERP_TOR_EN.md section 10.3, CR-01, and the first-release spec with `gh issue view <spec number>`. The baseline in that spec is decided: two roles, English UI, the four test seams, the posting rules. Do not reopen it. Grill me on CR-01 only: how delivered, usable and damaged quantities relate, whether damaged quantity counts toward purchase order fulfilment, where damaged stock is held and whether it ever becomes sellable, what evidence and authorisation a damaged receipt needs, the impact on GR-02, GR-03 and GR-05, on inventory history and on reports, and how each rule will be proven at the spec's seams, until we can write the spec.
```

Lesson 4's three rules still hold: facts are the agent's job, decisions are yours, nothing is written. Expect three or four rounds. Questions that came up in our run **[Fill from a real run: the decisions]**: whether `damagedQty` is a column on the receipt line or a second line with a reason; whether damaged quantity counts toward fulfilment (the TOR hints no, and says so for sellable stock); a quarantine store versus a status on the stock row; whether a photo or a note is the evidence; whether a `STAFF` user may record damage or only an `ADMIN`; and which of GR-04's idempotency and GR-05's concurrency criteria apply unchanged to a receipt with a damaged quantity.

Confirm the shared understanding when the frontier is empty. Don't clear.

---

## 8. `/to-spec`: the Epic

```
/to-spec
```

The seams question comes first, as in lesson 4, and the answer is the four seams the spec already names: contract schema, controller spec with a stubbed `PrismaService`, web component, and the Postgres integration harness that lesson 7's first stock ticket built. Say yes.

Then it publishes, and this is the step to watch. Kiro shows each tool call and asks. In our run the sequence was **[Fill from a real run: the calls]**, and it should look like: `getAccessibleAtlassianResources`, `listJiraProjects`, `getJiraIssueTypeMetaWithFields` for Epic, then one `createJiraIssue`. Read the `createJiraIssue` payload before you say yes: `projectKey` `ERP`, type `Epic`, the label `ready-for-agent`, and the whole spec in the description. If it is about to create a Story, or create in another project, say no and tell it where the tracker doc says the spec goes.

It reports a key. Note it; `ERP-1` from here on, read yours:

Open `https://<your site>.atlassian.net/browse/ERP-1`. Lesson 4's four checks apply to the body, and one more: **the description rendered.** The tool takes Markdown, Jira stores a different format, and headings or checklists that come through as literal `#` and `- [ ]` are a tool-call problem, not a spec problem. **[Verify in a real run: how the description renders, and whether the skill needs to be told to keep the Markdown plain.]**

If a decision is wrong, say so in the chat; the agent edits the description with `editJiraIssue`, and you say yes to that call after reading it. Don't move on with a spec you wouldn't sign.

`/context show` here, as in lesson 4. The spec is in Jira, `/to-tickets ERP-1` fetches it regardless, and this is the safe moment to `/compact` if the window is past half.

---

## 9. `/to-tickets`: Stories under the Epic

Lesson 4's invocation, with the Jira words changed and the size changed. A change request is a handful of tickets, not twenty:

```
/to-tickets ERP-1

Ticket shape for this repository, on top of your usual template:
- Aim for 3 to 6 tickets. Each is one vertical slice through schema, contract, API, UI and tests, demoable on its own, sized for one fresh context window.
- Under "What to build", add three lines. `Covers:` the TOR requirement IDs this ticket implements, with CR-01 on every one. `Demo:` what I can show when it is done. `Seams:` which of the four test seams in the spec this ticket uses.
- Every acceptance criterion fails against today's code, is observable at one of those seams, and cites CR-01's scenarios (normal receipt, invalid quantities, duplicate requests, concurrent receiving, unauthorised access) where one applies.
- No cross-cutting tickets. A rule lands in the first ticket that needs it, and every later ticket that uses it is blocked by that ticket.
- Each ticket is a Story with ERP-1 as its parent. Set every blocking edge as a Blocks link and leave the "Blocked by" section out of the published body. Draft numbers such as T02 never go into a work item.
Show me the numbered list before publishing anything.
```

The numbered list comes first; this is still the step where you earn your keep. Check the edges: the schema change that adds damaged quantities blocks everything, the report ticket is blocked by whatever writes the rows it reads, and nothing is blocked by the report. Approve it.

Then watch the calls. For each ticket, in dependency order: `createJiraIssue` with the `parent` field, then one `createJiraIssueLink` per blocker, after a single `listJiraIssueLinkTypes` at the start. **[Fill from a real run: the call sequence for the first two tickets.]** Two things to refuse:

- A `createJiraIssue` without `parent`, followed by a plan to "set it afterwards". The field is on the create call; the doc says so.
- A link where the ticket is on the outward side. `Blocks` is directional: the blocker "blocks", the ticket "is blocked by". The sidebar on the ticket's page should read **is blocked by**, and the doc describes which side is which.

If a link call fails and the agent falls back to a `Blocked by: ERP-3` line, that is the documented fallback and it is fine. Note it for section 10.

---

## 10. Check that it worked

Read `ERP-1` as your Epic's key, and `ERP-2` to `ERP-7` as its Stories.

**On the site**, at `https://<your site>.atlassian.net/browse/ERP-1`:

- The Epic carries the label `ready-for-agent` and its description is the spec, rendered, not literal Markdown.
- The "Child work items" section lists three to six Stories, with a progress bar at zero.
- Open the first Story. The description has `Covers:`, `Demo:` and `Seams:` lines, every `Covers:` names CR-01, and the criteria fail against today's code.
- Open a Story that depends on another. The "Linked work items" section says **is blocked by** and names a real key. No `T02` anywhere.
- At least one Story has no "is blocked by" entry: the frontier, in lesson 7's sense, has at least one ticket on it.

**Through the agent**, in the planner session, two read-only questions. Each is one `searchJiraIssuesUsingJql` call you say yes to:

```
Run this JQL and list the keys and summaries: project = ERP AND labels = ready-for-agent ORDER BY created ASC
```

Expect the Epic first and every Story after it. Then:

```
Run this JQL and list the keys: project = ERP AND parent = ERP-1 AND issueLinkType = "is blocked by"
```

Expect every Story except the ones on the frontier. **[Verify in a real run: that `issueLinkType` resolves on a team-managed project; if not, replace the second query with "open each child and report its inward links".]**

**In git:**

- `git diff main --stat` on `lesson-11-jira` shows `docs/agents/issue-tracker.md` and `AGENTS.md`, and nothing under `.kiro/` or `.agents/`.
- `git status --short` is clean. `planner.json` is the shipped version, thirteen tools, not `@atlassian`.
- `git switch main && cat docs/agents/issue-tracker.md | head -3` is the GitHub file again. Lessons 7 to 10 still work on `main`.

**In Kiro:**

- `/mcp` in a planner session shows one server and thirteen tools. `/mcp` in an `erp` session shows no servers.
- `/context show` in a planner session shows the number you wrote down in section 5's third run, not the second.

---

## 11. Read, don't run: what would change downstream

This lesson stops at tickets. The reason is not that the rest is hard; it is that the rest is a different lesson for each step, and each step is a decision the room should make with its eyes open. Here is the list.

| Lesson 7 and 9 step                       | On GitHub                                                  | On Jira                                                                                                                                                                                     | What it would take                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fetch the ticket, `/implement-ticket #16` | `gh issue view 16` through the tracker doc                 | `getJiraIssue ERP-4` through the same doc. The skill already works; the agent doesn't                                                                                                       | The `implementer` and `erp` agents would need the server and three read tools. That is the lock from lesson 3 loosened on the agent that writes code         |
| The frontier query                        | One `gh api` call: open sub-issues with zero open blockers | JQL can say `parent = ERP-1 AND statusCategory != Done`, and can filter on `issueLinkType`, but it cannot say "all of whose blockers are Done". That needs one `getJiraIssue` per candidate | A script that reads links per item, or a saved filter plus a custom field. `implement-frontier.sh` rewritten against the REST API with a token, not MCP      |
| `Closes #16` on merge                     | GitHub closes the issue                                    | Nothing happens. Jira doesn't read GitHub pull requests                                                                                                                                     | The GitHub for Jira app, or smart commits (`ERP-4 #done` in a commit message), both of which are admin installs on the Jira side, or a transition by a human |
| The reviewer reads the ticket             | `gh issue view` inside the review job                      | The job has no browser to authorise with. OAuth is for people                                                                                                                               | API-token auth on the Atlassian server, which an org admin has to enable, with the token in a GitHub secret. Lesson 8's secret handling, one more secret     |
| The guard's deny list, `gh issue close *` | A shell pattern                                            | There is no shell. `transitionJiraIssue` is a tool                                                                                                                                          | Leave it out of the agent's allow-list. For headless runs, that is the only control                                                                          |

The pattern in the right-hand column: every step that was free on GitHub costs either a loosened lock on an agent that writes code, or an admin on the Jira side, or a secret. None of those is wrong. Each one is a decision, and the room should make it with the numbers from section 5 in front of it, and with lesson 9's rule in mind: a loop that runs without you is only as safe as the shortest deny list in it.

---

## Summary

- **The tracker was never in the skills.** `to-spec`, `to-tickets` and `implement` read `docs/agents/issue-tracker.md`. Swap the file, and the same skills publish somewhere else. This lesson's diff against `main` is two files, and neither is a skill.
- **An MCP server is a tool list, paid for at startup.** Atlassian's offers 258. You saw the context total with all of them and with thirteen, and the gap is lesson 2's "count your tools" as a number on your own screen.
- **Lesson 3's lock stayed on.** `erp`, `reviewer` and `implementer` are unchanged. One new agent, `planner`, declares one server inline with `includeMcpJson` still false, and lists the tools it may see by name. A tool that isn't in the context can't be called by mistake, which is a stronger rule than any deny list.
- **A remote server authorises in the browser, once.** OAuth, no token on disk, nothing in the repository. The agent acts as you, with your permissions, on your site.
- **The guard doesn't see tool calls.** A shell command is text the guard can read; a tool call isn't. Where lesson 5 had a rule, this lesson has an allow-list, and Kiro asking before every call.
- **Jira's shape maps one to one.** Spec to Epic, ticket to Story with a parent, dependency to a Blocks link, label to label. Lesson 4's checks still apply; they read differently.
- **The implement loop stays on GitHub, on purpose.** Each downstream step costs a loosened lock, an admin, or a secret. Section 11 lists them. Deciding them is the room's job, not this lesson's.

---

## Optional: try it later

**Discover instead of the flat list.** Drop `?tools=all` from the URL in `planner.json`, set `tools` to `@builtin` plus `@atlassian`, and start the planner. `/context show` now costs about what the thirteen did, because the server offers `discover` and three `execute` tools and nothing else. Ask it to find the Epic. Watch it call `discover` with a sentence, then `executeRead` with a tool name it just learned. Then decide which you prefer: a list you wrote, or a search the agent runs. Both are answers to the same number.

**The same switch in Claude Code.** Appendix A's config, then `/context`. Claude Code defers MCP tools behind tool search by default, so the "everything" number is small before you narrow anything. Set `ENABLE_TOOL_SEARCH=false claude` once to see the same cliff Kiro showed you.

**Fetch a ticket with `/implement-ticket`.** On `lesson-11-jira`, in a planner session, `/implement-ticket ERP-2`. It fetches the Story through the tracker doc and states its title, which proves the fetch side of section 11's first row. Stop it at the seams question; the planner is not for implementing, and the branch's tracker doc would make the pull request point at a key GitHub can't close.

**The setup skill's own route.** On a scratch branch, run `/setup-matt-pocock-skills`, pick "Other", describe Jira in one paragraph, and diff what it writes against `issue-tracker-jira.md`. Everything it leaves out is something an agent would have guessed.

---

## Appendix A: the same switch in Claude Code and Codex

The tracker doc and the swap in section 6 are harness-neutral. What differs is where the server is declared and how tools are narrowed.

**Claude Code.** The server goes in a committed `.mcp.json` at the repository root. Lesson 3's `enableAllProjectMcpServers: false` still stands, so the server is approved by name instead:

```json
// .mcp.json
{
  "mcpServers": {
    "atlassian": {
      "type": "http",
      "url": "https://mcp.atlassian.com/v2/mcp?tools=all"
    }
  }
}
```

```json
// .claude/settings.json, added to lesson 3's keys
{
  "enabledMcpjsonServers": ["atlassian"],
  "permissions": {
    "deny": ["mcp__atlassian__deleteJiraIssue", "mcp__atlassian__deleteJiraIssueLink"]
  }
}
```

Then `/mcp`, pick `atlassian`, authenticate in the browser. Claude Code has no per-agent allow-list for a project server; the control is `permissions`, and the default is to ask before every MCP call, which is the same posture as the planner. Tool search is on by default, so `/context` shows the server's tools as deferred and the "everything" cost from section 5 doesn't appear unless you switch it off. The two deny rules above are **[Verify in a real run: the exact delete tool names on the flat list]**.

**Codex.** The server goes in `.codex/config.toml`, which Codex reads only in a trusted project, and the allow-list is the `enabled_tools` key:

```toml
[mcp_servers.atlassian]
url = "https://mcp.atlassian.com/v2/mcp?tools=all"
enabled_tools = [
  "getAccessibleAtlassianResources", "listJiraProjects", "getJiraIssueTypeMetaWithFields",
  "createJiraIssue", "getJiraIssue", "editJiraIssue", "searchJiraIssuesUsingJql",
  "listJiraIssueLinkTypes", "createJiraIssueLink", "addOrEditJiraIssueComment",
  "listJiraIssueTransitions", "transitionJiraIssue",
]
```

Then `codex mcp login atlassian` in a terminal for the browser flow. The skills are invoked as `$grill-me`, `$to-spec` and `$to-tickets ERP-1`.

| Step               | Kiro CLI                                            | Claude Code                                                         | Codex                                           |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| Declare the server | `.kiro/agents/planner.json`, `mcpServers`, inline   | `.mcp.json`, approved by `enabledMcpjsonServers`                    | `.codex/config.toml`, `[mcp_servers.atlassian]` |
| Narrow the tools   | `tools`: `@atlassian/<name>` per tool               | `permissions.deny` per tool; tool search defers the rest            | `enabled_tools`                                 |
| Authorise          | Browser opens on first connect; `/mcp auth` to redo | `/mcp`, or `claude mcp login atlassian`                             | `codex mcp login atlassian`                     |
| Measure            | `/context show`                                     | `/context`, with `ENABLE_TOOL_SEARCH=false` to see the upfront cost | `codex mcp list`, no context breakdown          |
| Keep others locked | `includeMcpJson: false` on every agent              | `enableAllProjectMcpServers: false` stays                           | User-level servers can only be disabled by name |

---

## Further reading

- Model Context Protocol, [Specification](https://modelcontextprotocol.io/specification/latest) and [Tools](https://modelcontextprotocol.io/specification/latest/server/tools): what a server offers and how a client lists it.
- Model Context Protocol, [Architecture overview](https://modelcontextprotocol.io/docs/learn/architecture), [Transports](https://modelcontextprotocol.io/specification/latest/basic/transports) and [Authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization): host, client and server as section 3 draws them; stdio against Streamable HTTP; and the OAuth flow a remote server runs in your browser.
- Atlassian, [Getting started with the Atlassian Rovo MCP Server](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/), [Supported tools](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/), and [Authentication via API token](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/configuring-authentication-via-api-token/): the endpoint, `?tools=all`, the tool names, and the admin-gated route section 11 needs.
- Atlassian, [Rovo usage limits](https://support.atlassian.com/rovo/docs/rovo-usage-limits/): which calls cost credits. Writes and single reads don't; searches do.
- Kiro, [Custom agent configuration reference](https://kiro.dev/docs/custom-agents/configuration-reference/) and [MCP configuration](https://kiro.dev/docs/mcp/configuration/): `mcpServers`, `@server/tool`, `includeMcpJson`, and the OAuth flow.
- Claude Code, [MCP](https://code.claude.com/docs/en/mcp): `.mcp.json`, `enabledMcpjsonServers`, tool search and `alwaysLoad`.
- Codex, [MCP](https://developers.openai.com/codex/mcp): `[mcp_servers]`, `enabled_tools`, `codex mcp login`.
- Matt Pocock, [setup-matt-pocock-skills](https://github.com/mattpocock/skills/tree/main/skills/engineering/setup-matt-pocock-skills): the GitHub tracker template the Jira file mirrors, and the "Other" route the sidebar in section 1 describes.
- Jira, [JQL fields](https://support.atlassian.com/jira-software-cloud/docs/jql-fields/): `parent`, `labels`, `statusCategory` and `issueLinkType`, and why section 11's frontier needs more than one query.
