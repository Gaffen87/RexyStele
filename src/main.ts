// RexyStele: shows which statements of a Stele catalog a change touches, made to run in a Rex pane.
// With --json it prints the same answer once, for scripts and for checking an install.
import packageInfo from "../package.json"
import { isFailure, readImpact } from "./impact.ts"
import { readRepositoryState } from "./repository.ts"
import { startViewer } from "./viewer.ts"

const commandArguments = process.argv.slice(2)

function optionValue(optionName: string): string | undefined {
  const optionIndex = commandArguments.indexOf(optionName)
  return optionIndex >= 0 ? commandArguments[optionIndex + 1] : undefined
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const workingDirectory = optionValue("--cwd") || process.cwd()
const gitBinary = optionValue("--git") || "git"
const steleBinary = optionValue("--stele") || "stele"
const baseBranch = optionValue("--base-branch")

if (commandArguments.includes("--version")) {
  console.log(packageInfo.version)
} else if (commandArguments.includes("--json")) {
  const repository = await readRepositoryState(gitBinary, workingDirectory, baseBranch)
  if (!repository) fail(`${workingDirectory} is not in a git repository with a base branch to compare with`)
  const impact = await readImpact(steleBinary, repository, "mergeBase")
  if (isFailure(impact)) fail(impact.failure)
  console.log(
    JSON.stringify(
      {
        branch: repository.branch,
        baseBranch: repository.baseBranch,
        mergeBase: repository.mergeBase,
        committedChangesOnly: impact.scope.committedChangesOnly,
        awaitingApprovalCount: impact.awaitingApprovalCount,
        statements: impact.statements.map((statement) => ({
          id: statement.id,
          area: statement.catalogStatement?.area,
          standing: statement.standing,
          text: statement.catalogStatement?.text,
          anchors: statement.anchors,
        })),
        unmapped: impact.unmappedSymbols,
      },
      null,
      2,
    ),
  )
  process.exit(0)
} else {
  startViewer({ workingDirectory, gitBinary, steleBinary, baseBranch, editorCommand: optionValue("--editor") })
}
