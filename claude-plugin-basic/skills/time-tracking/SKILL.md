---
name: time-tracking
description: Track the user's working time in Knorky while they work with Claude. Use when the user starts a piece of work (a change, a fix, an investigation, not a quick question), when the work moves to something clearly different, when they say the work is done or that they are leaving, when they ask for a to-do, or when they ask about their timers or tracked time.
---

# Time tracking with Knorky

The user tracks working time with the Knorky MCP server. Its tools include
`list_projects`, `list_tasks`, `create_task`, `start_timer`, `stop_timer` and
`get_running_timers`. Track this session's work there, without being asked.

## The project

Time goes to one Knorky project per repository (or per folder, outside git).

1. If you already know this repository's project, use it: the user named it
   in this session, or your memory for this repository holds it.
2. Otherwise, before the first timer, call `list_projects` and ask the user
   once which project this repository's work goes to. If you keep a memory
   for this repository, save the project's name and id there, so later
   sessions do not ask again.

## Starting work

When the user starts a piece of work and this session tracks no task that
fits it:

1. Find the task. If the git branch names an issue, call `list_tasks` with
   that `issue`: a Linear-style key such as `ENG-123` as it is; a GitHub
   issue number (as in `feat/102-…` or `gh-102`) as `owner/repo#102`, with
   `owner/repo` from `git remote get-url origin`. Otherwise call
   `list_tasks` with a `search` for the topic, in the project. Only a task
   whose `task_type` is `"timed"` fits: a to-do holds no time.
2. If none fits, call `create_task` in the project, with `task_type`
   `"timed"` and a short title of what the work achieves.
3. Call `start_timer` with mode `"split"`: the task joins the running timers
   and the time is shared between them. Tell the user in one line:
   `Tracking, split: <task>`. Do not ask first.

When the user names a task: "too", "also", "add", "in parallel" and "split"
mean mode `"split"`; "instead", "only this" and "stop the others" mean mode
`"only"`. Without such a word, use `"split"`. If the user's words leave it
unclear whether the other timers should stop, ask first.

## While working

- When the work moves to something clearly different, start that task's
  timer the same way.
- When the user says the work is done, call `stop_timer` on its task with a
  one-line note of what was done.
- When the user says they are leaving ("that's it for today", "I'm off"),
  stop the timers this session started, each with a one-line note. Timers
  the user started elsewhere keep running unless they say otherwise.
- When the user takes a break ("I'm off to lunch"), call `start_break`. If the
  server refuses it because breaks are off in the app, stop this session's
  timers instead.

## To-dos

When the user asks for a to-do (a task to tick off, without time), call
`create_task` in the project with `task_type` `"todo"`, and start no timer on
it: the server refuses time on a to-do. When the user says it is done, call
`set_task_done`.

## Never

- Never start a timer on a to-do.
- Never call `record_agent_work`: it belongs to the full Knorky plugin.
- Never delete a task or a time entry unless the user asks for that one.
