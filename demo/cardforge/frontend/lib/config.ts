export type CardForgeConfig = {
  apiBaseUrl: string
  paymentAssetSymbol: string
  paymentRail: 'evm_erc20' | 'zama_private'
  paymentRailLabel: string
  paymentRailMessage: string
  zamapayConsoleUrl: string
}

export function cardForgeConfig(): CardForgeConfig {
  const paymentRail = normalizedPaymentRail(process.env.NEXT_PUBLIC_CARDFORGE_PAYMENT_RAIL)

  return {
    apiBaseUrl: cleanBaseUrl(process.env.NEXT_PUBLIC_CARDFORGE_API_URL ?? 'http://127.0.0.1:8092'),
    paymentAssetSymbol: process.env.NEXT_PUBLIC_CARDFORGE_PAYMENT_ASSET ?? (paymentRail === 'evm_erc20' ? 'USDT' : 'cUSDT'),
    paymentRail,
    paymentRailLabel: paymentRail === 'evm_erc20' ? 'EVM ERC20' : 'Zama private',
    paymentRailMessage: paymentRail === 'evm_erc20' ? 'ERC20 settlement checkout' : 'Private cUSDT checkout',
    zamapayConsoleUrl: cleanBaseUrl(
      process.env.NEXT_PUBLIC_ZAMAPAY_CONSOLE_URL ?? 'http://127.0.0.1:3001/merchant',
    ),
  }
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizedPaymentRail(value?: string) {
  return value === 'evm_erc20' ? 'evm_erc20' : 'zama_private'
}
