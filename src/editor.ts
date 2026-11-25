// Turns the editor setting into the command that opens a file at a line.
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

type EditorPreset = {
  // The editor's command-line launcher, and its arguments with {file} and {line} to fill in.
  launcher: string
  launcherArguments: string[]
  // The macOS app to start when the launcher is not installed.
  macApplication?: string
}

export const EDITOR_PRESETS: Record<string, EditorPreset> = {
  rubymine: { launcher: "rubymine", launcherArguments: ["--line", "{line}", "{file}"], macApplication: "RubyMine" },
  idea: { launcher: "idea", launcherArguments: ["--line", "{line}", "{file}"], macApplication: "IntelliJ IDEA" },
  webstorm: { launcher: "webstorm", launcherArguments: ["--line", "{line}", "{file}"], macApplication: "WebStorm" },
  vscode: { launcher: "code", launcherArguments: ["--goto", "{file}:{line}"], macApplication: "Visual Studio Code" },
  cursor: { launcher: "cursor", launcherArguments: ["--goto", "{file}:{line}"], macApplication: "Cursor" },
  zed: { launcher: "zed", launcherArguments: ["{file}:{line}"], macApplication: "Zed" },
  sublime: { launcher: "subl", launcherArguments: ["{file}:{line}"], macApplication: "Sublime Text" },
}

const FILE_OPENER = process.platform === "darwin" ? "open" : "xdg-open"
// A pane's PATH may lack the directories launchers are usually installed in.
const LAUNCHER_DIRECTORIES = [join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]

function filled(words: string[], filePath: string, lineNumber: number): string[] {
  return words.map((word) => word.replaceAll("{file}", filePath).replaceAll("{line}", String(lineNumber)))
}

function findLauncher(launcher: string): string | undefined {
  const onPath = Bun.which(launcher)
  if (onPath) return onPath
  return LAUNCHER_DIRECTORIES.map((directory) => join(directory, launcher)).find((candidate) => existsSync(candidate))
}

// The setting is the name of a preset, such as "rubymine", or a whole command with {file}
// and {line} in it. Without a setting the file opens in the system's default app.
export function editorCommandFor(
  editorSetting: string | undefined,
  filePath: string,
  lineNumber: number,
  launcherFinder: (launcher: string) => string | undefined = findLauncher,
  platform: string = process.platform,
): string[] {
  const setting = editorSetting?.trim()
  if (!setting) return [FILE_OPENER, filePath]
  const preset = EDITOR_PRESETS[setting.toLowerCase()]
  if (!preset) return filled(setting.split(/\s+/), filePath, lineNumber)
  const launcherPath = launcherFinder(preset.launcher)
  if (launcherPath) return [launcherPath, ...filled(preset.launcherArguments, filePath, lineNumber)]
  if (platform === "darwin" && preset.macApplication) {
    return ["open", "-na", preset.macApplication, "--args", ...filled(preset.launcherArguments, filePath, lineNumber)]
  }
  return [preset.launcher, ...filled(preset.launcherArguments, filePath, lineNumber)]
}
