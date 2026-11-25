import { expect, test } from "bun:test"
import { parseCatalogFile } from "./catalog.ts"
import { hunksTouching, parseAnchor, parseHunks, parseLocation } from "./diff.ts"
import { countAwaitingApproval, type Impact, type TouchedStatement } from "./impact.ts"
import type { RepositoryState } from "./repository.ts"
import { displayWidth } from "./text.ts"
import { buildRows, renderScreen, scrollOffsetFor, type ViewerState } from "./view.ts"

const CATALOG_SOURCE = `catalog marketplace {
  use "./scheduling.stele" as core

  // from app/models/shift_bid.rb, withdraw;
  // test/models/shift_bid_test.rb:133
  definition only_a_pending_bid_can_be_withdrawn {
    refines: core.open_shifts_find_takers
    realized_by: [
      "ruby:app/models/shift_bid.rb#ShiftBid::withdraw",
      "app/models/shift_bid.rb"
    ]
    text: "Withdrawing a bid removes it only while it is still \\"pending\\"."
  }

  // inferred
  intent open_shifts_find_takers { text: "Open shifts find takers." }
}
`

const FILE_DIFF = `diff --git a/app/models/shift_bid.rb b/app/models/shift_bid.rb
index 5a40de8..b499621 100644
--- a/app/models/shift_bid.rb
+++ b/app/models/shift_bid.rb
@@ -24,6 +24,10 @@ class ShiftBid
   end
 
+  def self.take_back_from(employee)
+    reopen_declined
+  end
+
   def self.revoke_for(employee)
@@ -80,3 +84,3 @@ class ShiftBid
   def withdraw
-    destroy
+    delete
   end
`

function repositoryState(overrides: Partial<RepositoryState> = {}): RepositoryState {
  return {
    directory: "/work/app",
    mainDirectory: "/work/app",
    branch: "feature/reopen-bids",
    headCommit: "5d0cb0097a1c189bff57ab22e8252683c5ad89a4",
    previousCommit: "8d0e7b697c7fe3b314e96bedadb3ebf0737aa17d",
    baseBranch: "master",
    mergeBase: "8d0e7b697c7fe3b314e96bedadb3ebf0737aa17d",
    commitsBehindBase: 3,
    commitsAheadOfBase: 1,
    uncommittedFileCount: 2,
    ...overrides,
  }
}

function stateWith(statementCount: number, overrides: Partial<ViewerState> = {}): ViewerState {
  const parsed = parseCatalogFile(CATALOG_SOURCE, "/work/app/intent/marketplace.stele")
  const catalogStatements = new Map(parsed.statements.map((statement) => [statement.id, statement]))
  const statements: TouchedStatement[] = Array.from({ length: statementCount }, (_unused, statementIndex) => ({
    id: statementIndex === 0 ? "only_a_pending_bid_can_be_withdrawn" : `statement_number_${statementIndex}_with_a_rather_long_identifier`,
    kind: "definition",
    standing: statementIndex === 1 ? "unapproved" : "unverified",
    anchors: [
      {
        anchor: "ruby:app/models/shift_bid.rb#ShiftBid::withdraw",
        change: statementIndex % 2 === 0 ? "removed" : "changed",
        location: "app/models/shift_bid.rb:80-82",
      },
    ],
    catalogStatement: statementIndex === 0 ? catalogStatements.get("only_a_pending_bid_can_be_withdrawn") : undefined,
  }))
  const impact: Impact = {
    scope: { baseChoice: "mergeBase", baseCommit: "8d0e7b69", headCommit: "5d0cb009", committedChangesOnly: true },
    catalog: { rootPath: "/work/app/intent/catalog.stele", statements: catalogStatements, languages: ["ruby"] },
    statements,
    unmappedSymbols: ["ruby:app/models/shift_bid.rb#ShiftBid::self.take_back_from 🙂"],
    awaitingApprovalCount: 1,
  }
  return {
    repository: repositoryState(),
    impact,
    failure: null,
    isLoading: false,
    rows: buildRows(impact),
    selectedRowIndex: 0,
    detailScrollOffset: 0,
    hunksByFile: new Map([["app/models/shift_bid.rb", parseHunks(FILE_DIFF)]]),
    statusMessage: "updated 10:00",
    ...overrides,
  }
}

test("reads a statement's text, parent, anchors and the comment above it", () => {
  const { statements, imports } = parseCatalogFile(CATALOG_SOURCE, "/work/app/intent/marketplace.stele")
  expect(imports).toEqual(["./scheduling.stele"])
  expect(statements.map((statement) => statement.id)).toEqual([
    "only_a_pending_bid_can_be_withdrawn",
    "open_shifts_find_takers",
  ])
  const definition = statements[0]!
  expect(definition.kind).toBe("definition")
  expect(definition.area).toBe("marketplace")
  expect(definition.parentId).toBe("open_shifts_find_takers")
  expect(definition.text).toBe('Withdrawing a bid removes it only while it is still "pending".')
  expect(definition.realizedBy).toEqual(["ruby:app/models/shift_bid.rb#ShiftBid::withdraw", "app/models/shift_bid.rb"])
  expect(definition.citationLines).toEqual(["from app/models/shift_bid.rb, withdraw;", "test/models/shift_bid_test.rb:133"])
  expect(definition.lineNumber).toBe(6)
  expect(statements[1]!.text).toBe("Open shifts find takers.")
  expect(statements[1]!.citationLines).toEqual(["inferred"])
})

test("keeps only the hunks that touch a symbol's lines, on either side of the change", () => {
  const hunks = parseHunks(FILE_DIFF)
  expect(hunks.map((hunk) => [hunk.oldStart, hunk.oldLineCount, hunk.newStart, hunk.newLineCount])).toEqual([
    [24, 6, 24, 10],
    [80, 3, 84, 3],
  ])
  expect(hunksTouching(hunks, { firstLine: 80, lastLine: 82 })).toEqual([hunks[1]!])
  expect(hunksTouching(hunks, { firstLine: 26, lastLine: 28 })).toEqual([hunks[0]!])
  expect(hunksTouching(hunks, { firstLine: 40, lastLine: 60 })).toEqual([])
  expect(hunksTouching(hunks, undefined)).toEqual(hunks)
})

test("reads locations and anchors as files, lines and symbols", () => {
  expect(parseLocation("app/models/shift.rb:29-31")).toEqual({
    filePath: "app/models/shift.rb",
    range: { firstLine: 29, lastLine: 31 },
  })
  expect(parseLocation("app/models/shift.rb")).toEqual({ filePath: "app/models/shift.rb" })
  expect(parseAnchor("ruby:app/models/shift.rb#Shift::self.close")).toEqual({
    filePath: "app/models/shift.rb",
    symbol: "Shift::self.close",
  })
  expect(parseAnchor("ruby:file:app/models/shift.rb").filePath).toBe("app/models/shift.rb")
  expect(parseAnchor("app/models/shift.rb")).toEqual({ filePath: "app/models/shift.rb", symbol: undefined })
})

test("counts the statements a report lists as awaiting approval", () => {
  const report = "# Intent report\n\n## Awaiting approval\n\n### Definitions\n\n- `one`: never approved\n- `two`: never approved\n\n## Statements\n\n- `three`\n"
  expect(countAwaitingApproval(report)).toBe(2)
  expect(countAwaitingApproval("## Awaiting approval\n\nNothing awaits approval.\n\n## Statements\n")).toBe(0)
})

test("draws every line at exactly the terminal's width", () => {
  for (const [width, height] of [[80, 24], [100, 30], [140, 40], [220, 60], [50, 12]] as const) {
    for (const selectedRowIndex of [0, 1, 3]) {
      const { lines } = renderScreen(stateWith(3, { selectedRowIndex }), width, height)
      expect(lines.length).toBe(height)
      for (const line of lines) expect(displayWidth(line)).toBe(width)
    }
  }
})

test("shows the statement's text, its changed code and the header facts", () => {
  const screen = renderScreen(stateWith(2), 140, 40).lines.join("\n")
  expect(screen).toContain("feature/reopen-bids ← master, 3 behind")
  expect(screen).toContain("2 touched")
  expect(screen).toContain("1 to approve")
  expect(screen).toContain("commits only, 2 uncommitted files left out")
  expect(screen).toContain("Withdrawing a bid removes it only while it is still")
  expect(screen).toContain("refines open_shifts_find_takers")
  expect(screen).toContain("test/models/shift_bid_test.rb:133")
  expect(screen).toContain("-    destroy")
  expect(screen).toContain("+    delete")
  expect(screen).not.toContain("take_back_from(employee)")
})

test("shows unmapped code with its whole file diff", () => {
  const state = stateWith(1)
  const screen = renderScreen({ ...state, selectedRowIndex: state.rows.length - 1 }, 140, 40).lines.join("\n")
  expect(screen).toContain("No statement in the catalog maps this code")
  expect(screen).toContain("+  def self.take_back_from(employee)")
})

test("says so when nothing is touched, when Stele is still asked, and when it failed", () => {
  const untouched = stateWith(0)
  untouched.impact!.unmappedSymbols = []
  untouched.rows = []
  expect(renderScreen(untouched, 120, 30).lines.join("\n")).toContain("touches no statement in the catalog")
  expect(renderScreen({ ...untouched, isLoading: true }, 120, 30).lines.join("\n")).toContain("Asking Stele")
  const failed = renderScreen({ ...untouched, impact: null, failure: "No Stele catalog here" }, 120, 30).lines.join("\n")
  expect(failed).toContain("No Stele catalog here")
  expect(failed).toContain("Problem")
})

test("asks for a larger pane when it is too small", () => {
  expect(renderScreen(stateWith(1), 30, 8).lines).toEqual(["RexyStele needs a larger pane"])
})

test("keeps the selected line in view", () => {
  expect(scrollOffsetFor(0, 30, 10)).toBe(0)
  expect(scrollOffsetFor(15, 30, 10)).toBe(10)
  expect(scrollOffsetFor(29, 30, 10)).toBe(20)
})

test("opens a file in a named editor, a command of your own, or the default app", () => {
  const { editorCommandFor } = require("./editor.ts") as typeof import("./editor.ts")
  const installed = (launcher: string) => `/usr/local/bin/${launcher}`
  const missing = () => undefined
  expect(editorCommandFor("rubymine", "/work/app/shift.rb", 29, installed)).toEqual([
    "/usr/local/bin/rubymine", "--line", "29", "/work/app/shift.rb",
  ])
  expect(editorCommandFor("RubyMine", "/work/app/shift.rb", 29, missing, "darwin")).toEqual([
    "open", "-na", "RubyMine", "--args", "--line", "29", "/work/app/shift.rb",
  ])
  expect(editorCommandFor("vscode", "/work/my app/shift.rb", 3, installed)).toEqual([
    "/usr/local/bin/code", "--goto", "/work/my app/shift.rb:3",
  ])
  expect(editorCommandFor("nvim +{line} {file}", "/work/app/shift.rb", 7, missing)).toEqual([
    "nvim", "+7", "/work/app/shift.rb",
  ])
  expect(editorCommandFor(undefined, "/work/app/shift.rb", 7, missing)[1]).toBe("/work/app/shift.rb")
})
