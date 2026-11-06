import { expect, mock, test } from 'claude-code/testing'

import { branchIssue } from '../hooks/helpers.ts'

const SERVER = 'claude_ai_Time'
const TOOLS = ['start_timer', 'stop_timer', 'get_running_timers', 'create_task', 'list_tasks']

const BAND = {
  plugin: 'knorky',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

type Call = { tool: string; args: Record<string, unknown> }
type Timer = {
  task_id: string
  task: string
  project: string | null
  hm: string
  seconds?: number
  started_at: string
  started_by: string
}
type On = Parameters<Parameters<typeof test>[1]>[1]

/** What the mod meets around it, beyond the server's timers. */
type World = {
  tools?: string[]
  branch?: string
  remote?: string
  /** What `git log` prints: commit time and title per line, newest first. */
  log?: string
  /** Fills with the commands the plugin runs. */
  commands?: string[][]
  /** The commands cannot start: no git on this machine. */
  noGit?: boolean
  /** The account's projects, when not Acme and Garden. */
  projects?: { id: string; name: string }[]
  /** Files by path: the other sessions' claims. */
  files?: Map<string, { text: string; mtimeMs: number }>
  onBreak?: boolean
  /** What each model request costs, in the order the steps come. */
  steps?: StepUsage[]
  /** Tools whose next call the server answers with an error, once each. */
  failOnce?: Set<string>
  /** Tools whose next call the server never answers, once each. */
  hangOnce?: Set<string>
  /** Tools whose next call the server answers once the test calls `release`. */
  holdOnce?: Set<string>
  release?: () => void
  /** Where the clock starts, when not at NOW. */
  now?: number
  /** The plugin's store, as earlier sessions left it. */
  store?: Map<string, unknown>
  /** Seconds tracked on "Fix the scoreboard" in all, when not 3:10. */
  scoreboardSeconds?: number
  /** Minutes tracked today on all tasks, when not 2:15. */
  todayMinutes?: number
}

type StepUsage = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const CLAIMS = '/home/me/.claude/plugin-sessions/knorky'
const NOW = Date.parse('2026-10-30T12:00:05Z')

/** The engine and the time-tracking server, as far as the mod reaches them. */
function engine(on: On, timers: Timer[], calls: Call[], world: World = {}) {
  const store = world.store ?? new Map<string, unknown>()
  const files = world.files ?? new Map<string, { text: string; mtimeMs: number }>()
  // waits are held until a test moves the clock
  const clock = mock.clock(on, { now: world.now ?? NOW })
  const now = () => clock.now()
  // the engine hands over paths as the system spells them: P:\home\me\…
  const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  on('tool.list', () => ({
    value: (world.tools ?? TOOLS).map((t) => ({
      name: `mcp__${SERVER}__${t}`,
      description: '',
      mcp: true,
    })),
  }))
  on('process.run', (_, e) => {
    world.commands?.push([...e.argv])
    if (world.noGit) throw new Error('git: not found')
    return {
      value: {
        exitCode: 0,
        stdout: e.argv.includes('remote')
          ? (world.remote ?? 'git@example.com:me/repo.git\n')
          : e.argv.includes('log')
            ? (world.log ?? '')
            : (world.branch ?? 'feat/ACME-1013-fix\n'),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('session.root', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'me' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.write', (_, e) => {
    files.set(plain(e.path), { text: e.text, mtimeMs: now() })
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const file = files.get(plain(e.path))
    if (!file) throw new Error(`no file ${e.path}`)
    return { value: file.text }
  })
  on('fs.list', (_, e) => ({
    value: [...files]
      .filter(([path]) => path.startsWith(`${plain(e.path)}/`))
      .map(([path, f]) => ({
        name: path.slice(plain(e.path).length + 1),
        kind: 'file' as const,
        size: f.text.length,
        mtimeMs: f.mtimeMs,
        isLink: false,
      })),
  }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__knorky__${e.name}` } }))
  on('mcp.call', (_, e) => {
    calls.push({ tool: e.tool, args: e.args })
    if (world.failOnce?.delete(e.tool)) {
      return { value: { content: [{ type: 'text', text: 'unreachable' }], isError: true } }
    }
    if (world.hangOnce?.delete(e.tool)) return new Promise<never>(() => undefined)
    if (world.holdOnce?.delete(e.tool)) {
      return new Promise((resolve) => {
        world.release = () =>
          resolve({ value: { content: [{ type: 'text', text: '{}' }], isError: false } })
      })
    }
    // the server's timers follow what the mod starts and stops
    if (e.tool === 'stop_timer') {
      const at = timers.findIndex((t) => t.task_id === e.args.task_id)
      if (at >= 0) timers.splice(at, 1)
    }
    if (e.tool === 'end_break') world.onBreak = false
    if (e.tool === 'start_timer') {
      const known = { t1: 'Fix the scoreboard' } as Record<string, string>
      timers.push({
        task_id: String(e.args.task_id),
        task: known[String(e.args.task_id)] ?? 'task',
        project: 'Acme',
        hm: '0:00',
        started_at: '2026-10-30T12:00:00Z',
        started_by: 'ai',
      })
    }
    const answer =
      e.tool === 'get_running_timers'
        ? { break: world.onBreak ? { hm: '0:12' } : null, running: timers }
        : e.tool === 'list_projects'
          ? (world.projects ?? [
              { id: 'p1', name: 'Acme' },
              { id: 'p2', name: 'Garden' },
            ])
          : e.tool === 'list_tasks'
            ? e.args.status === 'all'
              ? [
                  {
                    id: 't1',
                    title: 'Fix the scoreboard',
                    tracked_hm: '3:10',
                    tracked_minutes: 190,
                    tracked_seconds: world.scoreboardSeconds ?? 190 * 60,
                  },
                  {
                    id: 'new',
                    title: 'Fix the scoreboard',
                    tracked_hm: '1:05',
                    tracked_minutes: 65,
                    tracked_seconds: 65 * 60,
                  },
                ]
              : []
            : e.tool === 'create_task'
              ? { task: { id: 'new', title: e.args.title, project: 'Acme' } }
              : e.tool === 'get_time_totals'
                ? { total_minutes: world.todayMinutes ?? 135, total_hm: 'unused', groups: [] }
                : { stopped: [] }
    return { value: { content: [{ type: 'text', text: JSON.stringify(answer) }], isError: false } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  // the model's answer to each request, with what it cost
  on('turn.step', async function* (_, e) {
    yield* []
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: world.steps?.shift() ?? null,
    }
  })
  on('tool.describe', (_, e) => ({ description: e.description }))
  return clock
}

/** Waits until a button press has done its work: its button is drawn. */
async function drawn(
  ui: { find: (q: { type: 'Button'; key: string }) => Promise<unknown> },
  key: string,
) {
  for (let i = 0; i < 50; i++) {
    if (await ui.find({ type: 'Button', key })) return true
    await new Promise((r) => setTimeout(r, 5))
  }
  return false
}

const SCOREBOARD: Timer = {
  task_id: 't1',
  task: 'Fix the scoreboard',
  project: 'Acme',
  hm: '0:27',
  started_at: '2026-10-30T12:00:00Z',
  started_by: 'app',
}

test('the band shows the running task as the player does: pause, name, project', async ($, on) => {
  const calls: Call[] = []
  engine(on, [{ ...SCOREBOARD }], calls)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /Fix the scoreboard/ }))?.text).toContain(
    'Fix the scoreboard',
  )
  expect((await ui.find({ type: 'Text', text: /Acme/ }))?.text).toContain('Acme')
  expect((await ui.find({ type: 'Button', key: 'pause' }))?.text).toBe('⏸')
  expect(await ui.find({ type: 'Button', key: 'start' })).toBeUndefined()
  expect(calls.map((c) => c.tool)).toContain('get_running_timers')
  await ui.unmount()
})

test('pause keeps the task in the band, and play resumes it alone', async ($, on) => {
  const calls: Call[] = []
  engine(on, [{ ...SCOREBOARD }], calls)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'pause' })
  expect(await drawn(ui, 'start')).toBe(true)
  expect(calls.find((c) => c.tool === 'stop_timer')?.args.task_id).toBe('t1')
  expect((await ui.find({ type: 'Text', text: /Fix the scoreboard/ }))?.text).toContain(
    'Fix the scoreboard',
  )
  expect(await ui.find({ type: 'Button', key: 'start' })).toBeDefined()

  await ui.press({ key: 'start' })
  expect(await drawn(ui, 'pause')).toBe(true)
  const start = calls.find((c) => c.tool === 'start_timer')
  expect(start?.args).toEqual({ task_id: 't1', mode: 'only', keep_others_running: false })
  expect(await ui.find({ type: 'Button', key: 'pause' })).toBeDefined()
  await ui.unmount()
})

/** Waits until the band draws `text`. */
async function shows(
  ui: { find: (q: { type: 'Text'; text: string | RegExp }) => Promise<unknown> },
  text: string | RegExp,
) {
  for (let i = 0; i < 50; i++) {
    if (await ui.find({ type: 'Text', text })) return true
    await new Promise((r) => setTimeout(r, 5))
  }
  return false
}

test('the update button reads the day and the timers again, changed elsewhere', async ($, on) => {
  const toasts: string[] = []
  const timers = [{ ...SCOREBOARD }, { ...SCOREBOARD, task_id: 't2', task: 'Mow the lawn' }]
  const world: World = { todayMinutes: 135 }
  engine(on, timers, [], world)
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '2:15' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'pause' }))?.text).toBe('⏸ +1')

  // meanwhile, in the app: more time, and the other timer stopped
  world.todayMinutes = 190
  timers.splice(1, 1)
  await ui.press({ key: 'refresh' })

  expect(await shows(ui, '3:10')).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'pause' }))?.text).toBe('⏸')
  expect(toasts).toEqual(['Updated'])
  await ui.unmount()
})

test('the update button is there with no timer and on a break, and starts none', async ($, on) => {
  const calls: Call[] = []
  const timers: Timer[] = []
  const world: World = {}
  engine(on, timers, calls, world)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await shows(ui, /not tracking/)).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeDefined()

  // a timer started in the app shows after the press
  timers.push({ ...SCOREBOARD })
  await ui.press({ key: 'refresh' })
  expect(await drawn(ui, 'pause')).toBe(true)

  // and so does a break
  world.onBreak = true
  await ui.press({ key: 'refresh' })
  expect(await drawn(ui, 'endBreak')).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeDefined()

  const changed = ['start_timer', 'stop_timer', 'end_break', 'create_task']
  expect(calls.filter((c) => changed.includes(c.tool))).toEqual([])
  await ui.unmount()
})

test('after a server problem the update button tries again and clears it', async ($, on) => {
  const toasts: string[] = []
  const world: World = {}
  engine(on, [{ ...SCOREBOARD }], [], world)
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  world.failOnce = new Set(['get_running_timers'])
  await ui.press({ key: 'refresh' })
  expect(await shows(ui, /time tracking: unreachable/)).toBe(true)
  // the line says what went wrong: no "Updated" over it
  expect(toasts).toEqual([])

  await ui.press({ key: 'refresh' })
  expect(await drawn(ui, 'pause')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /time tracking:/ })).toBeUndefined()
  await ui.unmount()
})

test("the band shows today's time on all tasks, not the task's total", async ($, on) => {
  const calls: Call[] = []
  engine(on, [], calls)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.command.run({ command: 'track', args: 'add Fix the scoreboard' })

  expect(await ui.find({ type: 'Text', text: /today/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2:15' })).toBeDefined()
  // the task's total in all (1:05) is not shown
  expect(await ui.find({ type: 'Text', text: /1:05/ })).toBeUndefined()
  // hours and minutes, as the app shows the total: no clock with seconds
  expect(await ui.find({ type: 'Text', text: /\d:\d\d:\d\d/ })).toBeUndefined()
  // asked for this computer's day, in its time zone
  const asked = calls.find((c) => c.tool === 'get_time_totals')?.args
  expect(asked?.from_date).toBe(asked?.to_date)
  expect(asked?.from_date).toMatch(/^2026-10-(29|30|31)$/)
  expect(asked?.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  await ui.unmount()
})

test('/track project remembers the project, and the rules tell Claude about it', async ($, on) => {
  const calls: Call[] = []
  engine(on, [], calls)
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'track', args: 'project acme' })
  expect(ran.text).toBe("This repository's time goes to Acme.")

  const composed = await $.prompt.compose({
    model: 'm',
    promptModel: 'm',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  const rules = composed.sections.find((s) => s.id === 'knorky:rules')?.text ?? ''
  expect(rules).toContain("This repository's project: Acme (project_id p1)")
  expect(rules).toContain('list_tasks with issue "ACME-1013"')
})

test("/track shows each running task's total, not how long the timers ran", async ($, on) => {
  // started together, both timers ran 0:27; their tasks' totals differ
  const other: Timer = { ...SCOREBOARD, task_id: 'gone', task: 'Write the offer', project: null }
  engine(on, [{ ...SCOREBOARD }, other], [])

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const status = await $.command.run({ command: 'track', args: '' })
  const lines = status.text?.split('\n') ?? []
  expect(lines.slice(0, 4)).toEqual([
    'Running: Fix the scoreboard · Acme · 3:10 in all',
    'Running: Write the offer',
    'The time is split between the 2 timers.',
    'Today: 2:15 on all tasks',
  ])
  expect(status.text).not.toContain('0:27')
  expect(lines.at(-1)).toBe('Your time in Knorky: https://app.knorky.com')
})

test('without a project, the rules tell Claude to ask for one', async ($, on) => {
  engine(on, [], [])
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const status = await $.command.run({ command: 'track', args: '' })
  expect(status.text).toBe(
    'Nothing is running.\nToday: 2:15 on all tasks\n' +
      'This repository has no project yet: /track project <name>\n' +
      'Claude adds its task to the running timers (split): /track default only to change\n' +
      'Your time in Knorky: https://app.knorky.com',
  )

  const composed = await $.prompt.compose({
    model: 'm',
    promptModel: 'm',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  const rules = composed.sections.find((s) => s.id === 'knorky:rules')?.text ?? ''
  expect(rules).toContain('ask the user once which project')
})

const COMPOSE = {
  model: 'm',
  promptModel: 'm',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as const

test('/track <task> tracks only that task; /track add <task> splits the time', async ($, on) => {
  const calls: Call[] = []
  engine(on, [], calls)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })

  const only = await $.command.run({ command: 'track', args: 'Fix login' })
  expect(only.text).toBe('Tracking: Fix login')
  const added = await $.command.run({ command: 'track', args: 'add Write docs' })
  expect(added.text).toBe('Tracking, split with the others: Write docs')

  const starts = calls
    .filter((c) => c.tool === 'start_timer')
    .map((c) => [c.args.mode, c.args.keep_others_running])
  expect(starts).toEqual([
    ['only', false],
    ['split', true],
  ])
})

const rulesText = async ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  (await $.prompt.compose(COMPOSE)).sections.find((s) => s.id === 'knorky:rules')?.text ?? ''

test('Claude splits the time by default; the setting before 0.3.6 changes nothing', async ($, on) => {
  const calls: Call[] = []
  // a session before 0.3.6 may have stored "single"
  engine(on, [], calls, { store: new Map<string, unknown>([['mode', 'single']]) })
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const rules = await rulesText($)
  expect(rules).toContain(`start_timer with mode "split" (the user's default`)
  expect(rules).not.toContain(`mode "only" (the user's default`)
  expect(rules).toContain('"too", "also", "add", "in parallel" and "split" mean mode "split"')
  expect(rules).toContain('"instead", "only this" and "stop the others" mean mode "only"')
  expect(rules).toContain('unclear whether the other timers should stop, ask the user first')

  // the old words create no task called "split"; they say what to use now
  const said = await $.command.run({ command: 'track', args: 'split' })
  expect(said.text).toBe(
    '/track default split | only sets how Claude starts timers; /track <task> tracks only that task; /track add <task> adds it to the running ones.',
  )
  expect(calls.some((c) => c.tool === 'create_task' || c.tool === 'start_timer')).toBe(false)
})

test('/track default only makes Claude stop the other timers, and is remembered', async ($, on) => {
  const store = new Map<string, unknown>()
  engine(on, [], [], { store })
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const set = await $.command.run({ command: 'track', args: 'default only' })
  expect(set.text).toBe('Claude now tracks only its task; starting one stops the other timers.')
  expect(store.get('default-mode')).toBe('only')
  expect(await rulesText($)).toContain(`start_timer with mode "only" (the user's default`)
  const status = await $.command.run({ command: 'track', args: '' })
  expect(status.text).toContain(
    'Claude tracks only its task (the other timers stop): /track default split to change',
  )

  const back = await $.command.run({ command: 'track', args: 'default split' })
  expect(back.text).toBe(
    'Claude now adds its task to the running timers; the time is split between them.',
  )
  expect(await rulesText($)).toContain(`start_timer with mode "split" (the user's default`)
})

test('a later session starts with the default an earlier one chose', async ($, on) => {
  engine(on, [], [], { store: new Map<string, unknown>([['default-mode', 'only']]) })
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(await rulesText($)).toContain(`start_timer with mode "only" (the user's default`)
})

test('/track default without split or only says the words and keeps the default', async ($, on) => {
  const calls: Call[] = []
  const store = new Map<string, unknown>()
  engine(on, [], calls, { store })
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const args of ['default', 'default parallel']) {
    const said = await $.command.run({ command: 'track', args })
    expect(said.text).toBe('/track default split | only')
  }
  expect(store.has('default-mode')).toBe(false)
  expect(calls.some((c) => c.tool === 'create_task' || c.tool === 'start_timer')).toBe(false)
})

test('a task /track creates gets its timer started', async ($, on) => {
  const calls: Call[] = []
  engine(on, [], calls)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  await $.command.run({ command: 'track', args: 'Fix login' })

  expect(calls.find((c) => c.tool === 'start_timer')?.args.task_id).toBe('new')
})

test('without the server, /track says how to connect it', async ($, on) => {
  engine(on, [], [], { tools: [] })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'track', args: '' })
  expect(ran.text).toContain('Run /mcp, choose plugin:knorky:knorky and sign in')
})

test('a server that connects after the session started still gets the band', async ($, on) => {
  const world: World = { tools: [] }
  const clock = engine(on, [{ ...SCOREBOARD }], [], world)
  // the engine's own band, drawn while the mod passes
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Fix the scoreboard/ })).toBeUndefined()

  // found on the minute; what runs is read at the next turn's end, in a hook
  world.tools = TOOLS
  await clock.advance(60 * 1000)
  await $.turn.complete(ANSWERED)
  expect(await drawn(ui, 'pause')).toBe(true)
  await ui.unmount()
})

test('/track finds a server that connected after the session started', async ($, on) => {
  const world: World = { tools: [] }
  engine(on, [{ ...SCOREBOARD }], [], world)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  world.tools = TOOLS
  const ran = await $.command.run({ command: 'track', args: '' })
  expect(ran.text).not.toContain('No time-tracking server')
})

// The directory holds a plugin to this: the person's own rules decide.
test('the plugin changes no permission decision', async ($, on) => {
  engine(on, [{ ...SCOREBOARD }], [])
  on('tool.check', () => ({ decision: 'deny' as const, reason: 'no verdict' }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const claudes = await $.tool.check({ tool: `mcp__${SERVER}__start_timer`, input: {} })
  expect(claudes.decision).toBe('deny')
})

test("a timer started in the app shows, with today's time", async ($, on) => {
  // the session tracks nothing: the band shows the timer that runs
  engine(on, [{ ...SCOREBOARD }], [])

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Fix the scoreboard/ }))?.text).toContain(
    'Fix the scoreboard',
  )
  expect(await ui.find({ type: 'Text', text: '2:15' })).toBeDefined()
  await ui.unmount()
})

const TURN = { text: 'do the work', turnId: 'turn-1' }
const ANSWERED = {
  turnId: 'turn-1',
  answer: 'done',
  durationMs: 1,
  isAborted: false,
  reason: 'answer' as const,
}

test('no prompt for hours stops no timer: testing in a browser is work too', async ($, on) => {
  const calls: Call[] = []
  const clock = engine(on, [], calls)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  await $.command.run({ command: 'track', args: 'Fix login' })
  // three hours without a prompt, in steps: the band's clock ticks every second
  for (let i = 0; i < 6; i++) await clock.advance(30 * 60 * 1000)
  await $.prompt.submit({ text: TURN.text })
  await $.turn.start(TURN)
  await $.turn.complete(ANSWERED)

  expect(calls.some((c) => c.tool === 'stop_timer')).toBe(false)
  expect(calls.some((c) => c.tool === 'update_time_entry')).toBe(false)
})

test('the band reads the server at the end of a turn, not from a timer', async ($, on) => {
  const calls: Call[] = []
  const clock = engine(on, [{ ...SCOREBOARD }], calls)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const reads = () => calls.filter((c) => c.tool === 'get_running_timers').length
  const atStart = reads()
  await clock.advance(5 * 60 * 1000)
  expect(reads()).toBe(atStart)

  await $.turn.start(TURN)
  await $.turn.complete(ANSWERED)
  expect(reads()).toBe(atStart + 1)
})

test('a session that ends leaves a timer another session tracks', async ($, on) => {
  const calls: Call[] = []
  const files = new Map([[`${CLAIMS}/other.json`, { text: '{"task_id":"new"}', mtimeMs: NOW }]])
  engine(on, [], calls, { files })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  await $.command.run({ command: 'track', args: 'Fix login' })
  await $.session.end({ reason: 'other', sessionId: 'me' })

  expect(calls.some((c) => c.tool === 'stop_timer')).toBe(false)
})

test("a session that ends alone stops its timer, noting the session's commits", async ($, on) => {
  const calls: Call[] = []
  const commands: string[][] = []
  // the timer started at 12:00:00: the last line is from before it
  const at = (time: string) => Date.parse(`2026-10-30T${time}Z`) / 1000
  const log = [
    `${at('12:00:03')}\tAdd the tests`,
    `${at('12:00:00')}\tFix the clock`,
    `${at('11:59:59')}\tOlder work`,
    '',
  ].join('\n')
  engine(on, [], calls, { log, commands })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  await $.command.run({ command: 'track', args: 'Fix login' })
  await $.session.end({ reason: 'other', sessionId: 'me' })

  expect(calls.find((c) => c.tool === 'stop_timer')?.args).toEqual({
    task_id: 'new',
    note: 'Commits: Fix the clock; Add the tests',
  })
  // the whole command is fixed text, as the plugin directory reads it
  expect(commands).toContainEqual(['git', 'log', '--no-merges', '--format=%ct%x09%s', '-n', '200'])
})

test('a timer with no commits since it started gets no note', async ($, on) => {
  const calls: Call[] = []
  engine(on, [], calls, { log: `${Date.parse('2026-10-29T12:00:00Z') / 1000}\tOlder work\n` })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  await $.command.run({ command: 'track', args: 'Fix login' })
  await $.session.end({ reason: 'other', sessionId: 'me' })

  expect(calls.find((c) => c.tool === 'stop_timer')?.args).toEqual({ task_id: 'new' })
})

test('a session that ends stops every timer it started, none from the app', async ($, on) => {
  const calls: Call[] = []
  const timers: Timer[] = [
    { ...SCOREBOARD, task_id: 'a', task: 'First' },
    { ...SCOREBOARD, task_id: 'b', task: 'Second' },
    { ...SCOREBOARD, task_id: 'app', task: 'Started in the app' },
  ]
  engine(on, timers, calls)
  on('tool.call', () => ({ result: 'started' }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const tool = `mcp__${SERVER}__start_timer`
  await $.tool.call({ tool, task_id: 'a', mode: 'split' } as never)
  await $.tool.call({ tool, task_id: 'b', mode: 'split' } as never)
  await $.session.end({ reason: 'other', sessionId: 'me' })

  const stopped = calls.filter((c) => c.tool === 'stop_timer').map((c) => c.args.task_id)
  expect(stopped.sort()).toEqual(['a', 'b'])
})

test('a session names all its timers, and leaves the one another window tracks', async ($, on) => {
  const calls: Call[] = []
  const timers: Timer[] = [
    { ...SCOREBOARD, task_id: 'a', task: 'First' },
    { ...SCOREBOARD, task_id: 'b', task: 'Second' },
  ]
  const files = new Map([[`${CLAIMS}/other.json`, { text: '{"task_ids":["a"]}', mtimeMs: NOW }]])
  engine(on, timers, calls, { files })
  on('tool.call', () => ({ result: 'started' }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const tool = `mcp__${SERVER}__start_timer`
  await $.tool.call({ tool, task_id: 'a', mode: 'split' } as never)
  await $.tool.call({ tool, task_id: 'b', mode: 'split' } as never)
  const mine = JSON.parse(files.get(`${CLAIMS}/me.json`)?.text ?? '{}')
  expect(mine.task_ids.sort()).toEqual(['a', 'b'])
  // a window on an older version reads this one
  expect(mine.task_id).toBe('b')

  await $.session.end({ reason: 'other', sessionId: 'me' })
  expect(calls.filter((c) => c.tool === 'stop_timer').map((c) => c.args.task_id)).toEqual(['b'])
})

test('/track add and /track project alone say the words, and start nothing', async ($, on) => {
  const calls: Call[] = []
  engine(on, [{ ...SCOREBOARD }], calls)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  const add = await $.command.run({ command: 'track', args: 'add' })
  expect(add.text).toBe('/track add <task>')
  const project = await $.command.run({ command: 'track', args: 'project' })
  expect(project.text).toBe('/track project <name>')
  expect(calls.some((c) => c.tool === 'create_task' || c.tool === 'start_timer')).toBe(false)
})

test('/track STOP stops, in any case', async ($, on) => {
  const calls: Call[] = []
  engine(on, [], calls)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  await $.command.run({ command: 'track', args: 'Fix login' })
  const made = calls.filter((c) => c.tool === 'create_task').length
  await $.command.run({ command: 'track', args: 'STOP' })
  expect(calls.filter((c) => c.tool === 'create_task').length).toBe(made)
  expect(calls.some((c) => c.tool === 'stop_timer')).toBe(true)
})

test('/clear keeps the timer and the clock: the person goes on working', async ($, on) => {
  const calls: Call[] = []
  const clock = engine(on, [{ ...SCOREBOARD }], calls)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  await $.command.run({ command: 'track', args: 'add Fix login' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.session.end({ reason: 'clear', sessionId: 'me' })
  expect(calls.some((c) => c.tool === 'stop_timer')).toBe(false)

  await clock.advance(60 * 1000)
  expect(await shows(ui, '2:16')).toBe(true)
  await ui.unmount()
})

test('without git the plugin still starts, and a timer still stops', async ($, on) => {
  const calls: Call[] = []
  engine(on, [], calls, { noGit: true })
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(await rulesText($)).toContain('Git branch: unknown')
  await $.command.run({ command: 'track', args: 'project acme' })
  const started = await $.command.run({ command: 'track', args: 'Fix login' })
  expect(started.text).toContain('Tracking')
  const stopped = await $.command.run({ command: 'track', args: 'stop' })
  expect(stopped.text).toContain('Stopped')
  expect(calls.find((c) => c.tool === 'stop_timer')?.args).toEqual({ task_id: 'new' })
})

test('a branch names an issue only where it reads like one', () => {
  const github = 'git@github.com:knorkyapp/knorky.git'
  const keyOf = (branch: string) => branchIssue(branch, github)?.key ?? null
  // a tracker's key
  expect(keyOf('feat/ENG-123-fix')).toBe('ENG-123')
  expect(keyOf('fix-ENG-123-login')).toBe('ENG-123')
  expect(keyOf('dan/eng-123-fix')).toBe('ENG-123')
  expect(keyOf('eng-123')).toBe('ENG-123')
  // a GitHub issue
  expect(keyOf('gh-102')).toBe('knorkyapp/knorky#102')
  expect(keyOf('GH-102')).toBe('knorkyapp/knorky#102')
  expect(keyOf('issue-102')).toBe('knorkyapp/knorky#102')
  expect(keyOf('feat/issues-7-x')).toBe('knorkyapp/knorky#7')
  expect(keyOf('feat/102-fix')).toBe('knorkyapp/knorky#102')
  // words that end in a number
  expect(keyOf('fix-login-2')).toBe(null)
  expect(keyOf('update-node-20')).toBe(null)
  expect(keyOf('release-1.2')).toBe(null)
  expect(keyOf('main')).toBe(null)
  // a GitHub prefix elsewhere names nothing
  expect(branchIssue('gh-102', 'git@example.com:me/repo.git')).toBe(null)
})

test('the rules follow the branch the session moves to', async ($, on) => {
  const world: World = {
    branch: 'feat/101-first\n',
    remote: 'git@github.com:knorkyapp/knorky.git\n',
  }
  engine(on, [], [], world)
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(await rulesText($)).toContain('knorkyapp/knorky#101')

  world.branch = 'feat/102-second\n'
  const rules = await rulesText($)
  expect(rules).toContain('Git branch: feat/102-second')
  expect(rules).toContain('knorkyapp/knorky#102')
  expect(rules).not.toContain('#101')
})

test("with nothing running overnight, yesterday's time is not today's", async ($, on) => {
  const evening = new Date(2026, 9, 31, 23, 59).getTime()
  const clock = engine(on, [{ ...SCOREBOARD }], [], { now: evening })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(1000)
  expect(await shows(ui, /today/)).toBe(true)
  await ui.press({ key: 'pause' })
  expect(await drawn(ui, 'start')).toBe(true)

  // past midnight, no timer running: the total was yesterday's
  await clock.advance(2 * 60 * 1000)
  for (let i = 0; i < 50 && (await ui.find({ type: 'Text', text: /today/ })); i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
  expect(await ui.find({ type: 'Text', text: /today/ })).toBeUndefined()

  // asked again, it shows today's
  await ui.press({ key: 'refresh' })
  expect(await shows(ui, /today/)).toBe(true)
  await ui.unmount()
})

test('/track project prefers the exact name', async ($, on) => {
  const projects = [
    { id: 'p1', name: 'Web' },
    { id: 'p2', name: 'Website' },
  ]
  engine(on, [], [], { projects })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const exact = await $.command.run({ command: 'track', args: 'project web' })
  expect(exact.text).toBe("This repository's time goes to Web.")
  const part = await $.command.run({ command: 'track', args: 'project webs' })
  expect(part.text).toBe("This repository's time goes to Website.")
  const both = await $.command.run({ command: 'track', args: 'project we' })
  expect(both.text).toBe('Several match: Web, Website')
})

test('a server found on the minute says so, and is read before Claude relies on it', async ($, on) => {
  const world: World = { tools: [] }
  const clock = engine(on, [{ ...SCOREBOARD }], [], world)
  on('prompt.compose', () => ({ sections: [] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  world.tools = TOOLS
  await clock.advance(60 * 1000)

  // not read yet: the line does not claim that nothing runs
  expect(await shows(ui, /connected/)).toBe(true)
  expect(await ui.find({ type: 'Text', text: /not tracking/ })).toBeUndefined()

  // the next prompt reads it first
  expect(await rulesText($)).toContain('Running now: Fix the scoreboard')
  expect(await drawn(ui, 'pause')).toBe(true)
  await ui.unmount()
})

test('the update button reads a server found on the minute', async ($, on) => {
  const world: World = { tools: [] }
  const clock = engine(on, [{ ...SCOREBOARD }], [], world)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  world.tools = TOOLS
  await clock.advance(60 * 1000)
  expect(await shows(ui, /connected/)).toBe(true)

  await ui.press({ key: 'refresh' })
  expect(await drawn(ui, 'pause')).toBe(true)
  await ui.unmount()
})

test('a GitHub issue number in the branch finds and links the task', async ($, on) => {
  engine(on, [], [], {
    branch: 'feat/102-claude-tracking\n',
    remote: 'git@github.com:knorkyapp/knorky.git\n',
  })
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const composed = await $.prompt.compose(COMPOSE)
  const rules = composed.sections.find((s) => s.id === 'knorky:rules')?.text ?? ''
  expect(rules).toContain('list_tasks with issue "knorkyapp/knorky#102"')
  expect(rules).toContain('external_id "knorkyapp/knorky#102"')
})

test('on a break, the band shows it and ▶ ends it', async ($, on) => {
  const calls: Call[] = []
  engine(on, [], calls, { onBreak: true })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /on a break/ }))?.text).toContain('0:12')

  await ui.press({ key: 'endBreak' })
  expect(await drawn(ui, 'endBreak')).toBe(false)
  expect(calls.some((c) => c.tool === 'end_break')).toBe(true)
  await ui.unmount()
})

test("with timers split, today's time counts on once, not by each one's share", async ($, on) => {
  const split = (id: string, task: string): Timer => ({
    task_id: id,
    task,
    project: 'Acme',
    hm: '0:10',
    seconds: 600,
    started_at: '2026-10-30T11:00:00Z',
    started_by: 'app',
  })
  const clock = engine(on, [split('t1', 'Fix the scoreboard'), split('t2', 'Docs')], [], {
    todayMinutes: 190,
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '3:10' })).toBeDefined()
  await clock.advance(61_000)

  // the whole 61 s since: 3:11:01; by one timer's share it would still read 3:10
  expect(await ui.find({ type: 'Text', text: '3:11' })).toBeDefined()
  await ui.unmount()
})

// Agent work: Claude's own time and tokens, never the person's working time.

type Api = Parameters<Parameters<typeof test>[1]>[0]

const usage = (input: number, output: number, model = 'claude-opus-5-5'): StepUsage => ({
  model,
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
})

/** One model request of a turn, read to its end. */
async function step($: Api, turnId: string, index: number, agentId?: string) {
  const stream = $.turn.step({
    turnId,
    index,
    model: 'claude-opus-5-5',
    messageCount: 1,
    ...(agentId ? { agentId } : {}),
  })
  for await (const chunk of stream) void chunk
  return stream.result
}

/** A main-loop turn of `steps` requests that took `ms`. */
async function turn($: Api, turnId: string, steps: number, ms: number) {
  await $.turn.start({ text: 'work', turnId })
  for (let i = 0; i < steps; i++) await step($, turnId, i)
  await $.turn.complete({ ...ANSWERED, turnId, durationMs: ms })
}

/** The local date of a time, as the plugin names the day. */
function dayOf(ms: number) {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

const reports = (calls: Call[]) => calls.filter((c) => c.tool === 'record_agent_work')

/** A session tracking task "new" (Fix login) in project Acme. */
async function tracking($: Api) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  await $.command.run({ command: 'track', args: 'Fix login' })
}

test("a turn's time and tokens go to the server with the session task", async ($, on) => {
  const calls: Call[] = []
  const clock = engine(on, [], calls, { steps: [usage(100, 10), usage(200, 20)] })

  await tracking($)
  await turn($, 'turn-1', 2, 3000)
  await clock.settle()

  const sent = reports(calls)
  expect(sent.length).toBe(1)
  expect(sent[0]?.args).toEqual({
    agent: 'claude-code',
    session_id: 'me',
    day: dayOf(clock.now()),
    task_id: 'new',
    model: 'claude-opus-5-5',
    started_at: new Date(clock.now() - 3000).toISOString(),
    last_at: new Date(clock.now()).toISOString(),
    work_ms: 3000,
    turns: 1,
    input_tokens: 300,
    output_tokens: 30,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  })
})

test('a second turn sends the totals of both', async ($, on) => {
  const calls: Call[] = []
  const clock = engine(on, [], calls, { steps: [usage(100, 10), usage(200, 20), usage(5, 1)] })

  await tracking($)
  await turn($, 'turn-1', 2, 3000)
  const first = clock.now() - 3000
  await clock.advance(60 * 1000)
  await turn($, 'turn-2', 1, 1000)
  await clock.settle()

  const last = reports(calls).at(-1)?.args
  expect(reports(calls).length).toBe(2)
  expect(last?.work_ms).toBe(4000)
  expect(last?.turns).toBe(2)
  expect(last?.input_tokens).toBe(305)
  expect(last?.output_tokens).toBe(31)
  expect(last?.started_at).toBe(new Date(first).toISOString())
  expect(last?.last_at).toBe(new Date(clock.now()).toISOString())
})

test("a sub-agent's steps add tokens, its turn's end no time", async ($, on) => {
  const calls: Call[] = []
  const clock = engine(on, [], calls, { steps: [usage(100, 10), usage(50, 5, 'claude-haiku')] })

  await tracking($)
  await $.turn.start({ text: 'work', turnId: 'turn-1' })
  await step($, 'turn-1', 0)
  await step($, 'sub-1', 0, 'agent-1')
  await $.turn.complete({ ...ANSWERED, turnId: 'sub-1', agentId: 'agent-1', durationMs: 9999 })
  await clock.settle()
  expect(reports(calls).length).toBe(0)

  await $.turn.complete({ ...ANSWERED, durationMs: 3000 })
  await clock.settle()
  const sent = reports(calls)[0]?.args
  expect(sent?.work_ms).toBe(3000)
  expect(sent?.turns).toBe(1)
  expect(sent?.input_tokens).toBe(150)
  expect(sent?.output_tokens).toBe(15)
  // the model that wrote the most
  expect(sent?.model).toBe('claude-opus-5-5')
})

test('a day of work never exceeds what the server accepts', async ($, on) => {
  const calls: Call[] = []
  const clock = engine(on, [], calls, { steps: [usage(100, 10), usage(7, 3)] })

  await tracking($)
  await turn($, 'turn-1', 1, 25 * 60 * 60 * 1000)
  await clock.settle()
  expect(reports(calls).at(-1)?.args.work_ms).toBe(86_400_000)

  await turn($, 'turn-2', 1, 1000)
  await clock.settle()
  expect(reports(calls).at(-1)?.args.work_ms).toBe(86_400_000)
})

test('a session past midnight puts each turn on its own day', async ($, on) => {
  const calls: Call[] = []
  // local times: the day is the user's, wherever the test runs
  const evening = new Date(2026, 9, 31, 23, 59).getTime()
  const morning = new Date(2026, 10, 1, 0, 1).getTime()
  const steps = [usage(100, 10), usage(7, 3)]
  const clock = engine(on, [], calls, { steps, now: evening })

  await tracking($)
  await turn($, 'turn-1', 1, 2000)
  await clock.set(morning)
  await turn($, 'turn-2', 1, 1000)
  await clock.settle()

  const sent = reports(calls).map((c) => c.args)
  expect(sent.length).toBe(2)
  expect(sent[0]).toMatchObject({ day: '2026-10-31', work_ms: 2000, turns: 1, input_tokens: 100 })
  expect(sent[1]).toMatchObject({ day: '2026-11-01', work_ms: 1000, turns: 1, input_tokens: 7 })
  expect(sent[1]?.started_at).toBe(new Date(morning - 1000).toISOString())
})

test('Claude may not call record_agent_work itself', async ($, on) => {
  const calls: Call[] = []
  engine(on, [], calls)
  // the server's tool, had the plugin let the call through
  on('tool.call', () => ({ result: 'recorded' }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const tool = `mcp__${SERVER}__record_agent_work`
  const ran = (await $.tool.call({ tool, agent: 'claude-code', work_ms: 1 } as never)) as {
    text?: string
    deny?: string
  }
  expect(ran.deny ?? ran.text).toContain('This tool is for the plugin only.')
  expect(reports(calls).length).toBe(0)

  const described = await $.tool.describe({
    tool,
    description: 'Records agent work.',
    provider: { plugin: `mcp:${SERVER}`, tier: 'user' },
  } as never)
  expect(described.isDeferred).toBe(true)
})

test('a failed send is carried by the next one', async ($, on) => {
  const calls: Call[] = []
  const clock = engine(on, [], calls, {
    steps: [usage(100, 10), usage(200, 20)],
    failOnce: new Set(['record_agent_work']),
  })

  await tracking($)
  await turn($, 'turn-1', 1, 3000)
  await clock.settle()
  await turn($, 'turn-2', 1, 2000)
  await clock.settle()

  const sent = reports(calls).map((c) => c.args)
  expect(sent.length).toBe(2)
  expect(sent[1]).toMatchObject({ work_ms: 5000, turns: 2, input_tokens: 300, output_tokens: 30 })
})

test('rows over a week old leave the store; newer ones stay', async ($, on) => {
  const store = new Map<string, unknown>([
    ['work:old:2026-10-20:-', { day: '2026-10-20' }],
    ['work:old:2026-10-25:t1', { day: '2026-10-25' }],
    ['mode', 'split'],
  ])
  const clock = engine(on, [], [], { steps: [usage(1, 1)], store })

  await tracking($)
  await turn($, 'turn-1', 1, 1000)
  await clock.settle()

  expect(store.has('work:old:2026-10-20:-')).toBe(false)
  expect(store.has('work:old:2026-10-25:t1')).toBe(true)
  expect(store.has('mode')).toBe(true)
  expect(store.has(`work:me:${dayOf(clock.now())}:new`)).toBe(true)
  expect(store.has('work:me:pending')).toBe(false)
  expect(store.has('work:me:unsent')).toBe(false)
})

/** What a promise settles to within half a second of real time, or 'blocked'. */
function within<T>(promise: Promise<T>) {
  const late = new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 500))
  return Promise.race([promise, late])
}

test('rows an ended session could not send go with the next turn, as its own', async ($, on) => {
  const day = dayOf(NOW)
  const earlier = {
    day,
    task_id: 't1',
    project_id: null,
    started_at: new Date(NOW - 60_000).toISOString(),
    last_at: new Date(NOW - 30_000).toISOString(),
    work_ms: 30_000,
    turns: 2,
    input_tokens: 5,
    output_tokens: 7,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    models: { 'claude-opus-5-5': 7 },
  }
  const store = new Map<string, unknown>([
    [`work:gone:${day}:t1`, earlier],
    ['work:gone:unsent', [`work:gone:${day}:t1`]],
  ])
  const calls: Call[] = []
  const clock = engine(on, [], calls, { steps: [usage(1, 1)], store })

  await tracking($)
  await turn($, 'turn-1', 1, 1000)
  await clock.settle()

  const sent = reports(calls).map((c) => c.args)
  expect(sent).toContainEqual(
    expect.objectContaining({ session_id: 'gone', task_id: 't1', work_ms: 30_000, turns: 2 }),
  )
  expect(sent).toContainEqual(expect.objectContaining({ session_id: 'me', task_id: 'new' }))
  expect(store.has('work:gone:unsent')).toBe(false)
})

test('past the wait, no more rows go out until the next turn', async ($, on) => {
  const day = dayOf(NOW)
  const store = new Map<string, unknown>([
    [`work:gone:${day}:t1`, { day, task_id: 't1', work_ms: 1000, turns: 1, models: {} }],
    ['work:gone:unsent', [`work:gone:${day}:t1`]],
  ])
  const calls: Call[] = []
  const world: World = {
    steps: [usage(1, 1), usage(1, 1)],
    store,
    holdOnce: new Set(['record_agent_work']),
  }
  const clock = engine(on, [], calls, world)

  await tracking($)
  await $.turn.start({ text: 'work', turnId: 'turn-1' })
  await step($, 'turn-1', 0)
  const ended = $.turn.complete({ ...ANSWERED, durationMs: 1000 })
  await within(ended)
  await clock.advance(3000)
  expect(await within(ended)).not.toBe('blocked')
  // the slow answer comes after the hook: the other list waits
  world.release?.()
  await clock.settle()
  expect(reports(calls).length).toBe(1)

  await turn($, 'turn-2', 1, 1000)
  await clock.settle()
  const sessions = reports(calls).map((c) => c.args.session_id)
  expect(sessions).toContain('gone')
  expect(sessions).toContain('me')
})

test('a server that never answers holds the turn briefly, never the next step', async ($, on) => {
  const calls: Call[] = []
  const clock = engine(on, [], calls, {
    steps: [usage(100, 10), usage(200, 20)],
    hangOnce: new Set(['record_agent_work']),
  })

  await tracking($)
  await $.turn.start({ text: 'work', turnId: 'turn-1' })
  await step($, 'turn-1', 0)
  const ended = $.turn.complete({ ...ANSWERED, durationMs: 3000 })
  // the send waits inside the hook, where the plugin's own call is let through
  expect(await within(ended)).toBe('blocked')
  await clock.advance(3000)
  expect(await within(ended)).not.toBe('blocked')
  await clock.settle()
  expect(reports(calls).length).toBe(1)

  // the send still hangs: the next turn steps, ends and sends all the same
  await $.turn.start({ text: 'more', turnId: 'turn-2' })
  expect(await within(step($, 'turn-2', 0))).not.toBe('blocked')
  const again = $.turn.complete({ ...ANSWERED, turnId: 'turn-2', durationMs: 2000 })
  await within(again)
  await clock.advance(3000)
  expect(await within(again)).not.toBe('blocked')
  await clock.settle()
  expect(reports(calls).at(-1)?.args).toMatchObject({ work_ms: 5000, turns: 2, input_tokens: 300 })
})
