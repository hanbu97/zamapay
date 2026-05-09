'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  CalendarClockIcon,
  EyeIcon,
  EyeOffIcon,
  Grid2X2Icon,
  PlusIcon,
  PlugZapIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  WalletCardsIcon,
} from 'lucide-react'
import type { CardForgeConfig } from '@/lib/config'
import {
  CardForgeApiError,
  type ConfidentialWalletSnapshot,
  getConfidentialWallet,
} from '@/lib/cardforge-api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
  on?(event: 'accountsChanged', handler: (accounts: string[]) => void): void
  removeListener?(event: 'accountsChanged', handler: (accounts: string[]) => void): void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

type ConfidentialWalletPanelProps = {
  config: CardForgeConfig
  className?: string
}

const hardhatChain = {
  chainId: '0x7a69',
  chainName: 'Hardhat Local',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: ['http://127.0.0.1:8545'],
}

export function ConfidentialWalletPanel({ className, config }: ConfidentialWalletPanelProps) {
  const [address, setAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [status, setStatus] = useState('Connect MetaMask to display the app-rendered confidential cUSDT balance.')
  const [wallet, setWallet] = useState<ConfidentialWalletSnapshot | null>(null)
  const didAutoConnect = useRef(false)

  async function connectWallet() {
    setIsBusy(true)
    setError(null)
    setStatus('Switching MetaMask to Hardhat Local...')

    try {
      const provider = ensureProvider()
      await ensureHardhatLocal(provider)
      const accounts = await requestAccounts(provider)
      const selected = accounts[0]
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

  async function refreshWallet(selectedAddress = address) {
    if (!selectedAddress) {
      throw new Error('Connect a wallet before refreshing the confidential balance.')
    }

    setIsBusy(true)
    setError(null)
    setStatus('Reading local confidential cUSDT balance...')

    try {
      const snapshot = await getConfidentialWallet(config, selectedAddress)
      setWallet(snapshot)
      setStatus(
        BigInt(snapshot.mintedMinorUnits) > 0n
          ? `Funded local confidential wallet with ${formatMinorUnits(snapshot.mintedMinorUnits)}.`
          : 'Confidential wallet balance is ready for encrypted checkout.',
      )
    } catch (caught) {
      if (caught instanceof CardForgeApiError && caught.code === 'wallet_read_failed') {
        setStatus('CardForge backend could not read the Mermer Pay confidential wallet projection.')
      }
      setError(readableError(caught))
    } finally {
      setIsBusy(false)
    }
  }

  useEffect(() => {
    if (didAutoConnect.current) {
      return
    }

    didAutoConnect.current = true
    void connectWallet()
  }, [])

  useEffect(() => {
    const provider = window.ethereum
    if (!provider?.on) {
      return
    }

    const handleAccountsChanged = (accounts: string[]) => {
      const selected = accounts[0] ?? null
      setAddress(selected)
      setWallet(null)
      if (selected) {
        void refreshWallet(selected)
      }
    }

    provider.on('accountsChanged', handleAccountsChanged)
    return () => provider.removeListener?.('accountsChanged', handleAccountsChanged)
  }, [])

  const balanceLabel = wallet?.balanceLabel ?? '-- cUSDT'
  const hasWallet = Boolean(address)

  return (
    <Card className={cn('min-w-0', className)}>
      <CardContent className="grid gap-4 p-4 xl:p-0">
        <section className="w-full max-w-full rounded-[1.75rem] border border-[#dbe600] bg-[#f4ff00] p-5 text-black shadow-sm">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-black/75">
              <span>Total balance</span>
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-black/5">
                <RefreshCwIcon className="size-4" />
              </span>
            </div>
            <Badge className="shrink-0 border-black/10 bg-black/10 text-black hover:bg-black/10" variant="outline">
              <EyeOffIcon data-icon="inline-start" />
              private
            </Badge>
          </div>

          <div className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate text-[2rem] font-semibold leading-none tracking-normal 2xl:text-[2.25rem]">
                  {balanceLabel}
                </span>
                <EyeIcon className="size-6 shrink-0 text-black/75" />
              </div>
            </div>

            <button
              aria-label={hasWallet ? 'Reconnect wallet' : 'Connect wallet'}
              className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-black text-[#f4ff00] shadow-sm transition-colors hover:bg-black/85 disabled:opacity-50"
              disabled={isBusy}
              onClick={() => void connectWallet()}
              type="button"
            >
              <PlusIcon className="size-6" />
            </button>
          </div>

          <div className="mt-3 flex max-w-full items-center gap-2 rounded-full bg-black/5 px-3 py-1.5 text-sm text-black/70">
            <ShieldCheckIcon className="size-4 shrink-0 text-black/60" />
            <span className="min-w-0 truncate">
              {hasWallet ? 'Ready for encrypted checkout' : 'Connect wallet to reveal balance'}
            </span>
          </div>

          <div className="mt-7 grid grid-cols-4 gap-2 text-center text-[11px] font-medium text-black/75">
            <WalletAction active icon={ArrowUpFromLineIcon} label="Deposit" onClick={() => void connectWallet()} />
            <WalletAction
              icon={ArrowDownToLineIcon}
              label="Withdraw"
              onClick={() =>
                setStatus(
                  hasWallet
                    ? 'Withdraw is intentionally held behind Mermer Pay settlement controls.'
                    : 'Connect wallet before withdrawing confidential balance.',
                )
              }
            />
            <WalletAction
              icon={CalendarClockIcon}
              label="Auto"
              onClick={() => setStatus('Encrypted checkout is the active automatic payment path for this demo.')}
            />
            <WalletAction
              icon={Grid2X2Icon}
              label="More"
              onClick={() => setStatus('Project controls stay in the Mermer Pay console.')}
            />
          </div>
        </section>

        <section className="grid w-full max-w-full gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold leading-none">Buyer wallet</h2>
              <p className="mt-2 text-sm leading-5 text-muted-foreground">
                MetaMask signs checkout actions; CardForge renders only the confidential balance projection.
              </p>
            </div>
            <WalletCardsIcon className="mt-0.5 shrink-0 text-muted-foreground" />
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground">
            <DetailRow label="Account" value={address ? shortHex(address) : 'not connected'} />
            <DetailRow label="Balance handle" value={wallet ? shortHex(wallet.balanceHandle) : 'encrypted'} />
          </div>
        </section>

        <Alert>
          <AlertTitle>Confidential balance source</AlertTitle>
          <AlertDescription>{status}</AlertDescription>
        </Alert>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Wallet panel failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button disabled={isBusy} onClick={connectWallet} type="button">
            <PlugZapIcon data-icon="inline-start" />
            {hasWallet ? 'Reconnect' : 'Connect wallet'}
          </Button>
          <Button disabled={isBusy || !address} onClick={() => void refreshWallet()} type="button" variant="outline">
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function WalletAction({
  active = false,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: typeof ArrowUpFromLineIcon
  label: string
  onClick: () => void
}) {
  return (
    <button className="group grid min-w-0 justify-items-center gap-2" onClick={onClick} type="button">
      <span
        className={cn(
          'inline-flex size-12 items-center justify-center rounded-full border border-black/5 bg-black/5 transition-colors group-hover:bg-black/10',
          active && 'bg-black text-[#f4ff00] group-hover:bg-black/85',
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span>{label}</span>
      <span className="truncate font-medium text-foreground">{value}</span>
    </div>
  )
}

function ensureProvider(): EthereumProvider {
  if (!window.ethereum) {
    throw new Error('MetaMask is not available in this browser.')
  }

  return window.ethereum
}

async function ensureHardhatLocal(provider: EthereumProvider) {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hardhatChain.chainId }],
    })
  } catch (caught) {
    if (walletErrorCode(caught) !== 4902) {
      throw caught
    }

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [hardhatChain],
    })
  }
}

async function requestAccounts(provider: EthereumProvider): Promise<string[]> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' })
  return Array.isArray(accounts) ? accounts.filter((account): account is string => typeof account === 'string') : []
}

function walletErrorCode(caught: unknown): unknown {
  return typeof caught === 'object' && caught !== null ? (caught as { code?: unknown }).code : undefined
}

function readableError(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'Confidential wallet lookup failed.'
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
