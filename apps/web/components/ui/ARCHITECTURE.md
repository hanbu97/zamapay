# UI Primitive Architecture

## Tree

```text
apps/web/components/ui
|-- alert.tsx         # Notice and error surfaces
|-- avatar.tsx        # Identity marks
|-- badge.tsx         # Compact status labels
|-- breadcrumb.tsx    # Location hierarchy
|-- button-group.tsx  # Grouped commands
|-- button.tsx        # Commands and links
|-- card.tsx          # Bounded information surfaces
|-- dialog.tsx        # Modal confirmation and one-time reveal surfaces
|-- dropdown-menu.tsx # Menus and workspace actions
|-- empty.tsx         # Empty states
|-- field.tsx         # Form layout
|-- input-group.tsx   # Input adornments and composed controls
|-- input.tsx         # Text input
|-- item.tsx          # Dense list rows and workflow items
|-- label.tsx         # Form labels
|-- navigation-menu.tsx # Hover and keyboard top-level navigation disclosure
|-- progress.tsx      # Readiness and completion bars
|-- select.tsx        # Option selection
|-- separator.tsx     # Visual boundaries
|-- sheet.tsx         # Mobile/off-canvas panels
|-- sidebar.tsx       # App navigation shell
|-- skeleton.tsx      # Loading placeholders
|-- spinner.tsx       # Pending indicators
|-- table.tsx         # Structured data
|-- tabs.tsx          # Segmented content
|-- textarea.tsx      # Multiline input
`-- tooltip.tsx       # Hover disclosure
```

## Decisions

- This directory is generated and updated through `npx shadcn@latest`; manual changes should stay minimal and preserve registry compatibility.
- Primitive files own appearance, state attributes, focus behavior, modal focus traps, and accessibility defaults. They do not import merchant payment APIs.
- `card.tsx` and `dialog.tsx` consume the ZamaPay spacing tokens from `app/globals.css`, so dense merchant pages and one-time secret dialogs share one rhythm.
- The folder intentionally exceeds the normal eight-file preference because shadcn update compatibility is the stronger constraint here.
