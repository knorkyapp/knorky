import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Project, Running, SessionTask } from '../types'
import { addStep, endTurn } from './agentWork'
import { drawBand, hm } from './band'
import { armIdle, setWorking, stopIdle } from './idle'
import { branchIssue, git } from './git'
import type { BranchIssue } from './git'
import { call, findOrCreate, refresh, startTask, stopSessionTask, taskSeconds } from './server'
import { claim, initSessions } from './sessions'

// Values the band draws from; the server's answers are the truth, these only
// mirror them for the session. Each file names the ones it reads or writes.
const nowMs = atom({ plugin: 'knorky', key: 'nowMs' } as const, 0)
const project = atom({ plugin: 'knorky', key: 'project' } as const, null as Project | null)
const running = atom({ plugin: 'knorky', key: 'running' } as const, [] as Running[])
const server = atom({ plugin: 'knorky', key: 'server' } as const, null as string | null)
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
/** Where the person sees their time. */
const APP_URL = 'https://app.knorky.com'

type Api = EngineInterface
type Cancel = { cancel: () => void } | null

let tick: Cancel = null
let seconds: Cancel = null
let repoKey = ''
let branch = ''
let issue: BranchIssue | null = null

/** Moves the clock on, while something runs. */
async function countSecond($: Api) {
  if ((await read($, running)).length === 0) return
  const ms = await $.clock.now()
  await update($, nowMs, () => ms)
}

/**
 * Every minute: what runs, and this session's claim on its task. Until the
 * server is found, looks for it again: it can connect after the session
 * started, or come back after a reconnect.
 */
async function everyMinute($: Api) {
  if (!(await ensureServer($))) return
  await refresh($)
  const task = await read($, sessionTask)
  const isRunning = task && (await read($, running)).some((r) => r.task_id === task.id)
  await claim($, isRunning ? task.id : null)
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
 * The server's name, looking for it again while it is missing: Claude Code
 * connects its MCP servers after the session started, and may reconnect one.
 */
async function ensureServer($: Api) {
  const known = await read($, server)
  if (known) return known
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

/** The rules Claude follows, with what it needs to know about this session. */
async function rules($: Api, name: string) {
  const p = await read($, project)
  const task = await read($, sessionTask)
  const now = await read($, running)
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
    '  Then start_timer with keep_others_running: false (the user tracks one task at a time), and tell the user in one line: "Tracking: <task>" (and what it stopped, if anything). Do not ask first.',
    '  When the user asks to track a task "too", "in parallel" or "split", use keep_others_running: true for that one; "only this", "instead": false.',
    '- When the work moves to something clearly different, start the timer of that task the same way. When the user says the work is done, stop_timer with a one-line note of what was done.',
    p
      ? `- This repository's project: ${p.name} (project_id ${p.id}).`
      : '- This repository has no project yet. Before the first timer, ask the user once which project (list_projects shows them), then call remember_project.',
    `- Git branch: ${branch || 'unknown'}.`,
    `- This session tracks: ${task ? `${task.title} (task_id ${task.id})` : 'nothing yet'}.`,
    `- Running now: ${now.length ? now.map((r) => `${r.task} (${r.hm})`).join('; ') : 'nothing'}.`,
  ].join('\n')
}

/** /track and its words; what to say. */
async function track($: Api, args: string): Promise<string> {
  if (args === '') {
    await refresh($)
    const now = await read($, running)
    const p = await read($, project)
    const lines: string[] = []
    for (const r of now) {
      // Σ, as the app shows it: timers started together all ran equally long
      const seconds = await taskSeconds($, { id: r.task_id, title: r.task }).catch(() => null)
      const parts = [r.task, r.project, seconds === null ? null : `Σ ${hm(seconds * 1000)}`]
      lines.push(`Running: ${parts.filter(Boolean).join(' · ')}`)
    }
    if (now.length > 1) lines.push(`The time is split between the ${now.length} timers.`)
    if (!now.length) lines.push('Nothing is running.')
    lines.push(
      p
        ? `This repository's project: ${p.name}`
        : 'This repository has no project yet: /track project <name>',
    )
    lines.push(`Your time in Knorky: ${APP_URL}`)
    return lines.join('\n')
  }
  if (args === 'stop') {
    return (await stopSessionTask($, false)) ?? 'This session tracks nothing that runs.'
  }
  // the words of the setting before 0.3.6, which is gone: say what to do
  if (/^(single|split)$/i.test(args)) {
    return '/track <task> tracks only that task; /track add <task> adds it to the running ones.'
  }
  const wanted = /^project\s+(.+)$/i.exec(args)?.[1]
  if (wanted) {
    const all = (await call($, 'list_projects')) as Project[]
    const hit = all.filter((x) => x.name.toLowerCase().includes(wanted.toLowerCase()))
    const [only] = hit
    if (hit.length !== 1 || !only) {
      return hit.length
        ? `Several match: ${hit.map((h) => h.name).join(', ')}`
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
  const said = await startTask($, task, added !== undefined)
  armIdle($)
  return said
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const found = await findServer($)
    await update($, server, () => found)

    const remote = await git($, 'remote', 'get-url', 'origin')
    repoKey = remote || (await $.session.root())
    branch = await git($, 'branch', '--show-current')
    issue = branchIssue(branch, remote)
    const saved = (await $.store.get(`project:${repoKey}`)) as Project | undefined
    await update($, project, () => saved ?? null)
    await initSessions($)

    await $.command.register({
      name: 'track',
      description:
        'Time tracking: /track (status), /track <task> (only this one), /track add <task> (split with the running ones), /track stop, /track project <name>',
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
    stopIdle()
    tick?.cancel()
    seconds?.cancel()
    try {
      await stopSessionTask($, true)
    } catch {
      // the server cannot be reached: the timer keeps running, any app can stop it
    }
    await claim($, null)
    return next(e)
  })

  // While Claude works the person is not away: the idle clock waits for the
  // turn's end, however long the turn takes.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) setWorking($, true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    setWorking($, false)
    const done = await next(e)
    try {
      await endTurn($, e.durationMs)
    } catch (err) {
      $.ui.log(`knorky: agent work not counted: ${(err as Error).message}`, { to: 'debug' })
    }
    return done
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

  // The plugin's own calls (the band, the minute tick, the reports) answer
  // no request of the person's, so auto mode's classifier has nothing to
  // judge them by and refuses them. The plugin vouches for its own calls to
  // its own server; Claude's calls go on to the mode as before.
  on('tool.check', async ($, e, next) => {
    const name = await read($, server)
    if (next.origin.plugin === 'knorky' && name && e.tool.startsWith(`mcp__${name}__`)) {
      return { decision: 'allow' as const, reason: "The time-tracking plugin's own call." }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

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
      await claim($, id)
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
