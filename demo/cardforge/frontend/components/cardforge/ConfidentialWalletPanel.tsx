'use client'

import { useEffect, useRef, useState } from 'react'
import {
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { getAddress } from 'viem'
import {
  claimLocalTestCusd,
  readConfidentialWallet,
  type ConfidentialWalletSnapshot,
} from '@/lib/local-confidential-wallet'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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

export function ConfidentialWalletPanel({ className }: ConfidentialWalletPanelProps) {
  const [address, setAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [status, setStatus] = useState('Connect wallet to reveal balance')
  const [wallet, setWallet] = useState<ConfidentialWalletSnapshot | null>(null)
  const didHydrateWallet = useRef(false)

  async function connectWallet() {
    setIsBusy(true)
    setError(null)
    setStatus('Opening MetaMask wallet connection...')

    try {
      const provider = ensureProvider()
      await ensureHardhatLocal(provider)
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
      await ensureHardhatLocal(provider)
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
    setStatus('Confirm the 1000 cUSDT test-token transaction in MetaMask...')

    try {
      const provider = ensureProvider()
      await ensureHardhatLocal(provider)
      const selected = address ?? (await requestSelectedAccount(provider))
      if (!selected) {
        throw new Error('Connect a wallet before claiming local cUSDT.')
      }

      setAddress(selected)
      const claim = await claimLocalTestCusd(provider, selected)
      setStatus(`Claimed ${formatMinorUnits(claim.amountMinorUnits)}. Refreshing private balance...`)
      await refreshWallet(selected)
    } catch (caught) {
      setError(readableError(caught))
      setStatus('Local cUSDT claim did not complete.')
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
      const snapshot = await readConfidentialWallet(selectedAddress)
      setWallet(snapshot)
      setStatus(
        BigInt(snapshot.balanceMinorUnits) > 0n
          ? 'Confidential wallet balance is ready for encrypted checkout.'
          : 'No local cUSDT balance is available for this wallet.',
      )
    } catch (caught) {
      setStatus('Browser could not read the local confidential balance from Hardhat RPC.')
      setError(readableError(caught))
    } finally {
      setIsBusy(false)
    }
  }

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
    const provider = window.ethereum
    if (!provider?.on) {
      return
    }

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0] : []
      const selected = firstWalletAccount(accounts)
      setAddress(selected)
      setWallet(null)
      if (selected) {
        void refreshWallet(selected)
      }
    }

    const handleChainChanged = () => {
      if (address) {
        void refreshWallet(address)
      }
    }

    provider.on('accountsChanged', handleAccountsChanged)
    provider.on('chainChanged', handleChainChanged)
    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged)
      provider.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [address])

  const balanceLabel = wallet ? formatMinorUnits(wallet.balanceMinorUnits) : '-- cUSDT'
  const hasWallet = Boolean(address)
  const canConnectWallet = !isBusy
  const canRefreshWallet = hasWallet && !isBusy
  const canClaimTokens = !isBusy
  const walletHandle = address ? shortHex(address) : 'Not connected'
  const walletActionLabel = hasWallet ? walletHandle : 'Connect wallet'

  return (
    <Card className={cn('min-w-0', className)}>
      <CardContent className="grid gap-4 p-4 xl:p-0">
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
