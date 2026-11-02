import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Project, SessionTask } from '../types'
import { call } from './server'

// Claude's own work: the time its turns took and the tokens they cost. It is
// never the person's working time; the server keeps it apart.
const project = atom({ plugin: 'knorky', key: 'project' } as const, null as Project | null)
const sessionTask = atom(
  { plugin: 'knorky', key: 'sessionTask' } as const,
  null as SessionTask | null,
)

const AGENT = 'claude-code'
/** The most work_ms the server takes in one row: a whole day. */
const WORK_MS_MAX = 24 * 60 * 60 * 1000
const KEEP_MS = 7 * 24 * 60 * 60 * 1000
/** `work:{session}:{day}:{task|-}`: a row; its day is the match. */
const ROW_KEY = /^work:.+:(\d{4}-\d{2}-\d{2}):[^:]+$/
/** `work:{session}:unsent`: the rows a session has still to send. */
const UNSENT_KEY = /^work:[^:]+:unsent$/
/** How long a turn's end waits for the server to take the rows. */
const SEND_WAIT_MS = 3000

type Api = EngineInterface

/** A step's cost, as the API reports it. */
export type StepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** Tokens counted so far, and the output tokens of each model that wrote them. */
type Tokens = {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  models: Record<string, number>
}

/** One day's work on one task (or none) in this session: totals so far. */
type Row = Tokens & {
  day: string
  task_id: string | null
  project_id: string | null
  started_at: string
  last_at: string
  work_ms: number
  turns: number
}

const NO_TOKENS: Tokens = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  models: {},
}

// The store is read and written one change at a time: steps of parallel
// sub-agents would otherwise count over each other.
let queue: Promise<unknown> = Promise.resolve()

function serially<T>(work: () => Promise<T>): Promise<T> {
  const done = queue.then(work)
  queue = done.catch(() => undefined)
  return done
}

/** The user's local date of a time, as YYYY-MM-DD. */
function localDay(ms: number) {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

function addTokens(a: Tokens, b: Tokens): Tokens {
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

async function keys($: Api) {
  const base = `work:${await $.session.id()}`
  return { pending: `${base}:pending`, unsent: `${base}:unsent`, row: base }
}

/**
 * A step's tokens, any loop's (sub-agents' too). They wait until the main
 * loop's turn ends, which puts them on the day and task it ends on.
 */
export async function addStep($: Api, model: string, usage: StepUsage) {
  await serially(async () => {
    const { pending } = await keys($)
    const before = ((await $.store.get(pending)) as Tokens | undefined) ?? NO_TOKENS
    const step: Tokens = {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_input_tokens,
      cache_write_tokens: usage.cache_creation_input_tokens,
      models: { [model]: usage.output_tokens },
    }
    await $.store.set(pending, addTokens(before, step))
  })
}

/** The row's totals as `record_agent_work` takes them. */
function report(sessionId: string, row: Row) {
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

/** Adds the turn and the waiting tokens to the row of its day and task. */
async function closeTurn($: Api, durationMs: number) {
  const k = await keys($)
  const end = await $.clock.now()
  const day = localDay(end)
  const task = await read($, sessionTask)
  const taskId = task?.id ?? null
  const projectId = taskId ? null : ((await read($, project))?.id ?? null)
  const key = `${k.row}:${day}:${taskId ?? '-'}`

  const before = (await $.store.get(key)) as Row | undefined
  const tokens = addTokens(
    before ?? NO_TOKENS,
    ((await $.store.get(k.pending)) as Tokens | undefined) ?? NO_TOKENS,
  )
  const row: Row = {
    ...tokens,
    day,
    task_id: taskId,
    project_id: projectId,
    started_at: before?.started_at ?? new Date(end - durationMs).toISOString(),
    last_at: new Date(end).toISOString(),
    work_ms: Math.min(WORK_MS_MAX, (before?.work_ms ?? 0) + durationMs),
    turns: (before?.turns ?? 0) + 1,
  }
  await $.store.set(key, row)
  await $.store.delete(k.pending)
  const unsent = ((await $.store.get(k.unsent)) as string[] | undefined) ?? []
  if (!unsent.includes(key)) await $.store.set(k.unsent, [...unsent, key])
  return k.unsent
}

/**
 * Sends each row of one list not yet sent, outside the store's queue: a
 * slow server holds no step. The rows hold totals, so sends that cross or
 * arrive late lose nothing; one that fails, or that `open` no longer
 * allows, waits for the next turn's send.
 */
async function sendRows($: Api, unsentKey: string, open: () => boolean) {
  // the session that counted the rows, which may have ended since
  const sessionId = unsentKey.split(':')[1] ?? ''
  const toSend = ((await $.store.get(unsentKey)) as string[] | undefined) ?? []
  const sent = new Map<string, number>()
  for (const key of toSend) {
    // past the turn's hook the call would be refused: the rest waits
    if (!open()) break
    const row = (await $.store.get(key)) as Row | undefined
    if (!row) continue
    try {
      await call($, 'record_agent_work', report(sessionId, row))
      sent.set(key, row.turns)
    } catch (err) {
      $.ui.log(`knorky: agent work not sent yet: ${(err as Error).message}`, { to: 'debug' })
    }
  }
  await serially(async () => {
    // a row a turn changed while it was on its way is sent again
    const listed = ((await $.store.get(unsentKey)) as string[] | undefined) ?? []
    const left: string[] = []
    for (const key of listed) {
      const row = (await $.store.get(key)) as Row | undefined
      if (row && sent.get(key) !== row.turns) left.push(key)
    }
    if (left.length) await $.store.set(unsentKey, left)
    else await $.store.delete(unsentKey)
    await prune($)
  })
}

/**
 * Drops the rows of every session over a week old: a send is retried only
 * by its own session, and the store holds 4 MiB in all.
 */
async function prune($: Api) {
  const oldest = localDay((await $.clock.now()) - KEEP_MS)
  for (const key of await $.store.keys()) {
    const day = ROW_KEY.exec(key)?.[1]
    if (day && day < oldest) await $.store.delete(key)
  }
}

/**
 * The end of a main-loop turn: its time, one turn and the tokens counted
 * since go to the row of the day it ends on (in the store, at once), and
 * the rows not yet sent go to the server: this session's, and those an
 * earlier session could not send before it ended.
 *
 * The send runs inside the turn's hook: only there does Claude Code let
 * the plugin's own call through its permission check. A slow server holds
 * the hook at most SEND_WAIT_MS; what is not sent by then goes next turn.
 */
export async function endTurn($: Api, durationMs: number) {
  await serially(() => closeTurn($, durationMs))
  const lists = (await $.store.keys()).filter((key) => UNSENT_KEY.test(key))
  let open = true
  const sending = (async () => {
    for (const list of lists) {
      if (!open) break
      await sendRows($, list, () => open)
    }
  })().catch((err: Error) =>
    $.ui.log(`knorky: agent work not sent: ${err.message}`, { to: 'debug' }),
  )
  let waited!: () => void
  const timeout = new Promise<void>((resolve) => (waited = resolve))
  const timer = $.clock.after(SEND_WAIT_MS, waited)
  await Promise.race([sending, timeout])
  open = false
  timer.cancel()
}
