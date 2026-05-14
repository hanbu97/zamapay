import type { ProjectDashboardOverview } from './api.ts'
import { formatMinorTokenUnits, formatTokenUnits } from './amount-format.ts'

type CheckoutSession = ProjectDashboardOverview['checkoutSessions'][number]
type EvmAssetBalance = ProjectDashboardOverview['evmAssetBalances'][number]

export function formatProjectMinorUnits(value: number, overview: ProjectDashboardOverview | null) {
  return formatMinorTokenUnits(value, { symbol: projectBalanceSymbol(overview) })
}

export function formatCheckoutAmountForProject(session: CheckoutSession, overview: ProjectDashboardOverview | null) {
  if (session.paymentRail !== 'evm_erc20') {
    return formatMinorTokenUnits(session.amountMinorUnits)
  }

  const intent = overview?.evmPaymentIntents.find((paymentIntent) => paymentIntent.checkoutSessionId === session.checkoutSessionId)

  return formatTokenUnits(session.amountMinorUnits, intent?.tokenDecimals ?? 6, {
    symbol: intent?.tokenSymbol ?? sessionTokenSymbol(session, overview),
  })
}

export function formatCheckoutFeeForProject(session: CheckoutSession, overview: ProjectDashboardOverview | null) {
  const fee = session.billing?.platformFeeMinorUnits

  return typeof fee === 'number'
    ? formatMinorTokenUnits(fee, { symbol: sessionTokenSymbol(session, overview) })
    : 'not quoted'
}

export function formatEvmAssetAmount(balance: EvmAssetBalance, amountMinorUnits: number) {
  return formatTokenUnits(amountMinorUnits, balance.tokenDecimals, { symbol: balance.tokenSymbol })
}

export function projectBalanceSymbol(overview: ProjectDashboardOverview | null) {
  const symbols = new Set<string>()

  for (const session of overview?.checkoutSessions ?? []) {
    symbols.add(sessionTokenSymbol(session, overview))
  }

  for (const balance of overview?.evmAssetBalances ?? []) {
    if (hasEvmBalanceActivity(balance)) {
      symbols.add(balance.tokenSymbol)
    }
  }

  if (symbols.size === 0) {
    return 'cUSDT'
  }

  return symbols.size === 1 ? Array.from(symbols)[0] : 'stablecoin units'
}

export function sessionTokenSymbol(session: CheckoutSession, overview: ProjectDashboardOverview | null) {
  if (session.paymentRail !== 'evm_erc20') {
    return 'cUSDT'
  }

  return overview?.evmPaymentIntents.find((intent) => intent.checkoutSessionId === session.checkoutSessionId)?.tokenSymbol ?? 'ERC20'
}

function hasEvmBalanceActivity(balance: EvmAssetBalance) {
  return (
    balance.confirmedMinorUnits !== 0 ||
    balance.pendingMinorUnits !== 0 ||
    balance.exceptionMinorUnits !== 0 ||
    balance.withdrawableMinorUnits !== 0
  )
}
