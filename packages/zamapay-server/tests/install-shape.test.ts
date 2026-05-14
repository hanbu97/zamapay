import { spawn } from "node:child_process"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

const RUN_INSTALL_SHAPE_TESTS = process.env.RUN_INSTALL_SHAPE_TESTS === "1"
const PACKAGE_ROOT = join(import.meta.dirname, "..")
const PROJECTS_ROOT = join(PACKAGE_ROOT, "test-projects")
const NPM = process.platform === "win32" ? "npm.cmd" : "npm"

const TEST_PROJECTS = ["cjs", "esm", "ts-esm", "types", "esbuild", "webhook-node"]

for (const project of TEST_PROJECTS) {
  test(`install-shape project: ${project}`, { skip: !RUN_INSTALL_SHAPE_TESTS }, async () => {
    const cwd = join(PROJECTS_ROOT, project)
    cleanProject(cwd)
    await run(NPM, ["install", "--no-package-lock", "--no-audit", "--fund=false"], cwd)
    await run(NPM, ["run", "runtestproject"], cwd)
  })
}

function cleanProject(cwd: string): void {
  for (const name of ["node_modules", "dist", "typescriptTest.js"]) {
    rmSync(join(cwd, name), { force: true, recursive: true })
  }
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (chunk) => {
      output += chunk
    })
    child.stderr.on("data", (chunk) => {
      output += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(" ")} failed in ${cwd}\n${output}`))
    })
  })
}
