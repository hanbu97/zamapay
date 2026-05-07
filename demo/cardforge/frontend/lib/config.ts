export type CardForgeConfig = {
  apiBaseUrl: string
  mermerConsoleUrl: string
}

export function cardForgeConfig(): CardForgeConfig {
  return {
    apiBaseUrl: cleanBaseUrl(process.env.NEXT_PUBLIC_CARDFORGE_API_URL ?? 'http://127.0.0.1:8092'),
    mermerConsoleUrl: cleanBaseUrl(
      process.env.NEXT_PUBLIC_MERMER_PAY_CONSOLE_URL ?? 'http://127.0.0.1:3001/merchant',
    ),
  }
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}
