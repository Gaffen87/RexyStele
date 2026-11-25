// Reads a Stele catalog's statements straight from its .stele files: their text, the comment
// above each one, and the file it lives in. `stele intent impact --json` leaves these out.
import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

export type StatementKind = "intent" | "definition" | "exception"

export type CatalogStatement = {
  id: string
  kind: StatementKind
  text: string
  // The id of the statement this one refines or narrows, without its file alias.
  parentId?: string
  realizedBy: string[]
  // The comment lines above the statement, where the catalog cites its sources.
  citationLines: string[]
  // The catalog file's name without its extension, such as "payroll".
  area: string
  filePath: string
  lineNumber: number
}

export type Catalog = {
  rootPath: string
  statements: Map<string, CatalogStatement>
  // The languages its symbol anchors are written in, such as "ruby".
  languages: string[]
}

const CATALOG_FILE = join("intent", "catalog.stele")
const STATEMENT_START = /^\s*(intent|definition|exception)\s+([A-Za-z0-9_]+)\s*\{/
const IMPORT_LINE = /^\s*use\s+"([^"]+)"/
const QUOTED_STRING = /"((?:[^"\\]|\\.)*)"/g

export function findCatalogPath(directories: (string | undefined)[]): string | undefined {
  for (const directory of directories) {
    if (!directory) continue
    const catalogPath = join(directory, CATALOG_FILE)
    if (existsSync(catalogPath)) return catalogPath
  }
  return undefined
}

function unescape(quoted: string): string {
  return quoted.replace(/\\(.)/g, "$1")
}

function fieldValue(blockLines: string[], fieldName: string): string | undefined {
  const fieldPattern = new RegExp(`^\\s*${fieldName}:\\s*(.*)$`)
  for (const line of blockLines) {
    const value = line.match(fieldPattern)?.[1]
    if (value !== undefined) return value.trim()
  }
  return undefined
}

function quotedStringsOf(blockLines: string[], fieldName: string): string[] {
  const startIndex = blockLines.findIndex((line) => new RegExp(`^\\s*${fieldName}:`).test(line))
  if (startIndex < 0) return []
  const collected: string[] = []
  const isList = /:\s*\[/.test(blockLines[startIndex] ?? "")
  for (const line of blockLines.slice(startIndex)) {
    for (const match of line.matchAll(QUOTED_STRING)) collected.push(unescape(match[1] ?? ""))
    if (!isList || line.includes("]")) break
  }
  return collected
}

export function parseCatalogFile(source: string, filePath: string): { statements: CatalogStatement[]; imports: string[] } {
  const lines = source.split("\n")
  const statements: CatalogStatement[] = []
  const imports: string[] = []
  const area = basename(filePath).replace(/\.stele$/, "")
  let pendingComments: string[] = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? ""
    const importedPath = line.match(IMPORT_LINE)?.[1]
    if (importedPath) {
      imports.push(importedPath)
      continue
    }
    const comment = line.match(/^\s*\/\/\s?(.*)$/)?.[1]
    if (comment !== undefined) {
      pendingComments.push(comment)
      continue
    }
    const statementStart = line.match(STATEMENT_START)
    if (!statementStart) {
      if (line.trim() !== "") pendingComments = []
      continue
    }
    const endOffset = lines.slice(lineIndex).findIndex((blockLine, offset) =>
      offset === 0 ? /\}\s*$/.test(blockLine.replace(STATEMENT_START, "")) : /^\s*\}/.test(blockLine),
    )
    const blockLength = Math.max(endOffset, 0) + 1
    const blockLines = [line.replace(STATEMENT_START, ""), ...lines.slice(lineIndex + 1, lineIndex + blockLength)]
    const parentReference = fieldValue(blockLines, "refines") ?? fieldValue(blockLines, "narrows")
    statements.push({
      id: statementStart[2] ?? "",
      kind: statementStart[1] as StatementKind,
      text: quotedStringsOf(blockLines, "text")[0] ?? "",
      parentId: parentReference?.split(".").at(-1),
      realizedBy: quotedStringsOf(blockLines, "realized_by"),
      citationLines: pendingComments,
      area,
      filePath,
      lineNumber: lineIndex + 1,
    })
    pendingComments = []
    lineIndex += blockLines.length - 1
  }
  return { statements, imports }
}

export function readCatalog(rootPath: string): Catalog {
  const statements = new Map<string, CatalogStatement>()
  const visitedPaths = new Set<string>()
  const pendingPaths = [resolve(rootPath)]
  while (pendingPaths.length > 0) {
    const filePath = pendingPaths.pop()
    if (!filePath || visitedPaths.has(filePath) || !existsSync(filePath)) continue
    visitedPaths.add(filePath)
    const parsed = parseCatalogFile(readFileSync(filePath, "utf8"), filePath)
    for (const statement of parsed.statements) statements.set(statement.id, statement)
    for (const importedPath of parsed.imports) pendingPaths.push(resolve(dirname(filePath), importedPath))
  }
  const languages = new Set<string>()
  for (const statement of statements.values()) {
    for (const anchor of statement.realizedBy) {
      const language = anchor.match(/^([a-z_]+):/)?.[1]
      if (language) languages.add(language)
    }
  }
  return { rootPath, statements, languages: [...languages].sort() }
}
