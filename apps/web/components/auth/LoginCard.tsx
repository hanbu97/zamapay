'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightIcon, CheckCircle2Icon, ShieldCheckIcon, WalletIcon } from 'lucide-react'
import { createWalletClient, custom, getAddress } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { requestNonce, verifySignature } from '@/lib/api'
import { ensureEthereumProvider } from '@/lib/wallet'

type LoginCardProps = {
  redirectTo?: string
}

export function LoginCard({ redirectTo = '/dashboard' }: LoginCardProps) {
  const router = useRouter()
  const [address, setAddress] = useState('')
  const [status, setStatus] = useState('Connect your wallet to start a nonce-signed merchant session.')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const [hasInjectedWallet, setHasInjectedWallet] = useState(false)

  useEffect(() => {
    function detectWallet() {
      setHasInjectedWallet(typeof window !== 'undefined' && typeof window.ethereum !== 'undefined')
    }

    detectWallet()
    window.addEventListener('ethereum#initialized', detectWallet, { once: true })
    const timeout = window.setTimeout(detectWallet, 500)

    return () => {
      window.removeEventListener('ethereum#initialized', detectWallet)
      window.clearTimeout(timeout)
    }
  }, [])

  async function handleConnect() {
    setIsBusy(true)
    setError(null)

    try {
      const provider = ensureEthereumProvider()
      const client = createWalletClient({
        transport: custom(provider),
      })

      const [selectedAddress] = await client.requestAddresses()
      const normalizedAddress = getAddress(selectedAddress)
      setAddress(normalizedAddress)

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

  const StatusIcon = hasInjectedWallet ? CheckCircle2Icon : ShieldCheckIcon
  const statusTitle = hasInjectedWallet ? 'Wallet signed session' : 'No wallet detected'
  const statusDescription = hasInjectedWallet
    ? status
    : 'Open this page in a browser with MetaMask, Rabby, or another EIP-1193 wallet.'

  return (
    <Card className="h-fit w-full rounded-3xl border-0 bg-card shadow-xl shadow-foreground/5 ring-1 ring-border" size="sm">
      <CardHeader className="items-center px-7 pt-7 text-center">
        <CardTitle className="text-xl font-semibold">Log in or sign up</CardTitle>
        <CardDescription className="max-w-xs">
          Sign a wallet nonce to open your merchant workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-7">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="wallet-address">Selected wallet</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <WalletIcon />
              </InputGroupAddon>
              <InputGroupInput id="wallet-address" readOnly value={address || 'No wallet selected yet'} />
            </InputGroup>
          </Field>

          <Button className="h-10 w-full" disabled={isBusy || !hasInjectedWallet} onClick={handleConnect} type="button">
            {isBusy ? <Spinner data-icon="inline-start" /> : <WalletIcon data-icon="inline-start" />}
            {isBusy ? 'Signing in...' : 'Continue with a wallet'}
            {!isBusy ? <ArrowRightIcon data-icon="inline-end" /> : null}
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            <span>SESSION</span>
            <Separator className="flex-1" />
          </div>

          <Alert className="border-muted bg-muted/40">
            <StatusIcon />
            <AlertTitle>{statusTitle}</AlertTitle>
            <AlertDescription>{statusDescription}</AlertDescription>
          </Alert>

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
