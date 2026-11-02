export type Running = {
  entry_id?: string
  task_id: string
  task: string
  project: string | null
  hm: string
  /** The time credited to the entry, its share while several run. */
  seconds?: number
  started_at: string
  started_by: string
}

export type Project = { id: string; name: string }

/** The task this session tracks: one Claude or /track started here. */
export type SessionTask = { id: string; title: string }

/** Everything tracked on a task, to the second. */
export type TaskTotal = { taskId: string; seconds: number }

/** How Claude starts a timer by itself: alone, or split with the running ones. */
export type Mode = 'single' | 'split'

declare module 'claude-code' {
  interface PluginState {
    knorky: {
      server: string | null
      running: Running[]
      onBreak: boolean
      /** How long the break has run, as the server last said. */
      breakHm: string | null
      project: Project | null
      sessionTask: SessionTask | null
      error: string | null
      mode: Mode
      nowMs: number
      /** When `running` was last read from the server. */
      refreshedAt: number
      /** Σ of the task the band shows, when `refreshedAt` was read. */
      taskTotal: TaskTotal | null
    }
  }
}
