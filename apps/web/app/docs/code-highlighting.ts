export type CodeTokenKind =
  | "comment"
  | "command"
  | "keyword"
  | "number"
  | "operator"
  | "plain"
  | "property"
  | "punctuation"
  | "string"
  | "variable"

export type CodeToken = {
  kind: CodeTokenKind
  value: string
}

type Pattern = {
  kind: CodeTokenKind
  regex: RegExp
}

const bashCommands = ["cargo", "curl", "docker", "export", "git", "just", "mise", "node", "npm"]
const jsKeywords = [
  "async",
  "await",
  "catch",
  "const",
  "export",
  "false",
  "function",
  "if",
  "import",
  "let",
  "new",
  "null",
  "return",
  "throw",
  "true",
  "type",
]

export function highlightCode(code: string, language?: string): CodeToken[][] {
  const normalized = normalizeLanguage(language)
  const source = code.replace(/\n$/, "")

  return source.split("\n").map((line) => tokenizeLine(line, normalized))
}

function normalizeLanguage(language?: string) {
  return (language ?? "").trim().toLowerCase()
}

function tokenizeLine(line: string, language: string): CodeToken[] {
  if (language === "bash" || language === "sh" || language === "shell") {
    return tokenizeWithPatterns(line, bashPatterns())
  }

  if (language === "http") {
    return tokenizeWithPatterns(line, httpPatterns())
  }

  if (language === "json") {
    return tokenizeWithPatterns(line, jsonPatterns())
  }

  if (["javascript", "js", "ts", "tsx", "typescript"].includes(language)) {
    return tokenizeWithPatterns(line, jsPatterns())
  }

  return tokenizeWithPatterns(line, genericPatterns())
}

function tokenizeWithPatterns(line: string, patterns: Pattern[]): CodeToken[] {
  const tokens: CodeToken[] = []
  let index = 0

  while (index < line.length) {
    const segment = line.slice(index)
    const match = patterns.map((pattern) => [pattern, segment.match(pattern.regex)] as const).find(([, result]) => result)

    if (!match?.[1]) {
      tokens.push({ kind: "plain", value: segment[0] ?? "" })
      index += 1
      continue
    }

    const [pattern, result] = match
    tokens.push({ kind: pattern.kind, value: result[0] })
    index += result[0].length
  }

  return tokens
}

function bashPatterns(): Pattern[] {
  return [
    { kind: "plain", regex: /^\s+/ },
    { kind: "comment", regex: /^#.*/ },
    { kind: "string", regex: /^"(?:\\.|[^"])*"|^'(?:\\.|[^'])*'/ },
    { kind: "variable", regex: /^\$\{?[A-Za-z_][\w]*\}?/ },
    { kind: "command", regex: new RegExp(`^(${bashCommands.join("|")})\\b`) },
    { kind: "keyword", regex: /^--?[A-Za-z0-9][\w-]*/ },
    { kind: "number", regex: /^\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", regex: /^[=|&;]+/ },
    { kind: "punctuation", regex: /^[{}()[\],.:/<>+-]/ },
    { kind: "plain", regex: /^[A-Za-z_][\w.-]*/ },
  ]
}

function httpPatterns(): Pattern[] {
  return [
    { kind: "plain", regex: /^\s+/ },
    { kind: "keyword", regex: /^(GET|POST|PUT|PATCH|DELETE|HTTP\/\d(?:\.\d)?)/ },
    { kind: "property", regex: /^[A-Za-z0-9-]+(?=:)/ },
    { kind: "string", regex: /^"(?:\\.|[^"])*"|^'(?:\\.|[^'])*'/ },
    { kind: "number", regex: /^\b\d+(?:\.\d+)?\b/ },
    { kind: "punctuation", regex: /^[{}()[\],.:/<>+-]/ },
    { kind: "plain", regex: /^[^\s{}()[\],.:/<>+-]+/ },
  ]
}

function jsonPatterns(): Pattern[] {
  return [
    { kind: "plain", regex: /^\s+/ },
    { kind: "property", regex: /^"(?:\\.|[^"])*"(?=\s*:)/ },
    { kind: "string", regex: /^"(?:\\.|[^"])*"/ },
    { kind: "keyword", regex: /^(true|false|null)\b/ },
    { kind: "number", regex: /^-?\b\d+(?:\.\d+)?\b/ },
    { kind: "punctuation", regex: /^[{}()[\],.:]/ },
  ]
}

function jsPatterns(): Pattern[] {
  return [
    { kind: "plain", regex: /^\s+/ },
    { kind: "comment", regex: /^\/\/.*|^\/\*.*?\*\// },
    { kind: "string", regex: /^`(?:\\.|[^`])*`|^"(?:\\.|[^"])*"|^'(?:\\.|[^'])*'/ },
    { kind: "keyword", regex: new RegExp(`^(${jsKeywords.join("|")})\\b`) },
    { kind: "property", regex: /^[A-Za-z_$][\w$]*(?=\s*:)/ },
    { kind: "number", regex: /^\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", regex: /^[=!<>]=?|^[+*/%-]/ },
    { kind: "punctuation", regex: /^[{}()[\],.:;]/ },
    { kind: "plain", regex: /^[A-Za-z_$][\w$]*/ },
  ]
}

function genericPatterns(): Pattern[] {
  return [
    { kind: "plain", regex: /^\s+/ },
    { kind: "comment", regex: /^#.*/ },
    { kind: "string", regex: /^"(?:\\.|[^"])*"|^'(?:\\.|[^'])*'/ },
    { kind: "number", regex: /^\b\d+(?:\.\d+)?\b/ },
    { kind: "punctuation", regex: /^[{}()[\],.:/<>+-]/ },
    { kind: "plain", regex: /^[^\s{}()[\],.:/<>+-]+/ },
  ]
}
