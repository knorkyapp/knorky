# Knorky for Claude Code

A plugin for [Claude Code](https://claude.com/claude-code) that tracks the
time you work with Claude in [Knorky](https://knorky.com), a time tracker for
freelancers. It connects Claude Code to your Knorky account and teaches
Claude to track your work there. For help, use the
[support form](https://knorky.com/en/support/?topic=plugin) or write to
[support@knorky.com](mailto:support@knorky.com).

- **Claude tracks by itself.** When you start a piece of work, Claude finds
  the task or creates it, starts its timer and tells you in one line. It does
  not ask first. An issue in the branch name finds the task linked to it: a
  key like `ENG-123`, or a GitHub issue number (`feat/102-…`, `gh-102`),
  which Claude looks up with the repository's `origin` address.
- **One project per repository.** Claude asks once which Knorky project the
  repository's work goes to. If Claude keeps a memory for the repository, it
  saves the answer there, so later sessions do not ask.
- **Several timers at once.** By default a new task joins the timers already
  running, and Knorky splits the time between them. Say "only this" or
  "instead" to stop the others.
- **To-dos, without a timer.** `/todo <title>` adds a task you tick off,
  which holds no time.

Knorky also publishes a fuller version of this plugin in its own
marketplace. Install one of the two, not both.

## What you need

- Claude Code, in a terminal, an editor or the Claude desktop app.
- A Knorky account whose plan includes the API. On the hosted service that
  is the Plus plan.

## Install

At the prompt of Claude Code, run `/plugin`, open **Discover**, search for
**Knorky** and install it. In the Claude desktop app: click **+** next to the
prompt box, then **Plugins**, and add Knorky. Start a new session afterwards:
a plugin loads when a session starts.

## Sign in

The plugin brings its own connection to the Knorky server. Sign in once:

1. Run `/mcp`.
2. Choose `plugin:knorky:knorky`, then **Authenticate**.
3. Your browser opens Knorky's sign-in. Sign in and allow the access.

If you also added Knorky as a connector on claude.ai, `/mcp` lists it too, as
`claude.ai Knorky`. Turn that one off for Claude Code, or Claude sees every
tool twice.

## Commands

| Command                 | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `/track`                | What runs, today's total, and this repository's project         |
| `/track <task>`         | Tracks only this task: the other timers stop                    |
| `/track add <task>`     | Tracks this task too: the time is split with the running ones   |
| `/track stop`           | Stops this session's task                                       |
| `/track project <name>` | The project this repository's time goes to                      |
| `/todo <title>`         | Adds a to-do (a task without time) to this repository's project |
| `/todo`                 | The open to-dos of this repository's project                    |

You can also just ask Claude: "track this in parallel", "track only this",
"stop the timer", "add a to-do: send the invoice".

## Timers and the end of a session

This plugin runs no code on your computer, so it cannot see a session end.
When you say you are done or leaving, Claude stops the timers it started. If
you close the window without saying so, the timer keeps running: stop it in
the Knorky app, or with `/track stop` in your next session.

## What the plugin contains, and what it sends

The plugin is only text: one skill (`skills/time-tracking/SKILL.md`, the
tracking rules Claude reads when it needs them), two commands
(`commands/track.md`, `commands/todo.md`), an icon, and one MCP server
entry (`.mcp.json`). It has no hooks and runs no programs.

The MCP server entry connects Claude Code to `https://api.knorky.com/mcp`,
Knorky's server, after you sign in. Claude calls its tools under your
Claude Code permission rules, as with any MCP server. What reaches the
server is whatever those calls carry: task and to-do titles, search words,
project, task and time-entry ids, timer starts and stops, break and timer
notes Claude writes, dates and your time zone, and issue keys Claude reads
from your git branch (with the `owner/repo` part of the `origin` address
for a GitHub issue). Nothing goes anywhere else. Knorky's
[privacy policy](https://knorky.com/privacy/) covers it. The plugin stores
nothing on your computer; Claude may save the repository's project in its
own memory, as the skill asks.

## Your own server

The plugin connects to the hosted server. For your own server, add it to
Claude Code yourself with the Client ID from Knorky's settings (Account → AI
assistants), then turn off `plugin:knorky:knorky` in `/mcp`:

```sh
claude mcp add --transport http --client-id <Client ID> --callback-port 33418 knorky <MCP address>
```

## License

AGPL-3.0-or-later. See [LICENSE](https://github.com/knorkyapp/knorky/blob/main/LICENSE).
