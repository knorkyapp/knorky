export type Running = {
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

/** Everything tracked today, on all tasks, as the server counted it. */
export type DayTotal = { day: string; seconds: number }

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
      nowMs: number
      /** When `running` was last read from the server. */
      refreshedAt: number
      /** Today's time, when `refreshedAt` was read. */
      dayTotal: DayTotal | null
    }
  }
}
