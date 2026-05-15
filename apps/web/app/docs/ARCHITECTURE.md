# Docs Route Architecture

## Tree

```text
apps/web/app/docs
|-- layout.tsx          # Public docs shell with shared marketing header, footer, and navbar-aware content spacing
|-- page.tsx            # Docs index grouped from Markdoc frontmatter metadata
|-- DocsArticle.tsx     # Server-rendered Markdoc article renderer, callouts, figures, tables, Mermaid fences, and code blocks
|-- CodeBlock.tsx       # Client code block surface with copy, theme-aware chrome, and lightweight syntax highlighting
|-- MermaidDiagram.tsx  # Client renderer that dynamically loads Mermaid for docs diagrams
|-- code-highlighting.ts # Dependency-free tokenizer for common docs snippets
|-- docs-content.ts     # Server-side Markdoc loader for docs/content/public/*.md; no prose lives here
|-- markdoc-rendering.ts # Markdoc React renderer glue for mapping every tag, including lowercase HTML tags, to local components
|-- request-origin.ts   # Host/proxy-aware origin helper for generated AI-readable URLs
|-- manifest.json/route.ts # AI-readable docs manifest generated from the same Markdoc source
`-- [slug]/
    |-- page.tsx         # Static docs article route selected by Markdoc slug
    |-- markdown/route.ts # Internal per-guide Markdown route, exposed externally by /docs/{slug}.md rewrite
    `-- ARCHITECTURE.md  # Dynamic article route note
```

## Decisions

- Public docs prose is single-source under `docs/content/public/*.md`. TypeScript may parse and render it, but must not duplicate article copy.
- `docs-content.ts` is a server-side content loader: it reads frontmatter, validates Markdoc tags, extracts h2 anchors, maps icon keys, and exposes route metadata, AI-readable docs output, plus task/capability navigation.
- `/docs/manifest.json` and rewritten `/docs/{slug}.md` are machine-readable surfaces for coding agents; they stay dynamic so absolute URLs follow the current host instead of a build-time origin.
- `/docs` follows a Stripe-style docs home shape: start with user goals, expose top stage categories, then browse by capability.
- The docs route uses the same public marketing footer as the homepage. Docs pages own content only; the layout owns the shared header, bottom breathing room, and footer.
- Top navigation, docs home, and article sidebars all consume the same grouped docs model; page lists must not be re-flattened in individual components.
- Article pages render Markdoc on the server. Only Mermaid diagrams cross into a client component.
- `markdoc-rendering.ts` owns the renderer boundary because Markdoc's default React resolver maps only capitalized component names; docs must route lowercase tags like `pre`, `p`, and `table` through the same component table.
- Markdoc fences keep code examples in Markdown. `mermaid` fences render through `MermaidDiagram`; other fences render through `CodeBlock` with copy, horizontal scroll, and dependency-free highlighting.
- `code-highlighting.ts` is intentionally small and local. It highlights the languages we document today without adding a heavy runtime syntax dependency to the public docs path.
- Custom Markdoc tags are intentionally narrow: `figure` for fixed product diagrams and `callout` for operational warnings or notes.
- Webhook docs use the public Svix-style HMAC contract only; retired operator dispatch headers and replayable signing material stay out of browser docs.
- Server SDK docs describe only the Node backend preview package, keep `@zamapay/server/webhooks` as a subpath, and require explicit `paymentRail` in every checkout example.
- CardForge docs remain a Rust raw HTTP baseline, not TypeScript SDK dogfood.
