// Cuts a file's unified diff down to the hunks that touch one mapped piece of code.

export type DiffHunk = {
  oldStart: number
  oldLineCount: number
  newStart: number
  newLineCount: number
  // The hunk's header and body, as git printed them.
  lines: string[]
}

export type LineRange = { firstLine: number; lastLine: number }

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parseHunks(fileDiff: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  for (const line of fileDiff.split("\n")) {
    const header = line.match(HUNK_HEADER)
    if (header) {
      hunks.push({
        oldStart: Number(header[1]),
        oldLineCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLineCount: header[4] === undefined ? 1 : Number(header[4]),
        lines: [line],
      })
    } else if (hunks.length > 0 && line !== "\\ No newline at end of file") {
      hunks.at(-1)?.lines.push(line)
    }
  }
  for (const hunk of hunks) {
    while (hunk.lines.length > 1 && hunk.lines.at(-1) === "") hunk.lines.pop()
  }
  return hunks
}

function overlaps(start: number, lineCount: number, range: LineRange): boolean {
  const lastLine = start + Math.max(lineCount, 1) - 1
  return start <= range.lastLine && lastLine >= range.firstLine
}

// Stele gives a symbol's lines without saying whether they count in the old or the new file,
// so a hunk is kept when it touches the range on either side.
export function hunksTouching(hunks: DiffHunk[], range: LineRange | undefined): DiffHunk[] {
  if (!range) return hunks
  return hunks.filter(
    (hunk) => overlaps(hunk.oldStart, hunk.oldLineCount, range) || overlaps(hunk.newStart, hunk.newLineCount, range),
  )
}

// "app/models/shift.rb:29-31" names a file and lines; a bare path names the whole file.
export function parseLocation(location: string): { filePath: string; range?: LineRange } {
  const withLines = location.match(/^(.*):(\d+)(?:-(\d+))?$/)
  if (!withLines) return { filePath: location }
  const firstLine = Number(withLines[2])
  return { filePath: withLines[1] ?? location, range: { firstLine, lastLine: Number(withLines[3] ?? firstLine) } }
}

// "ruby:app/models/shift.rb#Shift::close" is a symbol in a file; "ruby:file:app/x.rb" and a
// bare path are files.
export function parseAnchor(anchor: string): { filePath: string; symbol?: string } {
  const withoutLanguage = anchor.replace(/^[a-z_]+:(?:file:)?(?=[^/]*[/.])/, "")
  const [filePath, symbol] = withoutLanguage.split("#", 2)
  return { filePath: filePath ?? anchor, symbol }
}
