export type CardForgeConfig = {
  apiBaseUrl: string
  zamapayConsoleUrl: string
}

export function cardForgeConfig(): CardForgeConfig {
  return {
    apiBaseUrl: cleanBaseUrl(process.env.NEXT_PUBLIC_CARDFORGE_API_URL ?? 'http://127.0.0.1:8092'),
    zamapayConsoleUrl: cleanBaseUrl(
      process.env.NEXT_PUBLIC_ZAMAPAY_CONSOLE_URL ?? 'http://127.0.0.1:3001/merchant',
    ),
  }
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}
