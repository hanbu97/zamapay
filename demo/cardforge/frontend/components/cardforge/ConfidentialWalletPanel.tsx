'use client'

import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2Icon,
  ClipboardIcon,
  CoinsIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  BoxIcon,
  Gamepad2Icon,
  GemIcon,
  KeyboardIcon,
  PlusIcon,
  Rows3Icon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SwordsIcon,
  type LucideIcon,
} from 'lucide-react'
import { getAddress } from 'viem'
import {
  claimTestCusd,
  ensureWalletNetwork,
  readConfidentialWallet,
  readChainTransactionReceipt,
  transactionExplorerHref,
  walletNetwork,
  type ConfidentialWalletSnapshot,
} from '@/lib/confidential-wallet'
import {
  getCardForgeWalletActivity,
  type OwnedCardRecord,
  type PaymentActivityRecord,
} from '@/lib/cardforge-api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { CardForgeConfig } from '@/lib/config'
import { cn } from '@/lib/utils'

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
  on?(event: 'accountsChanged' | 'chainChanged', handler: (...args: unknown[]) => void): void
  removeListener?(event: 'accountsChanged' | 'chainChanged', handler: (...args: unknown[]) => void): void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

type ConfidentialWalletPanelProps = {
  className?: string
  config: CardForgeConfig
  onWalletChange?: (address: string | null) => void
}

type MintActivityRecord = {
  amountMinorUnits: string
  blockNumber: string
  chainId: number
  recordedAt: string
  status: 'confirmed' | 'reverted'
  tokenAddress: string
  txHash: string
  type: 'mint'
  walletAddress: string
}

type WalletActivityRecord = MintActivityRecord | PaymentActivityRecord
type OwnedCardGroup = {
  amountLabel: string
  count: number
  Icon: LucideIcon
  productId: string
  title: string
}

const maxActivityRecords = 8
const walletActivityStoragePrefix = 'cardforge:confidential-wallet:activity:v1'

export function ConfidentialWalletPanel({ className, config, onWalletChange }: ConfidentialWalletPanelProps) {
  const [address, setAddress] = useState<string | null>(null)
  const [activity, setActivity] = useState<MintActivityRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [ownedCards, setOwnedCards] = useState<OwnedCardRecord[]>([])
  const [paymentActivity, setPaymentActivity] = useState<PaymentActivityRecord[]>([])
  const [status, setStatus] = useState('Connect wallet to reveal balance')
  const [wallet, setWallet] = useState<ConfidentialWalletSnapshot | null>(null)
  const didHydrateWallet = useRef(false)

  async function connectWallet() {
    setIsBusy(true)
    setError(null)
    setStatus('Opening MetaMask wallet connection...')

    try {
      const provider = ensureProvider()
      await ensureWalletNetwork(provider)
      const selected = await requestSelectedAccount(provider)
      if (!selected) {
        throw new Error('MetaMask returned no selected account.')
      }

      setAddress(selected)
      await refreshWallet(selected)
    } catch (caught) {
      setError(readableError(caught))
      setStatus('Wallet connection did not complete.')
    } finally {
      setIsBusy(false)
    }
  }

  async function switchWallet() {
    setIsBusy(true)
    setError(null)
    setStatus('Opening MetaMask account selection...')

    try {
      const provider = ensureProvider()
      await revokeAccounts(provider)
      await ensureWalletNetwork(provider)
      const selected = await requestSelectedAccount(provider)
      if (!selected) {
        throw new Error('MetaMask returned no selected account.')
      }

      setAddress(selected)
      await refreshWallet(selected)
    } catch (caught) {
      setError(readableError(caught))
      setStatus('Wallet switch did not complete.')
    } finally {
      setIsBusy(false)
    }
  }

  async function claimTestTokens() {
    setIsBusy(true)
    setError(null)
    setStatus(`Confirm the 1000 cUSDT test-token transaction on ${walletNetwork.label}...`)

    try {
      const provider = ensureProvider()
      await ensureWalletNetwork(provider)
      const selected = address ?? (await requestSelectedAccount(provider))
      if (!selected) {
        throw new Error('Connect a wallet before claiming test cUSDT.')
      }

      setAddress(selected)
      const claim = await claimTestCusd(provider, selected)
      const record = createMintActivity(selected, claim)
      appendActivity(record)
      setStatus(
        claim.receiptStatus === 'success'
          ? `Claimed ${formatMinorUnits(claim.amountMinorUnits)}. Refreshing private balance...`
          : `cUSDT claim transaction reverted. Hash ${shortHex(claim.txHash)} is recorded.`,
      )
      await refreshWallet(selected)
    } catch (caught) {
      setError(readableError(caught))
      setStatus('Test cUSDT claim did not complete.')
    } finally {
      setIsBusy(false)
    }
  }

  async function refreshWallet(selectedAddress = address) {
    if (!selectedAddress) {
      throw new Error('Connect a wallet before refreshing the confidential balance.')
    }

    setIsBusy(true)
    setError(null)
    setStatus(`Reading ${walletNetwork.label} confidential cUSDT balance...`)

    try {
      const provider = ensureProvider()
      const snapshot = await readConfidentialWallet(selectedAddress, provider)
      setWallet(snapshot)
      setActivity(await restoreWalletActivity(snapshot.address, snapshot.tokenAddress))
      await refreshWalletRecords(snapshot.address).catch(() => undefined)
      setStatus(
        BigInt(snapshot.balanceMinorUnits) > 0n
          ? 'Confidential wallet balance is ready for encrypted checkout.'
          : `No ${walletNetwork.label} cUSDT balance is available for this wallet.`,
      )
    } catch (caught) {
      setStatus(`Browser could not read the confidential balance from ${walletNetwork.label}.`)
      setError(readableError(caught))
    } finally {
      setIsBusy(false)
    }
  }

  async function refreshWalletRecords(selectedAddress = address) {
    if (!selectedAddress) {
      setOwnedCards([])
      setPaymentActivity([])
      return
    }

    const records = await getCardForgeWalletActivity(config, selectedAddress)
    setOwnedCards(records.ownedCards)
    setPaymentActivity(records.payments)
  }

  function appendActivity(record: MintActivityRecord) {
    setActivity((current) => {
      const next = [record, ...current.filter((item) => item.txHash !== record.txHash)].slice(0, maxActivityRecords)
      writeWalletActivity(record.walletAddress, record.tokenAddress, next)
      return next
    })
  }

  useEffect(() => {
    onWalletChange?.(address)
  }, [address, onWalletChange])

  useEffect(() => {
    if (didHydrateWallet.current) {
      return
    }

    didHydrateWallet.current = true
    const provider = window.ethereum
    if (!provider) {
      return
    }

    void (async () => {
      const selected = firstWalletAccount(await readAccounts(provider))
      if (!selected) {
        return
      }

      setAddress(selected)
      await refreshWallet(selected)
    })()
  }, [])

  useEffect(() => {
    let isActive = true

    const syncWalletRecords = async () => {
      if (!address) {
        setOwnedCards([])
        setPaymentActivity([])
        return
      }

      try {
        const records = await getCardForgeWalletActivity(config, address)
        if (isActive) {
          setOwnedCards(records.ownedCards)
          setPaymentActivity(records.payments)
        }
      } catch {
        if (isActive) {
          setOwnedCards([])
          setPaymentActivity([])
        }
      }
    }

    void syncWalletRecords()
    const interval = window.setInterval(() => void syncWalletRecords(), 4_000)
    const onFocus = () => void syncWalletRecords()
    window.addEventListener('focus', onFocus)

    return () => {
      isActive = false
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [address, config])

  useEffect(() => {
    const provider = window.ethereum
    if (!provider?.on) {
      return
    }

    const setSelectedAccount = (accounts: unknown[]) => {
      const selected = firstWalletAccount(accounts)
      setAddress(selected)
      setWallet(null)
      setActivity([])
      setOwnedCards([])
      setPaymentActivity([])
      if (selected) {
        void refreshWallet(selected)
      }
    }

    const handleAccountsChanged = (...args: unknown[]) => {
      setSelectedAccount(Array.isArray(args[0]) ? args[0] : [])
    }

    const handleChainChanged = () => {
      if (address) {
        void refreshWallet(address)
      }
    }

    const handleFocus = async () => {
      const selected = firstWalletAccount(await readAccounts(provider))
      if (selected !== address) {
        setSelectedAccount(selected ? [selected] : [])
      }
    }

    provider.on('accountsChanged', handleAccountsChanged)
    provider.on('chainChanged', handleChainChanged)
    window.addEventListener('focus', handleFocus)
    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged)
      provider.removeListener?.('chainChanged', handleChainChanged)
      window.removeEventListener('focus', handleFocus)
    }
  }, [address])

  const balanceLabel = wallet ? formatMinorUnits(wallet.balanceMinorUnits) : '-- cUSDT'
  const hasWallet = Boolean(address)
  const canConnectWallet = !isBusy
  const canRefreshWallet = hasWallet && !isBusy
  const canClaimTokens = !isBusy
  const walletHandle = address ? shortHex(address) : 'Not connected'
  const walletActionLabel = hasWallet ? walletHandle : 'Connect wallet'
  const visibleActivity = mergeActivityRecords(activity, paymentActivity)
  const visibleOwnedCards = groupOwnedCards(ownedCards)

  return (
    <Card className={cn('flex min-w-0 flex-col', className)}>
      <CardContent className="grid gap-4 p-4 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:p-0">
        <section className="w-full max-w-full overflow-hidden rounded-[1.75rem] border border-[#dbe600] bg-[#f4ff00] p-4 text-black shadow-[0_22px_70px_rgb(0_0_0/0.42)] 2xl:p-5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <button
              aria-label={hasWallet ? 'Switch wallet' : 'Connect wallet'}
              className={cn(
                'inline-flex min-w-0 max-w-[68%] items-center justify-center truncate rounded-full border px-3 py-1.5 text-sm font-semibold shadow-sm transition-colors disabled:cursor-default disabled:opacity-60',
                hasWallet
                  ? 'border-black/10 bg-black/10 text-black hover:bg-black/15'
                  : 'border-black bg-black text-[#f4ff00] hover:bg-black/85',
              )}
              disabled={!canConnectWallet}
              onClick={() => void (hasWallet ? switchWallet() : connectWallet())}
              suppressHydrationWarning
              type="button"
            >
              {walletActionLabel}
            </button>
            <Badge className="shrink-0 border-black/10 bg-black/10 text-black hover:bg-black/10" variant="outline">
              <EyeOffIcon data-icon="inline-start" />
              private
            </Badge>
          </div>

          <div className="mt-5 flex min-w-0 items-center gap-2 text-sm font-medium text-black/70">
            <span>Total balance</span>
            <button
              aria-label="Refresh confidential balance"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-black/5 transition-colors hover:bg-black/10 disabled:opacity-50"
              disabled={!canRefreshWallet}
              onClick={() => void refreshWallet()}
              suppressHydrationWarning
              type="button"
            >
              <RefreshCwIcon className="size-4" />
            </button>
          </div>

          <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate text-[1.75rem] font-semibold leading-none tracking-normal 2xl:text-[2.1rem]">
                  {balanceLabel}
                </span>
                <EyeIcon className="size-5 shrink-0 text-black/75 2xl:size-6" />
              </div>
            </div>

            <button
              aria-label={hasWallet ? 'Claim 1000 test cUSDT' : 'Connect wallet'}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-black text-[#f4ff00] shadow-sm transition-colors hover:bg-black/85 disabled:opacity-50"
              disabled={!canClaimTokens}
              onClick={() => void (hasWallet ? claimTestTokens() : connectWallet())}
              suppressHydrationWarning
              type="button"
            >
              <PlusIcon className="size-5" />
            </button>
          </div>

          <div className="mt-3 flex max-w-full items-center gap-2 rounded-full bg-black/5 px-2.5 py-1.5 text-xs text-black/70 2xl:px-3 2xl:text-sm">
            <ShieldCheckIcon className="size-4 shrink-0 text-black/60" />
            <span className="min-w-0 truncate">{error ?? status}</span>
          </div>
        </section>

        <div className="grid min-h-[42rem] gap-3 xl:min-h-0 xl:flex-1 xl:grid-rows-[minmax(12rem,0.42fr)_minmax(14rem,0.58fr)]">
          <section
            className="flex min-h-0 flex-col rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-4 text-white shadow-[0_18px_55px_rgb(0_0_0/0.2)]"
            data-testid="owned-cards-panel"
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">Unlocked cards</h2>
                <p className="mt-1 truncate text-xs text-white/45">Wallet-local fulfillment</p>
              </div>
              <Badge className="shrink-0 border-white/10 bg-white/[0.06] text-white/65 hover:bg-white/[0.06]" variant="outline">
                {ownedCards.length}
              </Badge>
            </div>

            {visibleOwnedCards.length ? (
              <div className="mt-3 grid min-h-0 flex-1 grid-cols-4 content-start gap-2 overflow-y-auto pr-1">
                {visibleOwnedCards.map(({ amountLabel, count, Icon, productId, title }) => (
                  <article
                    className="relative flex min-w-0 flex-col items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-2 py-3 text-center"
                    data-testid="owned-card-record"
                    key={productId}
                    title={title}
                  >
                    {count > 1 ? (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-[#f4ff00] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-black">
                        x{count}
                      </span>
                    ) : null}
                    <span className="inline-flex size-10 items-center justify-center rounded-full bg-[#f4ff00] text-black shadow-[0_0_22px_rgb(244_255_0/0.24)]">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{ownedCardName(title)}</p>
                      <p className="mt-0.5 truncate text-[11px] text-white/45">{amountLabel}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div
                className="mt-3 flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-5 text-center"
                data-testid="owned-cards-empty"
              >
                <Rows3Icon className="size-7 text-white/30" />
                <p className="mt-3 text-sm font-medium text-white/75">No unlocked cards yet</p>
                <p className="mt-1 max-w-52 text-xs leading-5 text-white/45">
                  Buy a card with this wallet. Fulfilled cards will stay attached to the wallet.
                </p>
              </div>
            )}
          </section>

          <section
            className="flex min-h-0 flex-col rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-4 text-white shadow-[0_18px_55px_rgb(0_0_0/0.2)]"
            data-testid="wallet-activity-panel"
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">Transaction history</h2>
                <p className="mt-1 truncate text-xs text-white/45">{walletNetwork.activityLabel}</p>
              </div>
              <Badge className="shrink-0 border-white/10 bg-white/[0.06] text-white/65 hover:bg-white/[0.06]" variant="outline">
                {visibleActivity.length}
              </Badge>
            </div>

            {visibleActivity.length ? (
              <div className="mt-4 grid min-h-0 flex-1 gap-2 overflow-y-auto pr-1">
                {visibleActivity.map((record) => {
                  const href = transactionHref(record.txHash)
                  return (
                    <article
                      className="rounded-2xl border border-white/10 bg-black/25 p-3"
                      data-testid="wallet-activity-record"
                      key={`${record.type}:${record.txHash}`}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f4ff00] text-black">
                          <CoinsIcon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <p className="truncate text-sm font-semibold">{activityTitle(record)}</p>
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.08] px-2 py-1 text-[11px] text-white/70">
                              <CheckCircle2Icon className="size-3" />
                              {record.status}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-white/55">{activityDescription(record)}</p>
                          <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
                            <code className="min-w-0 truncate rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/65">
                              {shortHex(record.txHash)}
                            </code>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                aria-label="Copy transaction hash"
                                className="inline-flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
                                onClick={() => void copyTransactionHash(record.txHash)}
                                title={record.txHash}
                                type="button"
                              >
                                <ClipboardIcon className="size-3.5" />
                              </button>
                              {href ? (
                                <a
                                  aria-label="Open transaction in explorer"
                                  className="inline-flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
                                  href={href}
                                  rel="noreferrer"
                                  target="_blank"
                                  title="Open transaction in explorer"
                                >
                                  <ExternalLinkIcon className="size-3.5" />
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div
                className="mt-4 flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-5 text-center"
                data-testid="wallet-activity-empty"
              >
                <CoinsIcon className="size-7 text-white/30" />
                <p className="mt-3 text-sm font-medium text-white/75">No wallet transactions yet</p>
                <p className="mt-1 max-w-52 text-xs leading-5 text-white/45">
                  Mint test cUSDT or complete a checkout. Confirmed chain hashes will appear here.
                </p>
              </div>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  )
}

function ensureProvider(): EthereumProvider {
  if (!window.ethereum) {
    throw new Error('MetaMask is not available in this browser.')
  }

  return window.ethereum
}

async function requestAccounts(provider: EthereumProvider): Promise<string[]> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' })
  return Array.isArray(accounts) ? accounts.filter((account): account is string => typeof account === 'string') : []
}

async function readAccounts(provider: EthereumProvider): Promise<string[]> {
  const accounts = await provider.request({ method: 'eth_accounts' })
  return Array.isArray(accounts) ? accounts.filter((account): account is string => typeof account === 'string') : []
}

async function requestSelectedAccount(provider: EthereumProvider): Promise<string | null> {
  return firstWalletAccount(await requestAccounts(provider))
}

function firstWalletAccount(accounts: unknown[]): string | null {
  for (const account of accounts) {
    if (typeof account !== 'string') {
      continue
    }

    try {
      return getAddress(account)
    } catch {
      continue
    }
  }

  return null
}

async function revokeAccounts(provider: EthereumProvider) {
  try {
    await provider.request({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    })
  } catch (caught) {
    const code = walletErrorCode(caught)
    if (code !== -32601 && code !== 4100) {
      throw caught
    }
  }
}

function walletErrorCode(caught: unknown): unknown {
  return typeof caught === 'object' && caught !== null ? (caught as { code?: unknown }).code : undefined
}

function readableError(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'Confidential wallet lookup failed.'
}

function createMintActivity(address: string, claim: Awaited<ReturnType<typeof claimTestCusd>>): MintActivityRecord {
  return {
    amountMinorUnits: claim.amountMinorUnits,
    blockNumber: claim.blockNumber,
    chainId: walletNetwork.chainId,
    recordedAt: new Date().toISOString(),
    status: claim.receiptStatus === 'success' ? 'confirmed' : 'reverted',
    tokenAddress: claim.tokenAddress,
    txHash: claim.txHash,
    type: 'mint',
    walletAddress: getAddress(address),
  }
}

function readWalletActivity(address: string, tokenAddress: string): MintActivityRecord[] {
  if (typeof window === 'undefined') {
    return []
  }

  const raw = window.localStorage.getItem(walletActivityStorageKey(address, tokenAddress))
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(isWalletActivityRecord).slice(0, maxActivityRecords) : []
  } catch {
    return []
  }
}

async function restoreWalletActivity(address: string, tokenAddress: string): Promise<MintActivityRecord[]> {
  const stored = readWalletActivity(address, tokenAddress)
  if (!stored.length) {
    return []
  }

  const verified = await Promise.all(
    stored.map(async (record) => {
      const receipt = await readChainTransactionReceipt(record.txHash).catch(() => null)
      if (!receipt?.to || getAddress(receipt.to) !== getAddress(tokenAddress)) {
        return null
      }

      return { ...record, blockNumber: receipt.blockNumber, status: toActivityStatus(receipt.receiptStatus) }
    }),
  )
  const active = verified.filter((record): record is MintActivityRecord => record !== null)
  writeWalletActivity(address, tokenAddress, active)
  return active
}

function writeWalletActivity(address: string, tokenAddress: string, records: MintActivityRecord[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    walletActivityStorageKey(address, tokenAddress),
    JSON.stringify(records.slice(0, maxActivityRecords)),
  )
}

function walletActivityStorageKey(address: string, tokenAddress: string): string {
  return `${walletActivityStoragePrefix}:${getAddress(address)}:${getAddress(tokenAddress)}`
}

function isWalletActivityRecord(value: unknown): value is MintActivityRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Partial<MintActivityRecord>
  return (
    typeof record.amountMinorUnits === 'string' &&
    typeof record.blockNumber === 'string' &&
    typeof record.recordedAt === 'string' &&
    typeof record.tokenAddress === 'string' &&
    typeof record.txHash === 'string' &&
    typeof record.walletAddress === 'string' &&
    record.type === 'mint' &&
    (record.status === 'confirmed' || record.status === 'reverted')
  )
}

function mergeActivityRecords(
  mints: MintActivityRecord[],
  payments: PaymentActivityRecord[],
): WalletActivityRecord[] {
  return [...mints, ...payments]
    .sort((left, right) => activityTimestamp(right) - activityTimestamp(left))
    .slice(0, maxActivityRecords)
}

function activityTitle(record: WalletActivityRecord): string {
  return record.type === 'mint' ? 'Mint test cUSDT' : 'Private checkout payment'
}

function activityDescription(record: WalletActivityRecord): string {
  if (record.type === 'mint') {
    return `${formatMinorUnits(record.amountMinorUnits)} on block #${record.blockNumber}`
  }

  const invoice = record.chainInvoiceId === null ? 'local invoice' : `invoice #${record.chainInvoiceId}`
  return `${record.amountLabel} paid on ${invoice}`
}

function groupOwnedCards(cards: OwnedCardRecord[]): OwnedCardGroup[] {
  const grouped = new Map<string, OwnedCardGroup>()
  for (const card of cards) {
    const key = card.productId || card.title
    const existing = grouped.get(key)
    if (existing) {
      existing.count += 1
      continue
    }

    grouped.set(key, {
      amountLabel: card.amountLabel,
      count: 1,
      Icon: ownedCardIcon(card.productId),
      productId: key,
      title: card.title,
    })
  }

  return [...grouped.values()]
}

function ownedCardIcon(productId: string): LucideIcon {
  switch (productId) {
    case 'arena-access':
      return Gamepad2Icon
    case 'mythic-loadout':
      return SwordsIcon
    case 'cyber-skin':
      return KeyboardIcon
    case 'founders-drop':
      return BoxIcon
    default:
      return GemIcon
  }
}

function ownedCardName(title: string): string {
  return title.split(/\s+/)[0] || title
}

function activityTimestamp(record: WalletActivityRecord): number {
  const parsed = Date.parse(record.recordedAt)
  if (Number.isFinite(parsed)) {
    return parsed
  }

  const numeric = Number(record.recordedAt)
  return Number.isFinite(numeric) ? numeric : 0
}

function transactionHref(txHash: string): string | null {
  return transactionExplorerHref(txHash)
}

function toActivityStatus(status: 'success' | 'reverted'): MintActivityRecord['status'] {
  return status === 'success' ? 'confirmed' : 'reverted'
}

function copyTransactionHash(txHash: string): Promise<void> {
  return navigator.clipboard?.writeText(txHash) ?? Promise.resolve()
}

function shortHex(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value
}

function formatMinorUnits(value: string): string {
  const raw = BigInt(value)
  const whole = raw / 1_000_000n
  const fraction = raw % 1_000_000n
  const fractionText = fraction.toString().padStart(6, '0').replace(/0+$/, '')

  return `${whole.toLocaleString()}${fractionText ? `.${fractionText}` : ''} cUSDT`
}
