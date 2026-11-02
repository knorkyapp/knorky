import type { EngineInterface } from 'claude-code'

type Api = EngineInterface

// A tracker's issue key in a branch name: feat/ENG-123-fix
const ISSUE_KEY = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/
// A GitHub issue number opening a part of a branch name: feat/102-fix, gh-102
const ISSUE_NUMBER = /(?:^|\/)(?:gh-|issue-|issues-)?(\d{1,7})(?=[-_]|$)/
const GITHUB_REPO = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/
// stop_timer takes a note of at most this many characters
const NOTE_MAX = 2000

/** The branch's issue: what list_tasks takes as `issue`, and a GitHub link. */
export type BranchIssue = { key: string; github: string | null }

export async function git($: Api, ...args: string[]) {
  const { exitCode, stdout } = await $.process.run(['git', ...args])
  return exitCode === 0 ? stdout.trim() : ''
}

/** The issue the branch is for: a tracker's key, else a GitHub issue number. */
export function branchIssue(branch: string, remote: string): BranchIssue | null {
  const key = ISSUE_KEY.exec(branch)?.[1]
  if (key) return { key: key.toUpperCase(), github: null }
  const repo = GITHUB_REPO.exec(remote)?.[1]
  const number = ISSUE_NUMBER.exec(branch)?.[1]
  if (!repo || !number) return null
  const github = `${repo}#${Number(number)}`
  return { key: github, github }
}

/** What was committed since the entry started, as its note; null for nothing. */
export async function commitNote($: Api, since: string): Promise<string | null> {
  const log = await git($, 'log', `--since=${since}`, '--no-merges', '--format=%s')
  const titles = log.split('\n').filter(Boolean).reverse()
  if (titles.length === 0) return null
  return `Commits: ${titles.join('; ')}`.slice(0, NOTE_MAX)
}
