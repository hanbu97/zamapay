import { bytesToHex, getAddress } from 'viem'
import { getInvoiceRecord, type PaymentRail } from '@/lib/api'
import { ensureEthereumProvider } from '@/lib/wallet'
import type { HexAddress, HexValue } from './evm-funding'

export function ensureHexAddress(address: string | null, label: string): HexAddress {
  if (!address) {
    throw new Error(`${label} is not deployed in the contract manifest.`)
  }

  try {
    return getAddress(address) as HexAddress
  } catch {
    throw new Error(`${label} is not a valid EVM address.`)
  }
}

export function readableError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : 'Payment failed.'

  if (message.includes('User rejected')) {
    return 'Wallet request was rejected. Confirm the next wallet prompt to continue.'
  }

  const revertReason = message.match(/reverted with the following reason:\s*([^\n]+)/i)
  if (revertReason?.[1]) {
    return revertReason[1].trim()
  }

  const firstLine = message.split('\n')[0]?.trim() || message
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine
}

export function isPaymentComplete(paymentTruth: string, finalityStatus: string) {
  return paymentTruth === 'paid' || finalityStatus === 'finality_safe'
}

export function initialPaymentStatus(paymentTruth: string, finalityStatus: string, paymentRail: PaymentRail) {
  if (isPaymentComplete(paymentTruth, finalityStatus)) {
    return 'Payment complete.'
  }

  return paymentRail === 'evm_erc20'
    ? 'Choose the best ERC20 funding method and pay through the settlement contract.'
    : 'Confirm the private payment with your wallet.'
}

export async function projectFinalizedPayment(input: { chainInvoiceId: number; paymentTxHash?: HexValue }) {
  const response = await fetch('/api/checkout/project-finalized-payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(parseProjectionError(text) || `Payment finalization failed with ${response.status}.`)
  }
}

export async function waitForPaymentProjection(input: {
  invoiceId: string
  projectPayment: Promise<void>
}): Promise<boolean> {
  try {
    await input.projectPayment
    return true
  } catch (caught) {
    if (await isProjectedPaid(input.invoiceId)) {
      return true
    }

    throw caught
  }
}

export async function waitForEvmPaymentProjection(invoiceId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await delay(2_500)
    if (await isProjectedPaid(invoiceId)) {
      return true
    }
  }

  return false
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Unavailable'
  }
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZoneName: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(value))
}

export function shortInvoiceId(invoiceId: string) {
  return invoiceId.length > 16 ? `${invoiceId.slice(0, 10)}...${invoiceId.slice(-6)}` : invoiceId
}

export function scheduleReturnToMerchant(fallback: () => void) {
  return window.setTimeout(() => {
    const returnUrl = safeReferrerUrl()
    if (returnUrl) {
      window.location.assign(returnUrl)
      return
    }

    fallback()
  }, 1_250)
}

export function readPreferredPayerFromLocation(): HexAddress | null {
  if (typeof window === 'undefined') {
    return null
  }

  const current = new URL(window.location.href)
  return normalizeAddress(current.hash.replace(/^#/, ''), 'payer') ?? normalizeAddress(current.search, 'preferredPayer')
}

export function removePreferredPayerFromLocation() {
  const current = new URL(window.location.href)
  const hash = new URLSearchParams(current.hash.replace(/^#/, ''))
  hash.delete('payer')
  current.hash = hash.toString()
  window.history.replaceState(null, '', current.toString())
}

export async function resolvePayerAddress({
  preferredPayerAddress,
  provider,
  setStatus,
}: {
  preferredPayerAddress: HexAddress | null
  provider: ReturnType<typeof ensureEthereumProvider>
  setStatus: (status: string) => void
}): Promise<HexAddress> {
  if (preferredPayerAddress) {
    return resolvePreferredPayerAddress(provider, preferredPayerAddress, setStatus)
  }

  return resolveSelectedPayerAddress(provider)
}

export function shortHex(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value
}

export function randomNonce(): HexValue {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

function parseProjectionError(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : text
  } catch {
    return text
  }
}

async function isProjectedPaid(invoiceId: string): Promise<boolean> {
  const invoice = await getInvoiceRecord(invoiceId).catch(() => null)
  return Boolean(invoice && isPaymentComplete(invoice.snapshot.paymentTruth, invoice.snapshot.finalityStatus))
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function safeReferrerUrl() {
  if (!document.referrer) {
    return null
  }

  try {
    const referrer = new URL(document.referrer)
    const current = new URL(window.location.href)
    if (referrer.href === current.href || referrer.origin === current.origin) {
      return null
    }

    return referrer.protocol === 'http:' || referrer.protocol === 'https:' ? referrer.toString() : null
  } catch {
    return null
  }
}

function normalizeAddress(paramsText: string, key: string): HexAddress | null {
  const raw = new URLSearchParams(paramsText).get(key)
  if (!raw) {
    return null
  }

  try {
    return getAddress(raw) as HexAddress
  } catch {
    return null
  }
}

async function resolvePreferredPayerAddress(
  provider: ReturnType<typeof ensureEthereumProvider>,
  preferredPayerAddress: HexAddress,
  setStatus: (status: string) => void,
): Promise<HexAddress> {
  const initialAccounts = normalizedWalletAccounts(await provider.request({ method: 'eth_accounts' }))
  if (hasWalletAccount(initialAccounts, preferredPayerAddress)) {
    return preferredPayerAddress
  }

  setStatus(`Select CardForge wallet ${shortHex(preferredPayerAddress)} in MetaMask.`)
  await provider.request({
    method: 'wallet_requestPermissions',
    params: [{ eth_accounts: {} }],
  })
  const accounts = normalizedWalletAccounts(await provider.request({ method: 'eth_accounts' }))
  if (hasWalletAccount(accounts, preferredPayerAddress)) {
    return preferredPayerAddress
  }

  const selected = accounts[0] ? ` Current wallet is ${shortHex(accounts[0])}.` : ''
  throw new Error(`Select CardForge wallet ${shortHex(preferredPayerAddress)} to pay from the demo balance.${selected}`)
}

async function resolveSelectedPayerAddress(provider: ReturnType<typeof ensureEthereumProvider>): Promise<HexAddress> {
  const accounts = normalizedWalletAccounts(await provider.request({ method: 'eth_requestAccounts' }))
  const selected = accounts[0]
  if (!selected) {
    throw new Error('MetaMask returned no selected account.')
  }

  return selected
}

function normalizedWalletAccounts(value: unknown): HexAddress[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((account) => {
    if (typeof account !== 'string') {
      return []
    }

    try {
      return [getAddress(account) as HexAddress]
    } catch {
      return []
    }
  })
}

function hasWalletAccount(accounts: HexAddress[], address: HexAddress) {
  return accounts.some((account) => account.toLowerCase() === address.toLowerCase())
}
