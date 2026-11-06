import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { DayTotal, Project, Running, SessionTask } from '../types/index.d.ts'
import {
  NO_TOKENS,
  addTokens,
  branchIssue,
  gitOutput,
  hm,
  localDay,
  noteFromLog,
  report,
  rulesText,
  todayMs,
  unlessFailed,
} from './helpers.ts'
import type { BranchIssue, Row, StepUsage, Tokens } from './helpers.ts'

// Values the band draws from; the server's answers are the truth, these only
// mirror them for the session.
const breakHm = atom({ plugin: 'knorky', key: 'breakHm' } as const, null as string | null)
const dayTotal = atom({ plugin: 'knorky', key: 'dayTotal' } as const, null as DayTotal | null)
const error = atom({ plugin: 'knorky', key: 'error' } as const, null as string | null)
const nowMs = atom({ plugin: 'knorky', key: 'nowMs' } as const, 0)
const onBreak = atom({ plugin: 'knorky', key: 'onBreak' } as const, false)
const project = atom({ plugin: 'knorky', key: 'project' } as const, null as Project | null)
const refreshedAt = atom({ plugin: 'knorky', key: 'refreshedAt' } as const, 0)
const running = atom({ plugin: 'knorky', key: 'running' } as const, [] as Running[])
const server = atom({ plugin: 'knorky', key: 'server' } as const, null as string | null)
const startedTasks = atom({ plugin: 'knorky', key: 'startedTasks' } as const, [] as string[])
const unread = atom({ plugin: 'knorky', key: 'unread' } as const, false)
const sessionTask = atom(
  { plugin: 'knorky', key: 'sessionTask' } as const,
  null as SessionTask | null,
)

// The server is recognised by its tools, whatever name it was added under.
const NEEDED = ['start_timer', 'stop_timer', 'get_running_timers', 'create_task']
const REFRESH_MS = 60 * 1000
// The plugin reports Claude's work itself; the model never calls this one.
const PLUGIN_ONLY = /^mcp__.+__record_agent_work$/
const PLUGIN_ONLY_SAYS = 'This tool is for the plugin only.'
// The user's default for the timers Claude starts. A new key: what the
// setting removed in 0.3.6 stored under "mode" does not come back by itself.
const DEFAULT_MODE = 'default-mode'
/** Where the person sees their time. */
const APP_URL = 'https://app.knorky.com'

// Claude's own work: the time its turns took and the tokens they cost. It is
// never the person's working time; the server keeps it apart.
/** The most work_ms the server takes in one row: a whole day. */
const WORK_MS_MAX = 24 * 60 * 60 * 1000
const KEEP_MS = 7 * 24 * 60 * 60 * 1000
/** `work:{session}:{day}:{task|-}`: a row; its day is the match. */
const ROW_KEY = /^work:.+:(\d{4}-\d{2}-\d{2}):[^:]+$/
/** `work:{session}:unsent`: the rows a session has still to send. */
const UNSENT_KEY = /^work:[^:]+:unsent$/
/** How long a turn's end waits for the server to take the rows. */
const SEND_WAIT_MS = 3000

// Each Claude Code session writes which task it tracks to a file of its own,
// and rewrites it every minute. A session that ends stops its task only when
// no other session's file names that task: two windows on the same task share
// one timer.
const FRESH_MS = 3 * 60 * 1000

type Api = EngineInterface
type Cancel = { cancel: () => void } | null

let tick: Cancel = null
let seconds: Cancel = null
let repoKey = ''
let remote = ''
let branch = ''
let issue: BranchIssue | null = null
let folder = ''
let mine = ''

// The store is read and written one change at a time: steps of parallel
// sub-agents would otherwise count over each other.
let queue: Promise<unknown> = Promise.resolve()

function serially<T>(work: () => Promise<T>): Promise<T> {
  const done = queue.then(work)
  queue = done.catch(() => undefined)
  return done
}

async function initSessions($: Api) {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const base = config ?? (home ? `${home}/.claude` : null)
  if (!base) return
  folder = `${base.replace(/\\/g, '/')}/plugin-sessions/knorky`
  mine = `${await $.session.id()}.json`
}

/** Writes which tasks this session tracks now. */
async function writeClaim($: Api, taskIds: string[]) {
  if (!folder) return
  try {
    // `task_id`: what a window on a version before 0.4.5 reads
    const claimed = { task_id: taskIds.at(-1) ?? null, task_ids: taskIds }
    await $.fs.write(`${folder}/${mine}`, JSON.stringify(claimed))
  } catch {
    // without the file the session counts as alone: it stops its own timers
  }
}

/** The timers that run on tasks this session started. */
async function ownTimers($: Api) {
  const started = await read($, startedTasks)
  return (await read($, running)).filter((r) => started.includes(r.task_id))
}

async function claim($: Api) {
  await writeClaim(
    $,
    (await ownTimers($)).map((r) => r.task_id),
  )
}

/** Notes that this session started the task's timer: it ends with the session. */
async function rememberStarted($: Api, taskId: string) {
  await update($, startedTasks, (ids) => (ids.includes(taskId) ? ids : [...ids, taskId]))
}

/** Whether another session tracks the task, by a file written lately. */
async function sharedWithOthers($: Api, taskId: string): Promise<boolean> {
  if (!folder) return false
  try {
    const now = await $.clock.now()
    for (const f of await $.fs.list(folder)) {
      if (f.name === mine || f.kind !== 'file' || now - f.mtimeMs > FRESH_MS) continue
      const claimed = JSON.parse(await $.fs.read(`${folder}/${f.name}`)) as {
        task_id?: unknown
        task_ids?: unknown[]
      }
      if ((claimed.task_ids ?? [claimed.task_id]).includes(taskId)) return true
    }
  } catch {
    // no folder yet, or a file being written: as if alone
  }
  return false
}

/** What was committed since the entry started, as its note; null for nothing. */
async function commitNote($: Api, since: string): Promise<string | null> {
  const ran = await unlessFailed(
    $.process.run(['git', 'log', '--no-merges', '--format=%ct%x09%s', '-n', '200']),
  )
  return noteFromLog(gitOutput(ran), since)
}

/** The branch the session is on now, and the issue it names. */
async function readBranch($: Api) {
  const ran = await unlessFailed($.process.run(['git', 'branch', '--show-current']))
  branch = gitOutput(ran)
  issue = branchIssue(branch, remote)
}

/** Calls one of the server's tools; its JSON answer, or an Error. */
async function call($: Api, tool: string, args?: Record<string, unknown>) {
  const name = await read($, server)
  if (!name) throw new Error('no time-tracking server is connected')
  const result = await $.mcp.call(name, tool, args)
  const text = result.content.map((b) => ('text' in b ? b.text : '')).join('')
  if (result.isError) throw new Error(text || `${tool} failed`)
  return text ? (JSON.parse(text) as unknown) : null
}

/**
 * Σ of a task, as the app's player shows it: everything tracked on it, in
 * seconds; null when the server does not find it.
 */
async function taskSeconds($: Api, task: { id: string; title: string }) {
  const found = (await call($, 'list_tasks', { search: task.title, status: 'all' })) as {
    id: string
    tracked_minutes: number
    tracked_seconds?: number
  }[]
  const hit = found.find((t) => t.id === task.id)
  // a server from before `tracked_seconds` counts in whole minutes
  return hit ? (hit.tracked_seconds ?? hit.tracked_minutes * 60) : null
}

/**
 * Everything tracked on `day` (this computer's), on all tasks, running
 * timers included: what the app's today total shows. Null without a time
 * zone to ask in.
 */
async function daySeconds($: Api, day: string) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!timezone) return null
  const totals = (await call($, 'get_time_totals', {
    from_date: day,
    to_date: day,
    timezone,
    group_by: 'day',
  })) as { total_minutes: number }
  return totals.total_minutes * 60
}

async function refresh($: Api) {
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
    await update($, unread, () => false)
    const day = localDay(at)
    const total = await daySeconds($, day)
    await update($, dayTotal, () => (total === null ? null : { day, seconds: total }))
  } catch (e) {
    await update($, error, () => String((e as Error).message ?? e))
  }
}

/**
 * Starts the task's timer. `split`: it joins the timers already running and
 * the time is shared between them; otherwise they stop.
 */
async function startTask($: Api, task: SessionTask, split: boolean) {
  const result = (await call($, 'start_timer', {
    task_id: task.id,
    mode: split ? 'split' : 'only',
    // what a server from before `mode` reads
    keep_others_running: split,
  })) as { stopped?: { task: string }[] }
  await update($, sessionTask, () => task)
  await rememberStarted($, task.id)
  await refresh($)
  await claim($)
  if (split) return `Tracking, split with the others: ${task.title}`
  const stopped = (result?.stopped ?? []).map((s) => s.task)
  return stopped.length
    ? `Tracking: ${task.title} (stopped: ${stopped.join(', ')})`
    : `Tracking: ${task.title}`
}

/** The open task of that title in the project, or a new one. */
async function findOrCreate($: Api, p: Project, title: string): Promise<SessionTask> {
  const tasks = (await call($, 'list_tasks', { project_id: p.id, search: title })) as SessionTask[]
  const same = tasks.find((t) => t.title.toLowerCase() === title.toLowerCase())
  if (same) return { id: same.id, title: same.title }
  const made = (await call($, 'create_task', { project_id: p.id, title })) as {
    task: SessionTask
  }
  return { id: made.task.id, title: made.task.title }
}

/** Stops the timer, with what was committed meanwhile as its note. */
async function stopEntry($: Api, entry: Running) {
  const note = await commitNote($, entry.started_at)
  await call($, 'stop_timer', { task_id: entry.task_id, ...(note ? { note } : {}) })
}

/** Stops this session's task if it runs; what it said, or null. */
async function stopSessionTask($: Api) {
  const task = await read($, sessionTask)
  const entry = task && (await read($, running)).find((r) => r.task_id === task.id)
  if (!task || !entry) return null
  await stopEntry($, entry)
  await refresh($)
  await claim($)
  return `Stopped: ${task.title}`
}

/** The session is over: its timers end, but for one another session tracks too. */
async function stopOwnTimers($: Api) {
  const stops = (await ownTimers($)).map(async (entry) => {
    if (!(await sharedWithOthers($, entry.task_id))) await stopEntry($, entry)
  })
  // one the server cannot stop keeps running, and any app can stop it
  await Promise.allSettled(stops)
}

/** Pauses the task: its timer stops, and it stays the session's task. */
async function pause($: Api, task: SessionTask) {
  await update($, sessionTask, () => task)
  await stopSessionTask($)
  return `Paused: ${task.title}`
}

async function endBreak($: Api) {
  await call($, 'end_break')
  await refresh($)
  return 'Break ended'
}

async function workKeys($: Api) {
  const base = `work:${await $.session.id()}`
  return { pending: `${base}:pending`, unsent: `${base}:unsent`, row: base }
}

/**
 * A step's tokens, any loop's (sub-agents' too). They wait until the main
 * loop's turn ends, which puts them on the day and task it ends on.
 */
async function addStep($: Api, model: string, usage: StepUsage) {
  await serially(async () => {
    const { pending } = await workKeys($)
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

/** Adds the turn and the waiting tokens to the row of its day and task. */
async function closeTurn($: Api, durationMs: number) {
  const k = await workKeys($)
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
 * The end of a main-loop turn: its time, one turn and the tokens counted
 * since go to the row of the day it ends on (in the store, at once), and
 * the rows not yet sent go to the server: this session's, and those an
 * earlier session could not send before it ended.
 *
 * The send runs inside the turn's hook: only there does Claude Code let
 * the plugin's own call through. A slow server holds the hook at most
 * SEND_WAIT_MS; what is not sent by then goes next turn.
 */
async function endTurn($: Api, durationMs: number) {
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

/** The task the band shows: this session's, else the first that runs. */
async function shownTask($: Api) {
  const first = (await read($, running))[0]
  return (await read($, sessionTask)) ?? (first ? { id: first.task_id, title: first.task } : null)
}

// A press acts in the plugin's `ui.press` hook (pressBand): from here,
// outside any hook, Claude Code would refuse the plugin's calls.
const pressed = () => undefined

/**
 * The app's player, in a line: ▶/⏸, the task and its project, and the time
 * worked today on all tasks, in hours and minutes as the app shows it. Pause
 * keeps the task shown, so the same button resumes it. While the task runs
 * next to others, ⏸ carries their count: the time is split with them.
 */
async function drawBand($: Api, e: RenderInput<'AbovePrompt'>) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const now = await read($, running)
  const problem = await read($, error)
  // in every state: what the server knows may have changed elsewhere
  const updateButton = <Button key="refresh" label="↻" onPress={pressed} />
  if (problem) {
    return (
      <Box>
        <Text dimColor>⏱ time tracking: {problem.slice(0, 80)} </Text>
        {updateButton}
      </Box>
    )
  }
  if (await read($, unread)) {
    return (
      <Box>
        <Text dimColor>⏱ connected · send a message or press </Text>
        {updateButton}
      </Box>
    )
  }
  if (await read($, onBreak)) {
    const breakTime = await read($, breakHm)
    return (
      <Box>
        <Button key="endBreak" label="▶" onPress={pressed} />
        <Text dimColor> on a break{breakTime ? ` · ${breakTime}` : ''} </Text>
        {updateButton}
      </Box>
    )
  }

  const task = await shownTask($)
  if (!task) {
    return (
      <Box>
        <Text dimColor>⏱ not tracking · /track &lt;task&gt; </Text>
        {updateButton}
      </Box>
    )
  }
  const entry = now.find((r) => r.task_id === task.id)
  const others = now.filter((r) => r.task_id !== task.id).length
  // until the second tick has run, the last check is the latest time known
  const askedAt = await read($, refreshedAt)
  const clock = Math.max(await read($, nowMs), askedAt)
  const today = await read($, dayTotal)
  // past midnight the day's total is yesterday's until the server is asked again
  const ms =
    today && today.day === localDay(clock)
      ? todayMs(today.seconds, now.length > 0, clock, askedAt)
      : null
  const projectName = entry?.project ?? (await read($, project))?.name ?? null

  return (
    <Box>
      {entry ? (
        <Button key="pause" label={others > 0 ? `⏸ +${others}` : '⏸'} onPress={pressed} />
      ) : (
        <Button key="start" label="▶" onPress={pressed} />
      )}
      {!entry && others > 0 ? <Button key="add" label="+" onPress={pressed} /> : null}
      <Text bold={entry !== undefined} dimColor={entry === undefined}>
        {' '}
        {task.title.slice(0, 50)}
      </Text>
      {projectName ? <Text dimColor> · {projectName}</Text> : null}
      {ms === null ? null : <Text dimColor> · today </Text>}
      {ms === null ? null : entry ? (
        <Text color="success" bold>
          {hm(ms)}
        </Text>
      ) : (
        <Text dimColor>{hm(ms)}</Text>
      )}
      {!entry && others > 0 ? <Text dimColor> · +{others} running</Text> : null}
      <Text> </Text>
      {updateButton}
    </Box>
  )
}

/** What a press of the band's button `element` does; what to say, or null. */
async function pressBand($: Api, element: string): Promise<string | null> {
  if (element === 'refresh') {
    await refresh($)
    // a problem shows on the line itself
    return (await read($, error)) ? null : 'Updated'
  }
  if (element === 'endBreak') return endBreak($)
  const task = await shownTask($)
  if (!task) return null
  if (element === 'pause') return pause($, task)
  if (element !== 'start' && element !== 'add') return null
  return startTask($, task, element === 'add')
}

/** Moves the clock on, while something runs and when a new day starts. */
async function countSecond($: Api) {
  const ms = await $.clock.now()
  const isNewDay = localDay(ms) !== localDay(await read($, nowMs))
  if (!isNewDay && (await read($, running)).length === 0) return
  await update($, nowMs, () => ms)
}

async function findServer($: Api) {
  const servers = new Map<string, Set<string>>()
  for (const t of await $.tool.list()) {
    const [, srv, tool] = /^mcp__(.+)__([a-z_]+)$/.exec(t.name) ?? []
    if (!srv || !tool) continue
    servers.set(srv, (servers.get(srv) ?? new Set<string>()).add(tool))
  }
  const found = [...servers].find(([, names]) => NEEDED.every((n) => names.has(n)))
  return found ? found[0] : null
}

/**
 * Every minute: this session's claim on its task, and the server, looked for
 * again until found: it can connect after the session started, or come back
 * after a reconnect. No call to the server: from a timer, Claude Code refuses
 * the plugin's calls. What runs is read in the hooks (turns, presses, /track).
 */
async function everyMinute($: Api) {
  if (!(await read($, server))) {
    const found = await findServer($)
    if (!found) return
    await update($, unread, () => true)
    await update($, server, () => found)
  }
  await claim($)
}

/**
 * The server's name, looking for it again while it is missing: Claude Code
 * connects its MCP servers after the session started, and may reconnect one.
 */
async function ensureServer($: Api) {
  const known = await read($, server)
  if (known) {
    if (await read($, unread)) await refresh($)
    return known
  }
  const found = await findServer($)
  if (!found) return null
  await update($, server, () => found)
  await refresh($)
  return found
}

async function rememberProject($: Api, p: Project) {
  await $.store.set(`project:${repoKey}`, p)
  await update($, project, () => p)
}

/** How Claude starts the timers it picks itself: the user's choice, split unless set. */
async function defaultMode($: Api): Promise<'split' | 'only'> {
  return (await $.store.get(DEFAULT_MODE)) === 'only' ? 'only' : 'split'
}

/** The rules Claude follows, with what it needs to know about this session. */
async function rules($: Api, name: string) {
  await readBranch($)
  return rulesText({
    name,
    project: await read($, project),
    task: await read($, sessionTask),
    running: await read($, running),
    only: (await defaultMode($)) === 'only',
    issue,
    branch,
  })
}

/** /track and its words; what to say. */
async function track($: Api, args: string): Promise<string> {
  if (args === '') {
    await refresh($)
    const now = await read($, running)
    const p = await read($, project)
    const lines: string[] = []
    for (const r of now) {
      // the task's total, as the app shows it: timers started together all ran equally long
      const total = await taskSeconds($, { id: r.task_id, title: r.task }).catch(() => null)
      const parts = [r.task, r.project, total === null ? null : `${hm(total * 1000)} in all`]
      lines.push(`Running: ${parts.filter(Boolean).join(' · ')}`)
    }
    if (now.length > 1) lines.push(`The time is split between the ${now.length} timers.`)
    if (!now.length) lines.push('Nothing is running.')
    const today = await daySeconds($, localDay(await $.clock.now())).catch(() => null)
    if (today !== null) lines.push(`Today: ${hm(today * 1000)} on all tasks`)
    lines.push(
      p
        ? `This repository's project: ${p.name}`
        : 'This repository has no project yet: /track project <name>',
    )
    lines.push(
      (await defaultMode($)) === 'only'
        ? 'Claude tracks only its task (the other timers stop): /track default split to change'
        : 'Claude adds its task to the running timers (split): /track default only to change',
    )
    lines.push(`Your time in Knorky: ${APP_URL}`)
    return lines.join('\n')
  }
  if (/^stop$/i.test(args)) {
    return (await stopSessionTask($)) ?? 'This session tracks nothing that runs.'
  }
  // a word alone is no task: as a title it would stop the other timers
  if (/^add$/i.test(args)) return '/track add <task>'
  if (/^project$/i.test(args)) return '/track project <name>'
  const chosen = /^default(?:\s+(\S+))?$/i.exec(args)
  if (chosen) {
    const value = chosen[1]?.toLowerCase()
    if (value !== 'split' && value !== 'only') return '/track default split | only'
    await $.store.set(DEFAULT_MODE, value)
    return value === 'only'
      ? 'Claude now tracks only its task; starting one stops the other timers.'
      : 'Claude now adds its task to the running timers; the time is split between them.'
  }
  // the words of the setting before 0.3.6: say what to use now
  if (/^(single|split)$/i.test(args)) {
    return '/track default split | only sets how Claude starts timers; /track <task> tracks only that task; /track add <task> adds it to the running ones.'
  }
  const wanted = /^project\s+(.+)$/i.exec(args)?.[1]
  if (wanted) {
    const all = (await call($, 'list_projects')) as Project[]
    const name = wanted.toLowerCase()
    const exact = all.filter((x) => x.name.toLowerCase() === name)
    const hit = exact.length ? exact : all.filter((x) => x.name.toLowerCase().includes(name))
    const [only] = hit
    if (hit.length !== 1 || !only) {
      return hit.length
        ? `Several match: ${hit.map((match) => match.name).join(', ')}`
        : `No project matches "${wanted}". Projects: ${all.map((a) => a.name).join(', ')}`
    }
    await rememberProject($, { id: only.id, name: only.name })
    return `This repository's time goes to ${only.name}.`
  }
  // a task by title; "add <title>" splits the time with the running ones
  const added = /^add\s+(.+)$/i.exec(args)?.[1]
  const p = await read($, project)
  if (!p) return 'Choose the project first: /track project <name>'
  const task = await findOrCreate($, p, added ?? args)
  return startTask($, task, added !== undefined)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const found = await findServer($)
    await update($, server, () => found)

    const origin = await unlessFailed($.process.run(['git', 'remote', 'get-url', 'origin']))
    remote = gitOutput(origin)
    repoKey = remote || (await $.session.root())
    await readBranch($)
    const saved = (await $.store.get(`project:${repoKey}`)) as Project | undefined
    await update($, project, () => saved ?? null)
    await initSessions($)

    await $.command.register({
      name: 'track',
      description:
        'Time tracking: /track (status), /track <task> (only this one), /track add <task> (split with the running ones), /track stop, /track default split | only (how Claude starts timers), /track project <name>',
    })
    await $.tool.register({
      name: 'remember_project',
      description:
        "Remembers which time-tracking project this repository's work belongs to, for this and later sessions. Call it after the user has named the project.",
      inputSchema: {
        type: 'object',
        properties: { project_id: { type: 'string' }, project_name: { type: 'string' } },
        required: ['project_id', 'project_name'],
      },
    })

    if (found) await refresh($)
    tick = $.clock.every(REFRESH_MS, () => void everyMinute($))
    seconds = $.clock.every(1000, () => void countSecond($))
    return started
  })

  on('session.end', async ($, e, next) => {
    // the conversation changes, Claude Code goes on, and so does the work:
    // no new session.start follows, so the clocks and the timers stay
    if (e.reason === 'clear' || e.reason === 'resume') return next(e)
    tick?.cancel()
    seconds?.cancel()
    await stopOwnTimers($)
    await writeClaim($, [])
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const done = await next(e)
    try {
      await endTurn($, e.durationMs)
    } catch (err) {
      $.ui.log(`knorky: agent work not counted: ${(err as Error).message}`, { to: 'debug' })
    }
    // what runs and the totals, read here: a hook's call goes through
    if (await read($, server)) await refresh($)
    return done
  })

  // The band's buttons act here, in a hook: from the button's own handler
  // Claude Code refuses the plugin's calls.
  on('ui.press', { plugin: 'knorky' }, async ($, e) => {
    const said = await pressBand($, e.element).catch((err: Error) => err.message)
    if (said) $.ui.toast(said)
    return { element: e.element }
  })

  // What each model request cost, sub-agents' too: Claude's work, never the
  // person's working time.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (result.usage) {
      try {
        await addStep($, result.usage.model, result.usage)
      } catch (err) {
        $.ui.log(`knorky: agent work not counted: ${(err as Error).message}`, { to: 'debug' })
      }
    }
    return result
  })

  on('tool.describe', async ($, e, next) => {
    const described = await next(e)
    return PLUGIN_ONLY.test(e.tool) ? { ...described, isDeferred: true } : described
  })

  // Claude starts and stops timers through the server's own tools: the band
  // follows, and a timer Claude starts becomes this session's task. Agent
  // work is the plugin's to report: Claude's own call of it is refused.
  on('tool.call', async ($, e, next) => {
    // the plugin's own report comes through here too, from endTurn
    if (PLUGIN_ONLY.test(e.tool) && next.origin.plugin !== 'knorky') {
      return { deny: PLUGIN_ONLY_SAYS }
    }
    const name = await read($, server)
    const prefix = name ? `mcp__${name}__` : null
    if (!prefix || !e.tool.startsWith(prefix)) return next(e)
    const ran = await next(e)
    const tool = e.tool.slice(prefix.length)
    if (ran.deny === undefined && !ran.isError && tool === 'start_timer') {
      const id = (e as unknown as { task_id: string }).task_id
      await refresh($)
      const title = (await read($, running)).find((r) => r.task_id === id)?.task ?? 'task'
      await update($, sessionTask, () => ({ id, title }))
      await rememberStarted($, id)
      await claim($)
    } else if (
      ['stop_timer', 'stop_all_timers', 'start_break', 'end_break', 'set_task_done'].includes(tool)
    ) {
      await refresh($)
    }
    return ran
  }).catch(($, e, next) =>
    // a failure refuses Claude the agent-work tool still; any other call goes on
    next.called || !PLUGIN_ONLY.test(e.tool) || next.origin.plugin === 'knorky'
      ? next(e)
      : { deny: PLUGIN_ONLY_SAYS },
  )

  on('tool.call', { tool: 'mcp__knorky__remember_project' }, async ($, e) => {
    const { project_id, project_name } = e as unknown as {
      project_id: string
      project_name: string
    }
    await rememberProject($, { id: project_id, name: project_name })
    return { result: `This repository's time now goes to ${project_name}.` }
  })

  on('command.run', { command: 'track' }, async ($, e) => {
    try {
      if (!(await ensureServer($))) {
        return {
          text: 'No time-tracking server is connected. Run /mcp, choose plugin:knorky:knorky and sign in.',
        }
      }
      return { text: await track($, e.args.trim()) }
    } catch (err) {
      return { text: `Time tracking: ${(err as Error).message}` }
    }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const name = await ensureServer($)
    if (!name) return composed
    const text = await rules($, name)
    return {
      sections: [...composed.sections, { id: 'knorky:rules', text, scope: 'session' as const }],
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, server))) return next(e)
    return drawBand($, e)
  })
}
