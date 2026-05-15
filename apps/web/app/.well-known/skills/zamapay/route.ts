import fs from "node:fs"
import path from "node:path"

export const dynamic = "force-static"

export function GET() {
  const root = repoRoot()
  const skill = fs.readFileSync(path.join(root, "skills", "zamapay", "SKILL.md"), "utf8")
  return new Response(skill, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
    },
  })
}

function repoRoot(): string {
  return process.cwd().endsWith(path.join("apps", "web")) ? path.resolve(process.cwd(), "../..") : process.cwd()
}
