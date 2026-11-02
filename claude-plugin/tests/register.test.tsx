import { expect, mock, test } from 'claude-code/testing'

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
  /** `git log` of the commits since the timer started, newest first. */
  log?: string
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
  on('process.run', (_, e) => ({
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
  }))
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
          ? [
              { id: 'p1', name: 'Acme' },
              { id: 'p2', name: 'Garden' },
            ]
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
  expect(await ui.find({ type: 'Button', key: 'pause' })).toBeDefined()
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
  expect(start?.args).toEqual({ task_id: 't1', keep_others_running: false })
  expect(await ui.find({ type: 'Button', key: 'pause' })).toBeDefined()
  await ui.unmount()
})

test('the band shows Σ, the time tracked on the session task in all', async ($, on) => {
  engine(on, [], [])

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.command.run({ command: 'track', args: 'add Fix the scoreboard' })

  expect((await ui.find({ type: 'Text', text: /Σ/ }))?.text).toContain('Σ 1:05')
  // hours and minutes, as the app shows the total: no clock with seconds
  expect(await ui.find({ type: 'Text', text: /\d:\d\d:\d\d/ })).toBeUndefined()
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
  expect(lines.slice(0, 3)).toEqual([
    'Running: Fix the scoreboard · Acme · Σ 3:10',
    'Running: Write the offer',
    'The time is split between the 2 timers.',
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
    'Nothing is running.\nThis repository has no project yet: /track project <name>\n' +
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
    .map((c) => c.args.keep_others_running)
  expect(starts).toEqual([false, true])
})

test('Claude starts its tasks alone; adding one is an action, not a setting', async ($, on) => {
  const calls: Call[] = []
  // a session before 0.3.6 may have stored "split"
  engine(on, [], calls, { store: new Map<string, unknown>([['mode', 'split']]) })
  on('prompt.compose', () => ({ sections: [] }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const rules = (await $.prompt.compose(COMPOSE)).sections.find((s) => s.id === 'knorky:rules')
  expect(rules?.text).toContain('keep_others_running: false (the user tracks one task at a time)')
  expect(rules?.text).toContain('"too", "in parallel" or "split", use keep_others_running: true')

  // the old words create no task called "split"; they say what to do
  const said = await $.command.run({ command: 'track', args: 'split' })
  expect(said.text).toBe(
    '/track <task> tracks only that task; /track add <task> adds it to the running ones.',
  )
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

// The kit does not raise tool.check for the plugin's own $.mcp.call, so only
// the other half is shown here: the plugin waves through none of Claude's.
test("Claude's calls to the server are left to auto mode", async ($, on) => {
  engine(on, [{ ...SCOREBOARD }], [])
  // auto mode, as it answers a call no request of the person's asked for
  on('tool.check', () => ({ decision: 'deny' as const, reason: 'no verdict' }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const claudes = await $.tool.check({ tool: `mcp__${SERVER}__start_timer`, input: {} })
  expect(claudes.decision).toBe('deny')
})

test("a timer started in the app shows its task's total, as the app does", async ($, on) => {
  // the session tracks nothing: the band shows the timer that runs
  engine(on, [{ ...SCOREBOARD }], [])

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Σ/ }))?.text).toContain('Σ 3:10')
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
  engine(on, [], calls, { log: 'Add the tests\nFix the clock\n' })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'track', args: 'project acme' })
  await $.command.run({ command: 'track', args: 'Fix login' })
  await $.session.end({ reason: 'other', sessionId: 'me' })

  expect(calls.find((c) => c.tool === 'stop_timer')?.args).toEqual({
    task_id: 'new',
    note: 'Commits: Fix the clock; Add the tests',
  })
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

test("with timers split, the total counts on by this one's share", async ($, on) => {
  const split = (id: string, task: string): Timer => ({
    task_id: id,
    task,
    project: 'Acme',
    hm: '0:10',
    seconds: 600,
    started_at: '2026-10-30T11:00:00Z',
    started_by: 'app',
  })
  // 3:10:50 tracked on the task when the server was asked
  const clock = engine(on, [split('t1', 'Fix the scoreboard'), split('t2', 'Docs')], [], {
    scoreboardSeconds: 190 * 60 + 50,
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Σ/ }))?.text).toContain('Σ 3:10')
  await clock.advance(24_000)

  // half of the 24 s since: 3:11:02, not the whole 24 s on top
  expect((await ui.find({ type: 'Text', text: /Σ/ }))?.text).toContain('Σ 3:11')
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
