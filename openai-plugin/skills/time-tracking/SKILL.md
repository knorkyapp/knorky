---
name: time-tracking
description: Track and report the user's working time in Knorky. Use when the user asks to start, stop or switch a timer, to add or find a task or to-do, to correct or add a time entry, or how much time went into a client, project, task or day.
---

# Time tracking with Knorky

Knorky's tools work on the signed-in user's own time-tracking data: clients,
projects, tasks, timers and time entries. Ids come from the list tools.

## Finding the right task

1. When the user names a project or client, call `list_projects` (or
   `list_clients`) and pick the one whose name matches. If several match or
   none does, ask which one; never guess.
2. Call `list_tasks` with a `search` for the task's words, in that project.
   A task whose `task_type` is `"todo"` holds no time: never start a timer on
   it.
3. If no timed task fits and the user wants to track time, create one with
   `create_task` (`task_type` `"timed"`) and a short title. Say that you
   created it.

## Timers

- `start_timer` mode `"split"` (the default) keeps the other timers running,
  and Knorky splits the time between them. Use mode `"only"` when the user
  says "instead", "only this" or "stop the others". If it is unclear whether
  the other timers should stop, ask.
- After starting or stopping a timer, say in one line what runs now.
- When the user says what they did, pass it as the `note` of `stop_timer`.
- "What am I tracking?": `get_running_timers`.
- A break: `start_break`, and `end_break` when they are back. If the server
  refuses because breaks are off in the app, say so and offer to stop the
  timers instead.

## To-dos

A to-do is a task to tick off, without time: `create_task` with
`task_type` `"todo"`. Mark it done with `set_task_done`.

## Reports

- Totals: `get_time_totals` between two dates, in the user's IANA time zone,
  grouped by task, project, client or day. Show hours as h:mm.
- What happened on a day or in a week: `get_day_log`.
- Never invent clients, projects or numbers that the tools did not return.

## Changing or removing data

- Before `delete_task` or `delete_time_entry`, name exactly what will be
  removed and wait for the user's yes. Delete one item at a time, only the
  one the user asked for; never delete in bulk.
- To correct a time entry, use `update_time_entry` on that entry only.

## What the tools cannot do

- They reach only the signed-in user's account: never another person's time.
- They do not show, change or sell plans or payments. If a tool answers that
  a feature needs a paid plan, say so plainly and point to
  https://knorky.com for details.
- Never call `record_agent_work`: it is for coding agents' own reports, not
  for the user's time.
