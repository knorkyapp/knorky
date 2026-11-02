import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Project, Running, SessionTask, TaskTotal } from '../types'
import { commitNote } from './git'
import { claim, sharedWithOthers } from './sessions'

// Values the band draws from; the server's answers are the truth, these only
// mirror them for the session. Each file names the ones it reads or writes.
const breakHm = atom({ plugin: 'knorky', key: 'breakHm' } as const, null as string | null)
const error = atom({ plugin: 'knorky', key: 'error' } as const, null as string | null)
const onBreak = atom({ plugin: 'knorky', key: 'onBreak' } as const, false)
const refreshedAt = atom({ plugin: 'knorky', key: 'refreshedAt' } as const, 0)
const running = atom({ plugin: 'knorky', key: 'running' } as const, [] as Running[])
const server = atom({ plugin: 'knorky', key: 'server' } as const, null as string | null)
const sessionTask = atom(
  { plugin: 'knorky', key: 'sessionTask' } as const,
  null as SessionTask | null,
)
const taskTotal = atom({ plugin: 'knorky', key: 'taskTotal' } as const, null as TaskTotal | null)

type Api = EngineInterface

/** Calls one of the server's tools; its JSON answer, or an Error. */
export async function call($: Api, tool: string, args?: Record<string, unknown>) {
  const name = await read($, server)
  if (!name) throw new Error('no time-tracking server is connected')
  const result = await $.mcp.call(name, tool, args)
  const text = result.content.map((b) => ('text' in b ? b.text : '')).join('')
  if (result.isError) throw new Error(text || `${tool} failed`)
  return text ? (JSON.parse(text) as unknown) : null
}

export async function refresh($: Api) {
  try {
    const now = (await call($, 'get_running_timers')) as {
      break: { hm: string } | null
      running: Running[]
    }
    const at = await $.clock.now()
    await update($, running, () => now.running)
    await update($, refreshedAt, () => at)
    await update($, onBreak, () => now.break !== null)
    await update($, breakHm, () => now.break?.hm ?? null)
    await update($, error, () => null)
    // the task the band shows: this session's, else the first that runs
    const first = now.running[0]
    const task =
      (await read($, sessionTask)) ?? (first ? { id: first.task_id, title: first.task } : null)
    let sum: TaskTotal | null = null
    if (task) {
      // Σ, as the app's player shows it: everything tracked on the task
      const found = (await call($, 'list_tasks', { search: task.title, status: 'all' })) as {
        id: string
        tracked_minutes: number
        tracked_seconds?: number
      }[]
      const hit = found.find((t) => t.id === task.id)
      // a server from before `tracked_seconds` counts in whole minutes
      const seconds = hit ? (hit.tracked_seconds ?? hit.tracked_minutes * 60) : null
      if (seconds !== null) sum = { taskId: task.id, seconds }
    }
    await update($, taskTotal, () => sum)
  } catch (e) {
    await update($, error, () => String((e as Error).message ?? e))
  }
}

/**
 * Starts the task's timer. `split`: it joins the timers already running and
 * the time is shared between them; otherwise they stop.
 */
export async function startTask($: Api, task: SessionTask, split: boolean) {
  const result = (await call($, 'start_timer', {
    task_id: task.id,
    keep_others_running: split,
  })) as { stopped?: { task: string }[] }
  await update($, sessionTask, () => task)
  await claim($, task.id)
  await refresh($)
  if (split) return `Tracking, split with the others: ${task.title}`
  const stopped = (result?.stopped ?? []).map((s) => s.task)
  return stopped.length
    ? `Tracking: ${task.title} (stopped: ${stopped.join(', ')})`
    : `Tracking: ${task.title}`
}

/** The open task of that title in the project, or a new one. */
export async function findOrCreate($: Api, p: Project, title: string): Promise<SessionTask> {
  const tasks = (await call($, 'list_tasks', { project_id: p.id, search: title })) as SessionTask[]
  const same = tasks.find((t) => t.title.toLowerCase() === title.toLowerCase())
  if (same) return { id: same.id, title: same.title }
  const made = (await call($, 'create_task', { project_id: p.id, title })) as {
    task: SessionTask
  }
  return { id: made.task.id, title: made.task.title }
}

/**
 * Stops this session's task if it runs, with what was committed meanwhile as
 * its note; what it said, or null. `unlessShared`: not while another session
 * tracks the same task.
 */
export async function stopSessionTask($: Api, unlessShared: boolean) {
  const task = await read($, sessionTask)
  const entry = task && (await read($, running)).find((r) => r.task_id === task.id)
  if (!task || !entry) return null
  if (unlessShared && (await sharedWithOthers($, task.id))) return null
  const note = await commitNote($, entry.started_at)
  await call($, 'stop_timer', { task_id: task.id, ...(note ? { note } : {}) })
  await claim($, null)
  await refresh($)
  return `Stopped: ${task.title}`
}

/** Pauses the task: its timer stops, and it stays the session's task. */
export async function pause($: Api, task: SessionTask) {
  await update($, sessionTask, () => task)
  await stopSessionTask($, false)
  return `Paused: ${task.title}`
}

export async function endBreak($: Api) {
  await call($, 'end_break')
  await refresh($)
  return 'Break ended'
}
