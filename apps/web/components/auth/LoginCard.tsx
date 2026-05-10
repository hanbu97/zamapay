'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightIcon, KeyRoundIcon, RefreshCwIcon, WalletIcon } from 'lucide-react'
import { createWalletClient, custom, getAddress } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { requestNonce, verifySignature } from '@/lib/api'
import {
  type EthereumProvider,
  disconnectWalletAccounts,
  ensureEthereumProvider,
  getAuthorizedWalletAccounts,
  listenForInjectedWalletProvider,
  requestWalletAccounts,
} from '@/lib/wallet'

type LoginCardProps = {
  redirectTo?: string
}

type WalletProbeState = 'missing' | 'available' | 'connected'

export function LoginCard({ redirectTo = '/dashboard' }: LoginCardProps) {
  const router = useRouter()
  const [address, setAddress] = useState('')
  const [status, setStatus] = useState('Connect your wallet to choose your merchant account.')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [isSwitchingWallet, setIsSwitchingWallet] = useState(false)
  const [walletState, setWalletState] = useState<WalletProbeState>('available')

  const applyWalletAccounts = useCallback((accounts: string[], connectedStatus: string): boolean => {
    const nextAddress = normalizeWalletAccounts(accounts)[0] ?? ''

    if (nextAddress) {
      setAddress(nextAddress)
      setWalletState('connected')
      setStatus(connectedStatus)
      return true
    }

    setAddress('')
    setWalletState('available')
    setStatus('MetaMask is available. Connect it to choose your merchant account.')
    return false
  }, [])

  useEffect(() => {
    let cancelled = false
    let activeProvider: EthereumProvider | undefined

    function applyAccounts(accounts: string[]) {
      if (cancelled) {
        return
      }

      applyWalletAccounts(accounts, 'Wallet authorization is already available. Sign a nonce to continue.')
    }

    async function attachProvider(provider: EthereumProvider) {
      if (cancelled) {
        return
      }

      setWalletState('available')
      setStatus('Wallet is available. Connect it to choose your merchant account.')

      if (activeProvider !== provider) {
        activeProvider?.removeListener?.('accountsChanged', applyAccounts)
        activeProvider = provider
        activeProvider.on?.('accountsChanged', applyAccounts)
      }

      try {
        applyAccounts(await getAuthorizedWalletAccounts(provider))
      } catch {
        if (!cancelled) {
          setWalletState('available')
          setStatus('Wallet is available. Connect it to choose your merchant account.')
        }
      }
    }

    const stopListening = listenForInjectedWalletProvider((provider) => {
      void attachProvider(provider)
    })
    const timeout = window.setTimeout(() => {
      if (!activeProvider && !cancelled) {
        setWalletState('missing')
        setStatus('Install or enable MetaMask, Rabby, or another EIP-1193 wallet.')
      }
    }, 1500)

    return () => {
      cancelled = true
      activeProvider?.removeListener?.('accountsChanged', applyAccounts)
      stopListening()
      window.clearTimeout(timeout)
    }
  }, [applyWalletAccounts])

  async function handleSignIn() {
    if (!address) {
      await handleConnectWallet()
      return
    }

    setIsBusy(true)
    setError(null)

    try {
      const provider = ensureEthereumProvider()
      const client = createWalletClient({
        transport: custom(provider),
      })

      const normalizedAddress = getAddress(address)
      setAddress(normalizedAddress)
      setWalletState('connected')

      setStatus('Requesting nonce from Rust auth service...')
      const challenge = await requestNonce(normalizedAddress)

      setStatus('Waiting for wallet signature...')
      const signature = await client.signMessage({
        account: normalizedAddress,
        message: challenge.message,
      })

      setStatus('Verifying signature and minting session cookie...')
      await verifySignature({
        address: normalizedAddress,
        nonce: challenge.nonce,
        message: challenge.message,
        signature,
      })

      setStatus('Session ready. Redirecting...')
      router.push(redirectTo)
      router.refresh()
    } catch (caught) {
      const nextError = caught instanceof Error ? caught.message : 'Wallet login failed.'
      setError(nextError)
      setStatus('Login did not complete.')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleConnectWallet() {
    setIsSwitchingWallet(true)
    setError(null)

    try {
      const provider = ensureEthereumProvider()
      applyWalletAccounts(await requestWalletAccounts(provider), 'Wallet selected. Sign a nonce to continue.')
    } catch (caught) {
      if (isUserRejectedWalletRequest(caught)) {
        setStatus('Wallet selection cancelled.')
        return
      }

      const nextError = caught instanceof Error ? caught.message : 'Wallet selection failed.'
      setError(nextError)
      setStatus('Wallet selection did not complete.')
    } finally {
      setIsSwitchingWallet(false)
    }
  }

  async function handleSwitchWallet() {
    setIsSwitchingWallet(true)
    setError(null)
    setAddress('')
    setWalletState('available')
    setStatus('Disconnecting this site from the current wallet account...')

    try {
      const provider = ensureEthereumProvider()
      await disconnectWalletAccounts(provider)
      setStatus('Disconnected. Switch accounts in MetaMask, then connect wallet again.')
    } catch (caught) {
      if (isUserRejectedWalletRequest(caught)) {
        setStatus('Wallet switch cancelled.')
        return
      }

      const nextError = caught instanceof Error ? caught.message : 'Wallet switch failed.'
      setError(nextError)
      setStatus('Wallet switch did not complete.')
    } finally {
      setIsSwitchingWallet(false)
    }
  }

  async function handleDevSignIn() {
    setIsBusy(true)
    setError(null)

    try {
      setStatus('Loading local-dev signer...')
      const signerResponse = await fetch('/api/dev/sign-message', { cache: 'no-store' })
      if (!signerResponse.ok) {
        throw new Error('Local-dev signer is disabled. Enable ZAMAPAY_ENABLE_DEV_SIGNER=1 for browser QA.')
      }
      const signer = (await signerResponse.json()) as { address?: unknown }
      if (typeof signer.address !== 'string') {
        throw new Error('Local-dev signer did not return an address.')
      }

      const normalizedAddress = getAddress(signer.address)
      setAddress(normalizedAddress)
      setWalletState('connected')

      setStatus('Requesting nonce from Rust auth service...')
      const challenge = await requestNonce(normalizedAddress)
      const signatureResponse = await fetch('/api/dev/sign-message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: challenge.message }),
      })
      if (!signatureResponse.ok) {
        throw new Error('Local-dev signer could not sign the auth challenge.')
      }
      const signed = (await signatureResponse.json()) as { signature?: unknown }
      if (typeof signed.signature !== 'string') {
        throw new Error('Local-dev signer returned an invalid signature.')
      }

      setStatus('Verifying signature and minting session cookie...')
      await verifySignature({
        address: normalizedAddress,
        nonce: challenge.nonce,
        message: challenge.message,
        signature: signed.signature,
      })

      setStatus('Session ready. Redirecting...')
      router.push(redirectTo)
      router.refresh()
    } catch (caught) {
      const nextError = caught instanceof Error ? caught.message : 'Local-dev login failed.'
      setError(nextError)
      setStatus('Login did not complete.')
    } finally {
      setIsBusy(false)
    }
  }

  const canSignIn = walletState === 'connected' && Boolean(address)
  const buttonLabel = canSignIn ? 'Sign in' : 'Connect wallet'
  const statusHint = walletStatusHint(walletState, address, status)
  const walletActionBusy = isBusy || isSwitchingWallet

  return (
    <Card className="h-fit w-full rounded-3xl border-0 bg-card shadow-xl shadow-foreground/5 ring-1 ring-border" size="sm">
      <CardHeader className="items-center px-7 pt-7 text-center">
        <CardTitle className="text-xl font-semibold">Sign in with wallet</CardTitle>
        <CardDescription className="max-w-xs">
          Connect once, then sign a nonce to open your merchant workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-7">
        <FieldGroup>
          <Button className="h-10 w-full" disabled={walletActionBusy} onClick={canSignIn ? handleSignIn : handleConnectWallet} type="button">
            {isBusy || isSwitchingWallet ? <Spinner data-icon="inline-start" /> : <WalletIcon data-icon="inline-start" />}
            {isBusy ? 'Signing in...' : isSwitchingWallet ? 'Opening wallet...' : buttonLabel}
            {!walletActionBusy ? <ArrowRightIcon data-icon="inline-end" /> : null}
          </Button>

          {walletState === 'missing' ? (
            <Button className="h-10 w-full" disabled={walletActionBusy} onClick={handleDevSignIn} type="button" variant="outline">
              {isBusy ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
              {isBusy ? 'Signing in...' : 'Use local-dev wallet'}
            </Button>
          ) : null}

          {walletState === 'connected' && address ? (
            <button
              className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
              disabled={walletActionBusy}
              onClick={handleSwitchWallet}
              type="button"
            >
              {isSwitchingWallet ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" />}
              <span>Using {compactAddress(address)}</span>
              <span className="text-foreground">Disconnect</span>
            </button>
          ) : statusHint ? (
            <p className="text-center text-xs leading-5 text-muted-foreground">{statusHint}</p>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Login failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-center rounded-b-3xl bg-muted/30 px-7 py-4 text-center text-xs leading-5 text-muted-foreground">
        By logging in, you agree to protect project API keys and only sign requests for merchants you control.
      </CardFooter>
    </Card>
  )
}

function walletStatusHint(state: WalletProbeState, address: string, status: string): string {
  if (state === 'connected') {
    return `Using ${compactAddress(address)}`
  }
  if (state === 'missing') {
    return status
  }

  return status
}

function normalizeWalletAddress(address: string | undefined): string {
  if (!address) {
    return ''
  }

  try {
    return getAddress(address)
  } catch {
    return ''
  }
}

function normalizeWalletAccounts(accounts: string[]): string[] {
  const normalizedAccounts: string[] = []
  const seen = new Set<string>()

  for (const account of accounts) {
    const normalizedAccount = normalizeWalletAddress(account)
    const key = normalizedAccount.toLowerCase()

    if (normalizedAccount && !seen.has(key)) {
      normalizedAccounts.push(normalizedAccount)
      seen.add(key)
    }
  }

  return normalizedAccounts
}

function compactAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function isUserRejectedWalletRequest(caught: unknown): boolean {
  if (typeof caught !== 'object' || caught === null) {
    return false
  }

  return (caught as { code?: unknown }).code === 4001
}
