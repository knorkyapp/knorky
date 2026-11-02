import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Running, SessionTask } from '../types'
import { endEntryAt, refresh, stopSessionTask } from './server'

type Api = EngineInterface

// Values the band draws from; the server's answers are the truth, these only
// mirror them for the session. Each file names the ones it reads or writes.
const running = atom({ plugin: 'knorky', key: 'running' } as const, [] as Running[])
const sessionTask = atom(
  { plugin: 'knorky', key: 'sessionTask' } as const,
  null as SessionTask | null,
)

// No prompt and no turn for this long: the person is away, the session's timer stops.
const IDLE_MS = 20 * 60 * 1000

let idle: { cancel: () => void } | null = null
// A turn of the main conversation runs: Claude works, the person is not away.
let working = false
// When the person went away, once the idle clock has run out; the timer
// stops at the next hook, which alone may call the server.
let awayAt: number | null = null

/** Starts the idle clock again, unless Claude is working. */
export function armIdle($: Api) {
  idle?.cancel()
  idle = null
  if (working) return
  idle = $.clock.after(IDLE_MS, () => {
    void $.clock.now().then((now) => {
      awayAt = now - IDLE_MS
      $.ui.toast('No activity for 20 minutes: the timer ends there once you are back')
    })
  })
}

/** Claude starts or ends a turn: while it works, the idle clock waits. */
export function setWorking($: Api, isWorking: boolean) {
  working = isWorking
  if (isWorking) {
    idle?.cancel()
    idle = null
  } else armIdle($)
}

export function stopIdle() {
  idle?.cancel()
  idle = null
}

/**
 * The person is back, or the session ends: a timer the idle clock ran out on
 * stops, and its end moves back to when they went away. Not while another
 * session tracks the same task. What it said, or null.
 */
export async function settleAway($: Api) {
  const since = awayAt
  if (since === null) return null
  awayAt = null
  await refresh($)
  const task = await read($, sessionTask)
  const entry = task && (await read($, running)).find((r) => r.task_id === task.id)
  const said = await stopSessionTask($, true)
  if (said && entry?.entry_id) await endEntryAt($, entry.entry_id, since)
  return said
}
