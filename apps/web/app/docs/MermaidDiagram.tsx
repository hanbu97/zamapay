"use client"

import { useEffect, useId, useState } from "react"

type MermaidDiagramProps = {
  chart: string
}

type MermaidState =
  | {
      error: null
      svg: string
    }
  | {
      error: string
      svg: null
    }

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const [state, setState] = useState<MermaidState>({ error: null, svg: "" })

  useEffect(() => {
    let cancelled = false

    async function renderChart() {
      try {
        const mermaid = (await import("mermaid")).default

        mermaid.initialize({
          fontFamily: "var(--font-sans)",
          securityLevel: "strict",
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            background: "transparent",
            lineColor: "#737373",
            primaryBorderColor: "#d4d4d4",
            primaryColor: "#f7f7f7",
            primaryTextColor: "#171717",
            secondaryColor: "#ffffff",
            tertiaryColor: "#fafafa",
          },
        })

        const result = await mermaid.render(`zamapay-docs-${id}`, chart)

        if (!cancelled) {
          setState({ error: null, svg: result.svg })
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            error: error instanceof Error ? error.message : "Could not render Mermaid diagram.",
            svg: null,
          })
        }
      }
    }

    void renderChart()

    return () => {
      cancelled = true
    }
  }, [chart, id])

  if (state.error) {
    return (
      <pre className="mt-5 max-w-full overflow-x-auto rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-xs leading-6 text-destructive">
        {state.error}
      </pre>
    )
  }

  return (
    <div className="mt-5 overflow-x-auto rounded-lg border bg-muted/30 p-4">
      {state.svg ? (
        <div
          className="[&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      ) : (
        <div className="text-sm text-muted-foreground">Rendering diagram...</div>
      )}
    </div>
  )
}
