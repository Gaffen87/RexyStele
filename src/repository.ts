// What git knows about the directory the viewer was opened from.
import { outputOf } from "./command.ts"

export type RepositoryState = {
  // The top of the worktree the pane is in.
  directory: string
  // The repository's first worktree, where an untracked catalog usually lives.
  mainDirectory: string
  branch: string
  headCommit: string
  // The commit before the last one; the last one itself on a branch with a single commit.
  previousCommit: string
  baseBranch: string
  // The commit the branch left the base branch at.
  mergeBase: string
  commitsBehindBase: number
  commitsAheadOfBase: number
  uncommittedFileCount: number
}

const FALLBACK_BASE_BRANCHES = ["master", "main"]

async function gitLine(gitBinary: string, directory: string, gitArguments: string[]): Promise<string | undefined> {
  const output = await outputOf([gitBinary, ...gitArguments], directory)
  const line = output?.trim()
  return line ? line : undefined
}

async function findBaseBranch(gitBinary: string, directory: string, requestedBranch?: string): Promise<string | undefined> {
  const remoteHead = await gitLine(gitBinary, directory, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
  const candidates = [requestedBranch, remoteHead?.replace(/^origin\//, ""), ...FALLBACK_BASE_BRANCHES, remoteHead]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (await gitLine(gitBinary, directory, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`])) return candidate
  }
  return undefined
}

export async function readRepositoryState(
  gitBinary: string,
  workingDirectory: string,
  requestedBaseBranch?: string,
): Promise<RepositoryState | null> {
  const directory = await gitLine(gitBinary, workingDirectory, ["rev-parse", "--show-toplevel"])
  if (!directory) return null
  const [headCommit, branch, worktreeList, status, baseBranch] = await Promise.all([
    gitLine(gitBinary, directory, ["rev-parse", "HEAD"]),
    gitLine(gitBinary, directory, ["rev-parse", "--abbrev-ref", "HEAD"]),
    outputOf([gitBinary, "worktree", "list", "--porcelain"], directory),
    outputOf([gitBinary, "status", "--porcelain", "--untracked-files=no"], directory),
    findBaseBranch(gitBinary, directory, requestedBaseBranch),
  ])
  if (!headCommit || !baseBranch) return null
  const mergeBase = (await gitLine(gitBinary, directory, ["merge-base", baseBranch, "HEAD"])) ?? headCommit
  const previousCommit = (await gitLine(gitBinary, directory, ["rev-parse", "--verify", "--quiet", "HEAD~1"])) ?? headCommit
  const divergence = await gitLine(gitBinary, directory, ["rev-list", "--left-right", "--count", `${baseBranch}...HEAD`])
  const [commitsBehindBase, commitsAheadOfBase] = (divergence ?? "0 0").split(/\s+/).map(Number)
  return {
    directory,
    mainDirectory: worktreeList?.match(/^worktree (.+)$/m)?.[1] ?? directory,
    branch: branch === "HEAD" ? headCommit.slice(0, 10) : (branch ?? headCommit.slice(0, 10)),
    headCommit,
    previousCommit,
    baseBranch,
    mergeBase,
    commitsBehindBase: commitsBehindBase ?? 0,
    commitsAheadOfBase: commitsAheadOfBase ?? 0,
    uncommittedFileCount: status ? status.split("\n").filter(Boolean).length : 0,
  }
}

// Changes when the branch moves or a tracked file is edited, so the viewer knows to ask Stele again.
export async function readChangeFingerprint(gitBinary: string, directory: string): Promise<string> {
  const [headCommit, status] = await Promise.all([
    gitLine(gitBinary, directory, ["rev-parse", "HEAD"]),
    outputOf([gitBinary, "status", "--porcelain", "--untracked-files=no"], directory),
  ])
  const diffSummary = status ? await outputOf([gitBinary, "diff", "HEAD", "--shortstat"], directory) : ""
  return `${headCommit}\n${status}\n${diffSummary}`
}
