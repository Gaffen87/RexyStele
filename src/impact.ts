// Asks Stele which catalog statements a change touches, and joins the answer with the catalog.
import { dirname } from "node:path"
import { findCatalogPath, readCatalog, type Catalog, type CatalogStatement } from "./catalog.ts"
import { runCommand } from "./command.ts"
import type { RepositoryState } from "./repository.ts"

export type AnchorChange = {
  anchor: string
  change: string
  location: string
}

export type TouchedStatement = {
  id: string
  kind: string
  standing: string
  anchors: AnchorChange[]
  // Missing when the catalog file could not be read for this id.
  catalogStatement?: CatalogStatement
}

export type BaseChoice = "mergeBase" | "lastCommit" | "uncommitted"

export type ImpactScope = {
  baseChoice: BaseChoice
  baseCommit: string
  // Undefined compares with the working tree, uncommitted changes included.
  headCommit?: string
  // True when the catalog sits in another worktree, so only commits can be compared.
  committedChangesOnly: boolean
}

export type Impact = {
  scope: ImpactScope
  catalog: Catalog
  statements: TouchedStatement[]
  unmappedSymbols: string[]
  awaitingApprovalCount: number
}

export type ImpactFailure = { failure: string }

type ImpactJson = {
  statements?: { id: string; kind: string; standing: string; anchors?: AnchorChange[] }[]
  unmapped?: string[]
}

export function availableBaseChoices(catalogIsInWorktree: boolean): BaseChoice[] {
  return catalogIsInWorktree ? ["mergeBase", "lastCommit", "uncommitted"] : ["mergeBase", "lastCommit"]
}

export function scopeFor(repository: RepositoryState, baseChoice: BaseChoice, catalogIsInWorktree: boolean): ImpactScope {
  // Full commit ids, because Stele reads a revision in the catalog's repository, whose HEAD
  // is another branch when the catalog sits in the main worktree.
  const baseCommit =
    baseChoice === "mergeBase"
      ? repository.mergeBase
      : baseChoice === "lastCommit"
        ? repository.previousCommit
        : repository.headCommit
  return {
    baseChoice,
    baseCommit,
    headCommit: catalogIsInWorktree ? undefined : repository.headCommit,
    committedChangesOnly: !catalogIsInWorktree,
  }
}

function areaOrder(statement: TouchedStatement): string {
  return `${statement.catalogStatement?.area ?? "~"}\n${statement.id}`
}

export function countAwaitingApproval(reportMarkdown: string): number {
  const awaitingSection = reportMarkdown.split(/^## Awaiting approval$/m)[1]?.split(/^## /m)[0] ?? ""
  return awaitingSection.split("\n").filter((line) => line.startsWith("- `")).length
}

async function readAwaitingApprovalCount(steleBinary: string, repository: RepositoryState, catalog: Catalog): Promise<number> {
  const languageArguments = catalog.languages.flatMap((language) => ["--language", language])
  const report = await runCommand(
    [steleBinary, "intent", "report", "--catalog", catalog.rootPath, ...languageArguments],
    dirname(dirname(catalog.rootPath)),
  )
  return report ? countAwaitingApproval(report.output) : 0
}

export async function readImpact(
  steleBinary: string,
  repository: RepositoryState,
  baseChoice: BaseChoice,
): Promise<Impact | ImpactFailure> {
  const catalogPath = findCatalogPath([repository.directory, repository.mainDirectory])
  if (!catalogPath) {
    return { failure: "No Stele catalog here: intent/catalog.stele is missing from this worktree and the main one." }
  }
  const catalogIsInWorktree = catalogPath.startsWith(`${repository.directory}/`)
  const catalog = readCatalog(catalogPath)
  const scope = scopeFor(repository, baseChoice, catalogIsInWorktree)
  const steleCommand = [steleBinary, "intent", "impact", scope.baseCommit]
  if (scope.headCommit) steleCommand.push(scope.headCommit)
  steleCommand.push("--json", "--catalog", catalogPath)

  const [impactResult, awaitingApprovalCount] = await Promise.all([
    runCommand(steleCommand, repository.directory),
    readAwaitingApprovalCount(steleBinary, repository, catalog),
  ])
  if (!impactResult) return { failure: `Could not run ${steleBinary}. Is Stele installed?` }
  if (impactResult.exitCode !== 0) {
    return { failure: impactResult.errorOutput.trim().split("\n").slice(0, 6).join("\n") || "stele intent impact failed" }
  }
  let impactJson: ImpactJson
  try {
    impactJson = JSON.parse(impactResult.output) as ImpactJson
  } catch {
    return { failure: "stele intent impact did not print JSON. Update Stele." }
  }
  const statements = (impactJson.statements ?? [])
    .map((statement) => ({
      ...statement,
      anchors: statement.anchors ?? [],
      catalogStatement: catalog.statements.get(statement.id),
    }))
    .sort((first, second) => areaOrder(first).localeCompare(areaOrder(second)))
  return { scope, catalog, statements, unmappedSymbols: impactJson.unmapped ?? [], awaitingApprovalCount }
}

export function isFailure(result: Impact | ImpactFailure): result is ImpactFailure {
  return "failure" in result
}
