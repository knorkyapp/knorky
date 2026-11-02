import type { EngineInterface } from 'claude-code'

import { stopSessionTask } from './server'

type Api = EngineInterface

// No prompt and no turn for this long: the person is away, the session's timer stops.
const IDLE_MS = 20 * 60 * 1000

let idle: { cancel: () => void } | null = null
// A turn of the main conversation runs: Claude works, the person is not away.
let working = false

/** Starts the idle clock again, unless Claude is working. */
export function armIdle($: Api) {
  idle?.cancel()
  idle = null
  if (working) return
  idle = $.clock.after(IDLE_MS, () => {
    void stopSessionTask($, true).then((said) => {
      if (said) $.ui.toast(`${said} – no activity for 20 minutes`)
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
