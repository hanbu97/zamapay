import type { ComponentType } from "react"

type MarkdocComponent = ComponentType<any>
type MarkdocComponents = Record<string, MarkdocComponent> | ((name: string) => MarkdocComponent | undefined)

export function resolveDocsTagName(name: string, components: MarkdocComponents): string | MarkdocComponent {
  if (typeof components === "function") {
    return components(name) ?? name
  }

  return Object.prototype.hasOwnProperty.call(components, name) ? components[name] : name
}
