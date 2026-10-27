# Issue tracker: Jira Cloud, through the Atlassian MCP server

This repository's planning skills (`to-spec`, `to-tickets`, `implement`) publish to and read from "the issue tracker". This file says what that means when the tracker is Jira. It is the Jira counterpart of the GitHub file `setup-matt-pocock-skills` writes, with the same sections, so a skill that worked against GitHub works against Jira without being edited.

The agent reaches Jira through the Atlassian MCP server, not a CLI. Every operation below names the MCP tool that performs it. If a tool is missing from the session, say so and stop: the agent you are running is not the `planner` agent, or its allow-list was narrowed.

## Where things are

- **Site:** the one Jira Cloud site the signed-in account can see. Call `getAccessibleAtlassianResources` once at the start of a session to get its `cloudId`, and pass that `cloudId` to every other call. If the account sees more than one site, ask which one; never pick.
- **Project:** key `ERP`, a team-managed Software project. Confirm it with `listJiraProjects` before the first write.
- **Work item types** (Jira's current name for issues): `Epic` for a spec, `Story` for a ticket. Read the fields each type accepts with `getJiraIssueTypeMetaWithFields` before creating the first one of that type in a session, and reuse the answer.
- **References:** a work item is referenced by its key, `ERP-12`. A skill that accepts "an issue number or URL" accepts a key or the item's browse URL.

## Conventions

| Operation                  | Tool                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a work item         | `createJiraIssue` with `projectKey` `ERP`, the type, a summary, a description, and labels. Descriptions are written in Markdown; keep headings and checklists simple                                                                                                                                                                   |
| Read a work item           | `getJiraIssue` by key. Read the description, the labels, the parent, the links and the comments                                                                                                                                                                                                                                        |
| List work items            | `searchJiraIssuesUsingJql`. Examples: `project = ERP AND labels = ready-for-agent ORDER BY created ASC`; `project = ERP AND parent = ERP-1 AND statusCategory != Done`                                                                                                                                                                 |
| Edit a work item           | `editJiraIssue` by key. Summary, description, labels and parent are all fields on this call                                                                                                                                                                                                                                            |
| Comment                    | `addOrEditJiraIssueComment`                                                                                                                                                                                                                                                                                                            |
| Apply or remove a label    | `editJiraIssue` with the full `labels` list. Jira labels are free-form and need no creating. The label every skill applies is `ready-for-agent`                                                                                                                                                                                        |
| Close a work item          | `listJiraIssueTransitions` to find the transition into the `Done` status category, then `transitionJiraIssue`                                                                                                                                                                                                                          |
| Make it a child of a spec  | Set the `parent` field to the Epic's key, on `createJiraIssue` at creation or `editJiraIssue` afterwards. If the field is rejected, put `Part of ERP-1` as the first line of the description                                                                                                                                           |
| Mark it blocked by another | `createJiraIssueLink` of type `Blocks`: the blocker is the outward side ("blocks"), the blocked item is the inward side ("is blocked by"). Call `listJiraIssueLinkTypes` once per session to confirm the type's exact name. If the link cannot be created, put a `Blocked by: ERP-3, ERP-4` line at the top of the blocked item's body |

Never delete a work item. The delete tools are not in the allow-list and this file does not describe them.

## When a skill says "publish to the issue tracker"

- **A spec** becomes one work item of type `Epic`, labelled `ready-for-agent`. Its description is the spec. Report its key.
- **A set of tickets** becomes one `Story` per ticket, each with the Epic as parent and the label `ready-for-agent`, published in dependency order, blockers first, so every link names a real key. Set each blocking edge with the `Blocks` link type, and leave the "Blocked by" section out of the body once the link exists. Draft numbers such as `T02` never go into a published body.
- **Anything else** (a note, a follow-up) is a `Story` under the Epic the user names, or a comment on the item they point at.

## When a skill says "fetch the relevant ticket"

Read it with `getJiraIssue`. State its summary before starting. The ticket's parent is the spec; read that too when the ticket refers to decisions it does not restate. If the reference is ambiguous (a bare number, a title), search with `searchJiraIssuesUsingJql` and ask.

## Work that stays on GitHub

Pull requests, CI and the AI review are on GitHub and are not changed by this file. A pull request body links to its ticket by key, `ERP-12`, in the first line. Nothing on GitHub closes a Jira item: closing is a transition, done by a human, through the UI or the tools above.
