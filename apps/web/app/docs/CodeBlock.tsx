"use client"

import { useMemo, useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { cn } from "@/lib/utils"

import { highlightCode, type CodeTokenKind } from "./code-highlighting"

const tokenClassName = {
  comment: "text-muted-foreground",
  command: "font-medium text-amber-700 dark:text-amber-300",
  keyword: "font-medium text-violet-700 dark:text-violet-300",
  number: "text-sky-700 dark:text-sky-300",
  operator: "text-muted-foreground",
  plain: "text-foreground",
  property: "text-blue-700 dark:text-blue-300",
  punctuation: "text-muted-foreground",
  string: "text-emerald-700 dark:text-emerald-300",
  variable: "text-rose-700 dark:text-rose-300",
} satisfies Record<CodeTokenKind, string>

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)
  const highlightedLines = useMemo(() => highlightCode(code, language), [code, language])
  const label = language ? language.toUpperCase() : "TEXT"

  function copyCode() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <figure className="group/code max-w-4xl overflow-hidden rounded-lg border bg-card shadow-sm">
      <figcaption className="flex min-h-10 items-center justify-between gap-3 border-b bg-muted/35 px-3 py-2">
        <span className="font-mono text-[0.7rem] font-medium uppercase tracking-normal text-muted-foreground">
          {label}
        </span>
        <button
          aria-label={copied ? "Code copied" : "Copy code"}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium text-muted-foreground opacity-100 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:opacity-0 md:group-hover/code:opacity-100 md:group-focus-within/code:opacity-100"
          onClick={copyCode}
          type="button"
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre className="max-h-[34rem] overflow-auto bg-[color-mix(in_oklch,var(--muted)_42%,var(--background))] p-4 text-[0.8125rem] leading-6">
        <code className="block min-w-max font-mono">
          {highlightedLines.map((line, lineIndex) => (
            <span className="block min-h-6" key={`${lineIndex}-${line.length}`}>
              {line.length > 0
                ? line.map((token, tokenIndex) => (
                    <span className={cn(tokenClassName[token.kind])} key={`${lineIndex}-${tokenIndex}`}>
                      {token.value}
                    </span>
                  ))
                : "\u00A0"}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  )
}
