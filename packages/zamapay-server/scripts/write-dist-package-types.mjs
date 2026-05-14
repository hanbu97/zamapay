import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const roots = [
  ["dist/esm", "module"],
  ["dist/cjs", "commonjs"],
]

for (const [dir, type] of roots) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ type }, null, 2)}\n`)
}
