import type { PaymentRail, ProjectDashboardOverview, ProjectPaymentRailSetting } from './api.ts'

export type PaymentRailDescriptor = {
  label: string
  rail: PaymentRail
  receivedAs: string
  setupHint: string
  shortLabel: string
  truthSource: string
}

export const paymentRailDescriptors: PaymentRailDescriptor[] = [
  {
    label: 'Zama private',
    rail: 'zama_private',
    receivedAs: 'Private cUSDT checkout',
    setupHint: 'Needs deployed private settlement and confidential token contracts.',
    shortLabel: 'Private',
    truthSource: 'PrivateCheckoutSettlement invoice finality',
  },
  {
    label: 'EVM ERC20',
    rail: 'evm_erc20',
    receivedAs: 'USDT / USDC transfer',
    setupHint: 'Needs enabled chain, token, RPC node, and receiver address.',
    shortLabel: 'ERC20',
    truthSource: 'Indexed ERC20 Transfer log',
  },
]

export function paymentRailDescriptor(rail: PaymentRail): PaymentRailDescriptor {
  return paymentRailDescriptors.find((descriptor) => descriptor.rail === rail) ?? paymentRailDescriptors[0]!
}

export function paymentRailLabel(rail: PaymentRail): string {
  return paymentRailDescriptor(rail).label
}

export function paymentRailShortLabel(rail: PaymentRail): string {
  return paymentRailDescriptor(rail).shortLabel
}

export function paymentRailTruthSource(rail: PaymentRail): string {
  return paymentRailDescriptor(rail).truthSource
}

export function projectPaymentRailSetting(
  overview: ProjectDashboardOverview,
  rail: PaymentRail,
): ProjectPaymentRailSetting {
  return (overview.paymentRails ?? []).find((setting) => setting.paymentRail === rail) ?? {
    createdAt: overview.project.createdAt,
    enabled: true,
    paymentRail: rail,
    projectId: overview.project.projectId,
    updatedAt: overview.project.updatedAt,
  }
}
