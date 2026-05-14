import { ZamaPayInvalidRequestError } from "./errors.ts"

export const PaymentRail = {
  ZamaPrivate: "zama_private",
  EvmErc20: "evm_erc20",
} as const

export type PaymentRail = (typeof PaymentRail)[keyof typeof PaymentRail]

const PAYMENT_RAILS = new Set<string>(Object.values(PaymentRail))

export function requirePaymentRail(value: unknown): PaymentRail {
  if (typeof value !== "string" || !PAYMENT_RAILS.has(value)) {
    throw new ZamaPayInvalidRequestError("paymentRail must be one of zama_private or evm_erc20", {
      code: "invalid_payment_rail",
    })
  }

  return value as PaymentRail
}
