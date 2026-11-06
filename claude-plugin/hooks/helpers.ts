// Plain functions that need nothing from Claude Code. Everything that does is
// in register.tsx: the plugin directory reads calls on `$` only where `$` is
// passed to a function of the same file.

import type { Project, Running, SessionTask } from '../types'

// A tracker's issue key in a branch name: feat/ENG-123-fix
const ISSUE_KEY = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/
// A GitHub issue number opening a part of a branch name: feat/102-fix, gh-102
const ISSUE_NUMBER = /(?:^|\/)(?:gh-|issue-|issues-)?(\d{1,7})(?=[-_]|$)/
const GITHUB_REPO = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/
// stop_timer takes a note of at most this many characters
const NOTE_MAX = 2000
const AGENT = 'claude-code'

/** The branch's issue: what list_tasks takes as `issue`, and a GitHub link. */
export type BranchIssue = { key: string; github: string | null }

/** A step's cost, as the API reports it. */
export type StepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** Tokens counted so far, and the output tokens of each model that wrote them. */
export type Tokens = {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  models: Record<string, number>
}

/** One day's work on one task (or none) in this session: totals so far. */
export type Row = Tokens & {
  day: string
  task_id: string | null
  project_id: string | null
  started_at: string
  last_at: string
  work_ms: number
  turns: number
}

export const NO_TOKENS: Tokens = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  models: {},
}

/** What a git command printed; nothing when it failed. */
export function gitOutput(ran: { exitCode: number; stdout: string }) {
  return ran.exitCode === 0 ? ran.stdout.trim() : ''
}

/** The issue the branch is for: a tracker's key, else a GitHub issue number. */
export function branchIssue(branch: string, remote: string): BranchIssue | null {
  const key = ISSUE_KEY.exec(branch)?.[1]
  if (key) return { key: key.toUpperCase(), github: null }
  const repo = GITHUB_REPO.exec(remote)?.[1]
  const number = ISSUE_NUMBER.exec(branch)?.[1]
  if (!repo || !number) return null
  const github = `${repo}#${Number(number)}`
  return { key: github, github }
}

/** A `git log` of commit titles, newest first, as a note; null for nothing. */
export function noteFromLog(log: string): string | null {
  const titles = log.split('\n').filter(Boolean).reverse()
  if (titles.length === 0) return null
  return `Commits: ${titles.join('; ')}`.slice(0, NOTE_MAX)
}

/** The user's local date of a time, as YYYY-MM-DD. */
export function localDay(ms: number) {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

export function addTokens(a: Tokens, b: Tokens): Tokens {
  const models = { ...a.models }
  for (const [m, n] of Object.entries(b.models)) models[m] = (models[m] ?? 0) + n
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
    models,
  }
}

/** The model that wrote the most in the row; '' before any wrote. */
function mainModel(models: Record<string, number>) {
  let best = ''
  let most = -1
  for (const [m, n] of Object.entries(models)) {
    if (n > most) [best, most] = [m, n]
  }
  return best
}

/** The row's totals as `record_agent_work` takes them. */
export function report(sessionId: string, row: Row) {
  const model = mainModel(row.models)
  return {
    agent: AGENT,
    session_id: sessionId,
    day: row.day,
    ...(row.task_id ? { task_id: row.task_id } : {}),
    ...(row.project_id ? { project_id: row.project_id } : {}),
    ...(model ? { model } : {}),
    started_at: row.started_at,
    last_at: row.last_at,
    work_ms: row.work_ms,
    turns: row.turns,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cache_read_tokens: row.cache_read_tokens,
    cache_write_tokens: row.cache_write_tokens,
  }
}

/**
 * Today's time, as the app counts it: the server's total when last asked,
 * plus the time since while any timer runs. Timers that run together share
 * the time, so together they add it once, not once each.
 */
export function todayMs(seconds: number, anyRuns: boolean, now: number, askedAt: number): number {
  const since = anyRuns && askedAt > 0 ? Math.max(0, now - askedAt) : 0
  return seconds * 1000 + since
}

/** h:mm, as the app shows a total. */
export function hm(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** The rules Claude follows, with what it needs to know about this session. */
export function rulesText(session: {
  name: string
  project: Project | null
  task: SessionTask | null
  running: Running[]
  only: boolean
  issue: BranchIssue | null
  branch: string
}) {
  const { name, project: p, task, running: now, only, issue, branch } = session
  const link = issue?.github
    ? `, linked to the issue (link: source "github", external_id "${issue.github}")`
    : issue
      ? ', linked to the issue'
      : ''
  return [
    '# Time tracking',
    `The user tracks working time with the MCP server "${name}". Track this session's work there, without being asked:`,
    '- When the user starts a piece of work (a change, a fix, an investigation — not a quick question) and this session tracks no task that fits it: find the task and start its timer.',
    `  Find it: ${issue ? `list_tasks with issue "${issue.key}" (the branch names it); else ` : ''}list_tasks with a search for the topic in the project below. None fits: create_task with a short title of what the work achieves${link}.`,
    only
      ? '  Then start_timer with mode "only" (the user\'s default: the other timers stop), and tell the user in one line: "Tracking: <task>" (and what it stopped, if anything). Do not ask first.'
      : '  Then start_timer with mode "split" (the user\'s default: the task joins the running timers and the time is shared between them), and tell the user in one line: "Tracking, split: <task>". Do not ask first.',
    '  When the user names a task: "too", "also", "add", "in parallel" and "split" mean mode "split"; "instead", "only this" and "stop the others" mean mode "only". Without such a word, use the default above. If the user\'s words leave it unclear whether the other timers should stop, ask the user first.',
    '- When the work moves to something clearly different, start the timer of that task the same way. When the user says the work is done, stop_timer with a one-line note of what was done.',
    p
      ? `- This repository's project: ${p.name} (project_id ${p.id}).`
      : '- This repository has no project yet. Before the first timer, ask the user once which project (list_projects shows them), then call remember_project.',
    `- Git branch: ${branch || 'unknown'}.`,
    `- This session tracks: ${task ? `${task.title} (task_id ${task.id})` : 'nothing yet'}.`,
    `- Running now: ${now.length ? now.map((r) => `${r.task} (${r.hm})`).join('; ') : 'nothing'}.`,
  ].join('\n')
}
