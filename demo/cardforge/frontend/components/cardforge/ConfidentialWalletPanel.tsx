'use client'

import { useEffect, useRef, useState } from 'react'
import {
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  PlugZapIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import type { CardForgeConfig } from '@/lib/config'
import {
  CardForgeApiError,
  type ConfidentialWalletSnapshot,
  getConfidentialWallet,
} from '@/lib/cardforge-api'
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
  const [status, setStatus] = useState('Connect wallet to reveal balance')
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
  const canConnectWallet = !isBusy
  const canRefreshWallet = hasWallet && !isBusy
  const walletHandle = address ? shortHex(address) : 'Not connected'

  return (
    <Card className={cn('min-w-0', className)}>
      <CardContent className="grid gap-4 p-4 xl:p-0">
        <section className="w-full max-w-full overflow-hidden rounded-[1.75rem] border border-[#dbe600] bg-[#f4ff00] p-4 text-black shadow-[0_22px_70px_rgb(0_0_0/0.42)] 2xl:p-5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-black/75">{walletHandle}</span>
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
              aria-label={hasWallet ? 'Reconnect wallet' : 'Connect wallet'}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-black text-[#f4ff00] shadow-sm transition-colors hover:bg-black/85 disabled:opacity-50"
              disabled={!canConnectWallet}
              onClick={() => void connectWallet()}
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

        <div className="grid gap-2 2xl:grid-cols-2">
          <Button
            className="border border-white/10 bg-white/[0.08] text-white hover:bg-white/[0.14]"
            disabled={!canConnectWallet}
            onClick={connectWallet}
            suppressHydrationWarning
            type="button"
          >
            <PlugZapIcon data-icon="inline-start" />
            {hasWallet ? 'Reconnect' : 'Connect wallet'}
          </Button>
          <Button
            className="border-white/15 bg-transparent text-white/85 hover:bg-white/[0.08] hover:text-white"
            disabled={!canRefreshWallet}
            onClick={() => void refreshWallet()}
            suppressHydrationWarning
            type="button"
            variant="outline"
          >
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
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
