# Documentation Content Architecture

## Tree

```text
docs/content
|-- ARCHITECTURE.md       # This content-boundary note
`-- public/
    |-- quickstart.md
    |-- development.md
    |-- server-sdk-preview.md
    |-- raw-http-fallback.md
    |-- payment-rails.md
    |-- api-reference.md
    |-- webhooks.md
    |-- examples.md
    |-- cardforge.md
    |-- private-checkout-v1.md
    `-- environments.md
```

## Decisions

- `public/*.md` is the single source of truth for public docs copy. The Next.js app reads these files directly through Markdoc.
- `/llms.txt`, `/llms-full.txt`, `/docs/{slug}.md`, and `/docs/manifest.json` are generated from this same source; do not add separate AI-doc copies.
- Frontmatter owns title, description, badge, icon key, group, order, and featured state. Filenames own slugs.
- Level-two headings own article anchors and the in-page section nav. Use explicit Markdoc ids when the generated slug would be unclear.
- Public docs explain merchant-facing contracts only. Internal runbooks under `docs/runbooks` own operator recovery details, deeper environment setup, and implementation status.
- Deprecated multi-export credential bundles must not reappear here; merchant-facing setup starts from `ZAMAPAY_SECRET_KEY` plus deployment-level `ZAMAPAY_API_URL`.
