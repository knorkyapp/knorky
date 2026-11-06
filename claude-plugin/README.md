# Knorky for Claude Code

A plugin for [Claude Code](https://claude.com/claude-code) that tracks the time
you work with Claude on your Knorky account. The documentation is on
[knorky.com](https://knorky.com/en/docs/claude-code-plugin/), also
[in German](https://knorky.com/docs/claude-code-plugin/). For help, write to
[support@knorky.com](mailto:support@knorky.com).

- **A timer above the prompt**, like the app's player: ▶ and ⏸, the task and
  its project, and the time you worked today on all tasks, in hours and
  minutes as the app shows it. A **+** adds a paused task back next
  to the timers that run, so the time is split. On a break, ▶ ends it.
- **Claude tracks by itself.** When you start a piece of work, Claude finds
  the task or creates it, starts its timer and tells you in one line. It does
  not ask first. An issue in the branch name finds the task linked to it: a
  key like `ENG-123`, or a GitHub issue number (`feat/102-…`, `gh-102`).
- **One project per repository.** Claude asks once which project a
  repository's work goes to, and remembers it.
- **Timers stop with the session.** When the session ends, every timer it
  started ends. `/clear` and `/resume` end no timer, as you go on working. A
  quiet session keeps its timers: time without prompts, such as testing in a
  browser, is work too. When another Claude Code window tracks the same task,
  its timer keeps running. Timers you started in the app keep running.
- **Breaks only when you use them.** Claude starts a break ("I'm off to
  lunch") only while breaks are switched on in the app (Settings → Tracking,
  off at first); otherwise it stops the timers.
- **Notes from your commits.** When the plugin stops a timer, the entry's
  note lists the commits made since it started.
- **Claude's own work, kept apart.** How long Claude worked and the tokens
  it used, per day and task (see [Claude's own work](#claudes-own-work)).

Contents: [What you need](#what-you-need) · [Install](#install) ·
[Sign in](#sign-in) · [Your first session](#your-first-session) ·
[The timer above the prompt](#the-timer-above-the-prompt) ·
[Commands](#commands) · [Claude's own work](#claudes-own-work) ·
[When something is wrong](#when-something-is-wrong) ·
[What the plugin does on your computer](#what-the-plugin-does-on-your-computer) ·
[What it stores](#what-it-stores) · [Update or remove](#update-or-remove) ·
[Your own server](#your-own-server) · [Developing](#developing)

## What you need

- [Claude Code](https://claude.com/claude-code), in a terminal, an editor or
  the Claude desktop app.
- A Knorky account whose plan includes the API. On the hosted service that
  is the Plus plan.
- A git repository to work in is usual, but not needed: without one, the
  project is remembered for the folder.

## Install

At the prompt of Claude Code:

```
/plugin install knorky --marketplace knorkyapp/knorky
```

Answer `y` to add the marketplace, then choose a scope (user: every
session). From a shell:

```sh
claude plugin install knorky --marketplace knorkyapp/knorky
```

In the Claude desktop app: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `knorkyapp/knorky`, then **Add plugin**.

Start a new session afterwards: a plugin loads when a session starts.

## Sign in

The plugin brings its own connection to the Knorky server. It needs you to
sign in once:

1. Run `/mcp`.
2. Choose `plugin:knorky:knorky`, then **Authenticate**.
3. Your browser opens Knorky's sign-in. Sign in and allow the access.

Back in Claude Code, a line appears above the prompt: the timer that runs,
or, with none running:

```
⏱ not tracking · /track <task>
```

That line is the check: it shows only once the plugin reaches the server. If
it says `⏱ connected`, the plugin found the server by itself and has not read
your timers yet: press ↻ or send a message. Run `/track` to see what runs and which project this repository uses.

If you also added Knorky as a connector on claude.ai, `/mcp` lists it too, as
`claude.ai Knorky`. Turn it off there, for Claude Code only: the plugin cannot
use a claude.ai connector, and with both on Claude sees every tool twice. It
stays on for claude.ai and your phone.

## Your first session

1. **Start a piece of work**, as you always would: "Fix the login redirect".
2. **Claude asks once for the project** of this repository, from the list of
   your projects. Answer with its name. Claude remembers it for this
   repository, in every later session.
3. **Claude finds the task or creates it, and starts its timer.** It tells
   you in one line:

   ```
   Tracking, split: Fix the login redirect
   ```

   By default the task joins the timers already running, and the time
   is split between them: two tasks that run for an hour get 30 minutes
   each. To stop the others, say so ("instead", "only this") or use
   `/track <task>`. When your words leave it unclear, Claude asks before
   stopping them. `/track default only` makes stopping the others the
   default; the line then names what it stopped.

4. **Work.** When the work moves to something clearly different, Claude
   starts that task's timer the same way. When you say the work is done,
   Claude stops the timer with a one-line note.
5. **Leave.** When you close the session, the timers it started end by
   themselves. Their notes list the commits you made. Going away without
   closing it? Press ⏸ or say so.

Not happy with a task Claude chose? Name the right one: `/track <task>`.

## The timer above the prompt

```
[⏸ +1] Fix the login redirect · Website · today 2:40 [↻]
```

| Part                     | What it means                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| ⏸                        | Pauses the task: its timer stops, the task stays here                                                       |
| ⏸ +1                     | The same, while one more timer runs: the time is split between them                                         |
| ▶                        | Starts the task again, alone                                                                                |
| +                        | Starts the task again next to the running timers: the time is split                                         |
| `Fix the login redirect` | This session's task                                                                                         |
| `Website`                | Its project                                                                                                 |
| `today 2:40`             | The time you worked today, on all tasks, as the app's today total shows it; it counts on while a timer runs |
| `+1 running`             | This task is paused; one other timer runs                                                                   |

On a break the line reads `▶ on a break · 0:15`, and ▶ ends the break. When
the server reports a problem, the line shows it: `⏱ time tracking: …`.

**↻** at the end of the line asks the server again for what runs and for
today's time, for example after you changed a timer in the app. The line also
updates by itself when Claude finishes a turn; between those updates it counts
on from the last answer.

## Commands

| Command                 | What it does                                                                      |
| ----------------------- | --------------------------------------------------------------------------------- |
| `/track`                | What runs with each task's total, this repository's project, and a link to Knorky |
| `/track <task>`         | Tracks only this task: the other timers stop                                      |
| `/track add <task>`     | Tracks this task too: the time is split with the running ones                     |
| `/track stop`           | Stops this session's task                                                         |
| `/track default split`  | Claude adds its tasks to the running timers (the default)                         |
| `/track default only`   | Claude tracks only its task: the other timers stop                                |
| `/track project <name>` | The project this repository's time goes to                                        |

A task named with `/track` is found in the project by its title, or created.
You can also just ask Claude: "add the docs task", "track this in parallel",
"track only this", "stop the timer".

**One task, or several at once?** `/track <task>` suits one thing at a
time. `/track add <task>` suits several Claude Code windows on different
tasks at once: each window's task joins the running timers, and Knorky
shares the time between them, so the hours add up to the real time worked.

## Claude's own work

After each of Claude's turns the plugin sends the server what Claude did
in this session so far, per day and task: how long its turns took, how many
there were, the tokens they used (sub-agents' included) and the model that
wrote most. The task is the one this session tracks; with none, the
repository's project. A turn belongs to the day it ends on, in your time
zone.

The app shows it in the **Coding agents** card in Reports, and on the task's
page:

![The Coding agents card in Reports: time, tokens and an estimated price for today, this week and this month, with a line per agent](docs/coding-agents-card.png)

This is Claude's work, not yours: it never counts toward your tracked
time, goals, earnings or invoices. The prices are estimates from list
prices; a subscription is not charged per token. The server tool that
receives it, `record_agent_work`, is the plugin's alone: when Claude tries to
call it, the plugin refuses. When a report cannot be sent, the next one
carries the totals.

## When something is wrong

**No line above the prompt.** The plugin has not reached the server. Run
`/mcp`: `plugin:knorky:knorky` should say connected. If it asks you to
authenticate, sign in (see [Sign in](#sign-in)). If it does not appear at
all, check that the plugin is installed and enabled (`/plugin`), and start a
new session.

**`/track` says "No time-tracking server is connected."** The same: sign in
through `/mcp`.

**The line says `⏱ time tracking: …`.** The server refused a call, and the
line shows why. When it is about the plan, your account's plan does not
include the API.

**Claude sees every tool twice.** The claude.ai connector and the plugin's
server are both on. Turn off `claude.ai Knorky` in `/mcp`.

**The timer kept running after I closed the session.** Another Claude Code
window tracks the same task, so it keeps its timer. Or the server could not
be reached when the session ended: stop it in the app, or ask Claude to
stop it.

**The time goes to the wrong project.** `/track project <name>` changes it
for this repository.

**In auto mode, the line says the plugin's calls are refused.** The plugin
leaves every permission decision to you. To let its calls through, allow the
tools it uses in your Claude Code permission rules: `/permissions`, then
**Allow**, one rule per tool:

```
mcp__plugin_knorky_knorky__get_running_timers
mcp__plugin_knorky_knorky__get_time_totals
mcp__plugin_knorky_knorky__list_tasks
mcp__plugin_knorky_knorky__list_projects
mcp__plugin_knorky_knorky__create_task
mcp__plugin_knorky_knorky__start_timer
mcp__plugin_knorky_knorky__stop_timer
mcp__plugin_knorky_knorky__end_break
mcp__plugin_knorky_knorky__record_agent_work
```

## What the plugin does on your computer

**Programs it runs.** Only `git`, in the session's folder, to read:

- `git remote get-url origin`, once per session: the key under which it
  remembers this repository's project. The address also lets a GitHub issue
  number in the branch name find its task.
- `git branch --show-current`, when the session starts and whenever Claude's
  rules are written: to find an issue in the branch name.
- `git log --no-merges --format=%ct%x09%s -n 200`, when the plugin stops a
  timer: the commits' times and titles. Those made since the timer started go
  in the entry's note.

These three commands are fixed. It runs no other program and no shell, and it
fetches and runs no code: nothing the server answers ever becomes a command.
The server's answers are shown on the line and in `/track`. The titles of the
running tasks and of this session's task, and the project's name and id, also
go into the rules Claude reads (see `prompt.compose` below).

**Tools it runs itself.** `$.mcp.call` calls these tools of the Knorky MCP
server, and no other server's. The band and `/track` read
`get_running_timers`, `get_time_totals`, `list_tasks` and `list_projects`. The
band's buttons and `/track` use `create_task`, `start_timer`, `stop_timer` and
`end_break`, when you press or type them. At the end of a session, `stop_timer`
ends the timers that session started. After each turn, `record_agent_work` sends Claude's
own work. It also lists Claude Code's tools (`$.tool.list`), only to find the
server by its tool names.

**What it sends, and where.** Everything goes to the Knorky MCP server at
`https://api.knorky.com/mcp`, over the connection you signed in to, and to
nowhere else. Knorky's [privacy policy](https://knorky.com/privacy/) covers it.

- Task titles, task and project ids, and timer starts and stops.
- Timer notes: the commit titles above, or the note Claude writes when you say
  the work is done.
- Your time zone and today's date, to ask for today's total.
- Per day and task, Claude's own work: turn time, turn count, token counts, the
  main model's name, a session id and the agent's name, `claude-code`.

The way out is `$.mcp.call`, which calls a tool on the MCP server over Claude
Code's own connection to it. Though its hooks run during your conversation, the
plugin reads from it only each turn's length and each model request's token
counts and model name. It sends no prompts, answers, code or file contents.
Claude itself may call the server's other tools during your work, under your
permission rules.

**What its hooks do.**

| Hook             | What it decides or changes                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prompt.compose` | Adds one section to Claude's system prompt: the tracking rules, this repository's project, the branch, this session's task and what runs. They tell Claude to find or create a task and start its timer without asking first. Nothing else in the prompt changes.                                                                                                                                      |
| `tool.call`      | Sees every tool call by name and passes each one on unchanged, with two exceptions: it refuses Claude's own calls of `record_agent_work`, and it answers `remember_project` itself. After a call to the Knorky server that changes a timer it reads the running timers again, so the band follows. After `start_timer` it notes that task as this session's. It reads no other tool's input or result. |
| `tool.describe`  | Marks `record_agent_work` as deferred, so Claude does not see it among its usual tools. No other tool changes.                                                                                                                                                                                                                                                                                         |
| `ui.render`      | Draws the line above the prompt once the server is connected. Otherwise it leaves that place as it was.                                                                                                                                                                                                                                                                                                |
| `turn.step`      | Reads each model request's token counts and passes the result on unchanged.                                                                                                                                                                                                                                                                                                                            |
| `turn.complete`  | Saves and sends Claude's own work and reads the running timers again.                                                                                                                                                                                                                                                                                                                                  |
| `session.start`  | Runs the two `git` reads above, registers `/track` and `remember_project`, and starts the plugin's clocks.                                                                                                                                                                                                                                                                                             |
| `session.end`    | Stops every timer this session started, unless another window tracks the same task. On `/clear` and `/resume` it stops none.                                                                                                                                                                                                                                                                           |

The plugin has no hook on permission checks: your own rules and permission
mode decide on every tool call.

**Tools it stands in for.** One: `remember_project`, the tool the plugin itself
adds. Whenever Claude calls it, after you have named a repository's project,
the plugin answers in the tool's place by saving the project on your computer;
Claude Code asks plugins to serve their own tools this way. Whenever Claude
itself calls the server's `record_agent_work`, the plugin answers with a refusal,
as that report is the plugin's to send. It stands in for no other tool, and every
other call gets what the tool itself returned.

**Files it writes.** One file per session,
`plugin-sessions/knorky/<session id>.json` in Claude Code's configuration
folder (`~/.claude`, or `CLAUDE_CONFIG_DIR`), holding the ids of the tasks the
session tracks. It reads that folder's other files to see whether another
window tracks the same task. It edits no build, start-up, settings or
instructions file. Its other data is in Claude Code's plugin storage.

## What it stores

On your computer, in Claude Code's plugin storage: the project chosen for
each repository (keyed by the repository's `origin` address); and each session's agent work per day and task (time,
turns, token counts and the models' names, never what was said), kept for
a week so a report that could not be sent goes later. In `~/.claude/plugin-sessions/knorky/`, one
small file per session naming the tasks it tracks, so two windows on one
task know of each other. Everything else stays on the server, which the
plugin reaches only through the server's own tools.

## Update or remove

```sh
claude plugin update knorky@knorky     # the latest version, from the next session
claude plugin uninstall knorky@knorky  # removes it
```

At the prompt, `/plugin` does the same from a menu. Removing the plugin
leaves your tasks and time on the server.

## Your own server

The plugin connects to the hosted server, `https://api.knorky.com/mcp`. For
your own server, add it to Claude Code yourself, with the Client ID from
Knorky's settings (Account → AI & API → Connect AI assistants):

```sh
claude mcp add --transport http --client-id <Client ID> --callback-port 33418 time <MCP address>
```

Then turn off `plugin:knorky:knorky` in `/mcp`. The plugin finds a server by its tools,
whatever its name.

## Developing

```sh
claude --plugin-dir claude-plugin   # a session with this folder's plugin
claude plugin validate claude-plugin
claude plugin test claude-plugin
```

Imports always name the file's extension: `./helpers.ts`, never `./helpers`.

The hooks are in `hooks/register.tsx`, with everything that calls Claude Code;
plain functions are in `hooks/helpers.ts`. The state they keep is in
`types/index.d.ts`, the tests in `tests/`. Once a session has loaded the
plugin, `tsc -p claude-plugin` type-checks it.
