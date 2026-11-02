import { atom, read } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import type { Project, Running, SessionTask, TaskTotal } from '../types'
import { armIdle } from './idle'
import { endBreak, pause, startTask } from './server'

// Values the band draws from; the server's answers are the truth, these only
// mirror them for the session. Each file names the ones it reads or writes.
const breakHm = atom({ plugin: 'knorky', key: 'breakHm' } as const, null as string | null)
const error = atom({ plugin: 'knorky', key: 'error' } as const, null as string | null)
const nowMs = atom({ plugin: 'knorky', key: 'nowMs' } as const, 0)
const onBreak = atom({ plugin: 'knorky', key: 'onBreak' } as const, false)
const project = atom({ plugin: 'knorky', key: 'project' } as const, null as Project | null)
const refreshedAt = atom({ plugin: 'knorky', key: 'refreshedAt' } as const, 0)
const running = atom({ plugin: 'knorky', key: 'running' } as const, [] as Running[])
const sessionTask = atom(
  { plugin: 'knorky', key: 'sessionTask' } as const,
  null as SessionTask | null,
)
const taskTotal = atom({ plugin: 'knorky', key: 'taskTotal' } as const, null as TaskTotal | null)

type Api = EngineInterface

/**
 * The app's player, in a line: ▶/⏸, the task and its project, and Σ, the
 * time tracked on it in all, in hours and minutes as the app shows it. Pause
 * keeps the task shown, so the same button resumes it.
 */
export async function drawBand($: Api, e: RenderInput<'AbovePrompt'>) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const now = await read($, running)
  const problem = await read($, error)
  if (problem) {
    return (
      <Box>
        <Text dimColor>⏱ time tracking: {problem.slice(0, 80)}</Text>
      </Box>
    )
  }
  if (await read($, onBreak)) {
    const hm = await read($, breakHm)
    return (
      <Box>
        <Button key="endBreak" label="▶" onPress={pressed} />
        <Text dimColor> on a break{hm ? ` · ${hm}` : ''}</Text>
      </Box>
    )
  }

  const task = await shownTask($)
  if (!task) {
    return (
      <Box>
        <Text dimColor>⏱ not tracking · /track &lt;task&gt;</Text>
      </Box>
    )
  }
  const entry = now.find((r) => r.task_id === task.id)
  const others = now.filter((r) => r.task_id !== task.id).length
  // until the second tick has run, the last check is the latest time known
  const askedAt = await read($, refreshedAt)
  const sum = await read($, taskTotal)
  const ms =
    sum?.taskId === task.id
      ? totalMs(sum.seconds, entry, (await read($, nowMs)) || askedAt, askedAt, now.length)
      : null
  const projectName = entry?.project ?? (await read($, project))?.name ?? null

  return (
    <Box>
      {entry ? (
        <Button key="pause" label="⏸" onPress={pressed} />
      ) : (
        <Button key="start" label="▶" onPress={pressed} />
      )}
      {!entry && others > 0 ? <Button key="add" label="+" onPress={pressed} /> : null}
      <Text bold={entry !== undefined} dimColor={entry === undefined}>
        {' '}
        {task.title.slice(0, 50)}
      </Text>
      {projectName ? <Text dimColor> · {projectName}</Text> : null}
      {ms === null ? null : entry ? (
        <Text color="success" bold>
          {' '}
          Σ {hm(ms)}
        </Text>
      ) : (
        <Text dimColor> Σ {hm(ms)}</Text>
      )}
      {others > 0 ? (
        <Text dimColor>
          {' '}
          · +{others} {entry ? 'split' : 'running'}
        </Text>
      ) : null}
    </Box>
  )
}

/** The task the band shows: this session's, else the first that runs. */
async function shownTask($: Api) {
  const first = (await read($, running))[0]
  return (await read($, sessionTask)) ?? (first ? { id: first.task_id, title: first.task } : null)
}

// A press acts in the plugin's `ui.press` hook (pressBand): from here,
// outside any hook, Claude Code would refuse the plugin's calls.
const pressed = () => undefined

/** What a press of the band's button `element` does; what to say, or null. */
export async function pressBand($: Api, element: string): Promise<string | null> {
  if (element === 'endBreak') return endBreak($)
  const task = await shownTask($)
  if (!task) return null
  if (element === 'pause') return pause($, task)
  if (element !== 'start' && element !== 'add') return null
  const said = await startTask($, task, element === 'add')
  armIdle($)
  return said
}

/**
 * Everything tracked on the task, as the app counts it: the server's total
 * when last asked, plus this timer's share of the time since while it runs.
 */
export function totalMs(
  seconds: number,
  entry: Running | undefined,
  now: number,
  askedAt: number,
  runningCount: number,
): number {
  const since = entry && askedAt > 0 ? Math.max(0, now - askedAt) : 0
  return seconds * 1000 + since / Math.max(1, runningCount)
}

/** h:mm, as the app shows a total. */
export function hm(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}
