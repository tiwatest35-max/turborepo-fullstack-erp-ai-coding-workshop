#!/usr/bin/env node
// PreToolUse guard for AI coding agents (Kiro CLI, Claude Code, Codex).
//
// The agent's harness runs this before every shell command and pipes the
// pending tool call to stdin as JSON. Exit 0 lets the command run. Exit 2
// blocks it and hands stderr to the agent as the reason. See lessons/05.
//
// The three tools send slightly different JSON, so this reads the command
// from the fields it knows and falls back to the whole payload.

import { readFileSync } from 'node:fs';

const rules = [
  {
    name: 'database reset',
    test: /\bprisma\s+migrate\s+reset\b|\bdb:reset\b/,
    why: 'drops every table in the dev database and replays all migrations',
  },
  {
    name: 'Docker volume removal',
    test: /\bdocker\s+compose\s+down\b[^\n]*\s(-v|--volumes)\b|\bdocker\s+volume\s+(rm|prune)\b/,
    why: 'deletes the Postgres volume and all data in it',
  },
  {
    name: 'force push',
    test: /\bgit\s+push\b(?![^\n]*--force-with-lease)[^\n]*\s(-f|--force)\b/,
    why: 'rewrites history on the remote that other people pull from',
  },
  {
    name: 'recursive delete',
    // rm -r / -rf / -fr on anything other than build output.
    test: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)+(?![^\n]*\b(node_modules|dist|\.turbo)\b)[^\n]+/,
    why: 'removes files that are not build output and may not be in git',
  },
  // The next three keep the merge decision with a human. See lessons/08.
  {
    name: 'pull request merge',
    test: /\bgh\s+pr\s+merge\b/,
    why: 'merges a pull request, which only a human reviewer who is not the author may do',
  },
  {
    name: 'pull request verdict',
    test: /\bgh\s+pr\s+review\b[^\n]*\s(-a|--approve|-r|--request-changes)\b/,
    why: "approves or requests changes on a pull request, which is the human reviewer's verdict; review with --comment instead",
  },
  {
    name: 'ticket or pull request close',
    test: /\bgh\s+(issue|pr)\s+(close|reopen)\b/,
    why: 'closes or reopens a ticket or pull request; tickets close when their pull request merges',
  },
  // The loop script resets the database and starts other agents. A human runs it. See lessons/09.
  {
    name: 'implement loop',
    test: /\bimplement[:-]frontier\b/,
    why: 'runs the implement loop over the frontier, which resets the database and starts agents; a human starts it from a terminal',
  },
  // Playwright's browser install can also install system packages with sudo and apt-get.
  // The browser download alone is fine. A human runs the system half once per machine; the CI job runs it on the runner. See lessons/10.
  {
    name: 'system package install for Playwright',
    test: /\bplaywright\s+install\b[^\n]*\s--with-deps\b|\bplaywright\s+install-deps\b/,
    why: 'installs system packages with sudo and apt-get; run `playwright install chromium` without --with-deps, and let a human install the system packages',
  },
];

// Tool names the three harnesses use for "run a shell command". Anything else
// (file edits, searches) is let through untouched, even if its payload happens
// to contain one of the strings above.
const shellTools =
  /^(bash|shell|execute_bash|execute_cmd|execute_pwsh|exec_command|run_shell_command)$/i;

function readCommand() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return '';
  }
  try {
    const payload = JSON.parse(raw);
    if (typeof payload.tool_name === 'string' && !shellTools.test(payload.tool_name)) return '';
    const input = payload.tool_input ?? payload.toolInput ?? payload.input ?? {};
    if (typeof input === 'string') return input;
    if (typeof input.command === 'string') return input.command;
    if (typeof input.cmd === 'string') return input.cmd;
    if (Array.isArray(input.command)) return input.command.join(' ');
    return JSON.stringify(input);
  } catch {
    return raw;
  }
}

const command = readCommand();
const hit = rules.find((rule) => rule.test.test(command));

if (hit) {
  process.stderr.write(
    `Blocked by scripts/agent-guard.mjs: ${hit.name}. This command ${hit.why}. ` +
      `Do not retry it or work around it. Tell the human what you wanted to run and why, and let them run it.\n`,
  );
  process.exit(2);
}

process.exit(0);
