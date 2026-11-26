---
description: 'Time tracking in Knorky: /track (status), /track <task> (only this one), /track add <task> (split with the running ones), /track stop, /track project <name>'
argument-hint: '[<task> | add <task> | stop | project <name>]'
---

Use the Knorky MCP server's tools for this time-tracking command. Its
arguments are: `$ARGUMENTS`

Follow the `time-tracking` skill for this repository's project. Then act on
the arguments:

- **Empty:** call `get_running_timers`, and `get_time_totals` for today in the
  user's time zone. Answer in a few lines: each running task with its
  project; that the time is split when several run; today's total in h:mm;
  this repository's project, or `No project yet: /track project <name>`;
  and the link https://app.knorky.com.
- **`stop`:** call `stop_timer` on the task this session tracks, with a
  one-line note of what was done. If this session tracks nothing that runs,
  say so.
- **`project <name>`:** call `list_projects`. Pick the project whose name is
  the same, or else the only one whose name contains the words. If several or
  none match, list them and stop. Use the project for this repository from
  now on, and save it in your memory for this repository if you keep one.
  Answer: `This repository's time goes to <project>.`
- **`add <task>`:** find the timed task by title in the project (`list_tasks`
  with `search` and `task_type` `"timed"`), or else call `create_task` with
  `task_type` `"timed"`. Then call `start_timer` with mode `"split"`. Answer:
  `Tracking, split: <task>`.
- **Anything else** is a task title. Find or create the task the same way,
  then call `start_timer` with mode `"only"`, so the other timers stop.
  Answer: `Tracking: <task>`, and name the timers it stopped.

If no Knorky tools are available, say: `Knorky is not connected. Run /mcp,
choose plugin:knorky:knorky and sign in.`
