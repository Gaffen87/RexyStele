const COMMAND_TIMEOUT_MILLISECONDS = 60_000

export type CommandResult = { output: string; errorOutput: string; exitCode: number }

// Null means the command could not be started at all, as when the program is missing.
export async function runCommand(command: string[], workingDirectory: string): Promise<CommandResult | null> {
  try {
    const child = Bun.spawn(command, {
      cwd: workingDirectory,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: COMMAND_TIMEOUT_MILLISECONDS,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", NO_COLOR: "1" },
    })
    const [output, errorOutput, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { output, errorOutput, exitCode }
  } catch {
    return null
  }
}

export async function outputOf(command: string[], workingDirectory: string): Promise<string | null> {
  const result = await runCommand(command, workingDirectory)
  return result && result.exitCode === 0 ? result.output : null
}

// Returns whether the command ran and succeeded.
export async function runQuietly(command: string[], input?: string): Promise<boolean> {
  try {
    const child = Bun.spawn(command, {
      stdin: input === undefined ? "ignore" : "pipe",
      stdout: "ignore",
      stderr: "ignore",
      timeout: COMMAND_TIMEOUT_MILLISECONDS,
    })
    if (input !== undefined && child.stdin) {
      child.stdin.write(input)
      child.stdin.end()
    }
    return (await child.exited) === 0
  } catch {
    return false
  }
}
