import type { EngineInterface } from 'claude-code'

type Api = EngineInterface

// Each Claude Code session writes which task it tracks to a file of its own,
// and rewrites it every minute. A session that ends stops its task only when
// no other session's file names that task: two windows on the same task share
// one timer.
const FRESH_MS = 3 * 60 * 1000

let folder = ''
let mine = ''

export async function initSessions($: Api) {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const base = config ?? (home ? `${home}/.claude` : null)
  if (!base) return
  folder = `${base.replace(/\\/g, '/')}/plugin-sessions/knorky`
  mine = `${await $.session.id()}.json`
}

/** Writes which task this session tracks now; null for none. */
export async function claim($: Api, taskId: string | null) {
  if (!folder) return
  try {
    await $.fs.write(`${folder}/${mine}`, JSON.stringify({ task_id: taskId }))
  } catch {
    // without the file the session counts as alone: it stops its own timer
  }
}

/** Whether another session tracks the task, by a file written lately. */
export async function sharedWithOthers($: Api, taskId: string): Promise<boolean> {
  if (!folder) return false
  try {
    const now = await $.clock.now()
    for (const f of await $.fs.list(folder)) {
      if (f.name === mine || f.kind !== 'file' || now - f.mtimeMs > FRESH_MS) continue
      const claimed = JSON.parse(await $.fs.read(`${folder}/${f.name}`)) as { task_id?: unknown }
      if (claimed.task_id === taskId) return true
    }
  } catch {
    // no folder yet, or a file being written: as if alone
  }
  return false
}
