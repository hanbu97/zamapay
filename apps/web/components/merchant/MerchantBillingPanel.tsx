'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Tilt from 'react-parallax-tilt'
import {
  ArrowRightIcon,
  BadgeCheckIcon,
  CheckCircle2Icon,
  CheckIcon,
  CircleIcon,
  LockKeyholeIcon,
  MinusIcon,
} from 'lucide-react'
import { createPublicClient, createWalletClient, custom, getAddress, http, type Hex } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type BillingCycle,
  type BillingPlan,
  type BillingPlanCatalogEntry,
  type BillingSubscriptionResponse,
} from '@/lib/api'
import { confidentialUsdMockAbi, privateSubscriptionRegistryAbi } from '@/lib/contracts'
import {
  contractEnvironmentConfig,
  type ContractEnvironmentConfig,
} from '@/lib/contract-environment'
import {
  decryptLocalEuint64Handle,
  encryptLocalSubscriptionChange,
} from '@/lib/local-fhevm-browser'
import { cn } from '@/lib/utils'
import { ensureEthereumProvider, ensureWalletChain } from '@/lib/wallet'

type MerchantBillingPanelProps = {
  initialBilling: BillingSubscriptionResponse
  ownerAddress: string
}

type PlanView = {
  plan: BillingPlan
  title: string
  summary: string
  featured?: boolean
  features: string[]
}

type CompareSection = {
  title: string
  rows: Array<{
    label: string
    free: FeatureValue
    growth: FeatureValue
    enterprise: FeatureValue
  }>
}

type FeatureValue = boolean | string

type ChainSubscriptionState = {
  status: 'checking' | 'contract_default' | 'encrypted' | 'anchored' | 'unavailable' | 'error'
  plan: BillingPlan
  billingCycle: BillingCycle
  passId: string | null
  feeBps: number | null
  message: string
}

type BillingChainConfig = {
  chain: ContractEnvironmentConfig['chain']
  token: Hex
  walletChain: ContractEnvironmentConfig['walletChain']
  registry: Hex
}

type SubscriptionProjectionPayload = {
  billingCycle: BillingCycle
  plan: 'growth'
  subscriptionRequestTxHash: Hex
}

async function projectLocalGrowthEntitlement(ownerAddress: string, payload: SubscriptionProjectionPayload) {
  const response = await fetch('/api/dev/project-local-growth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ownerAddress, ...payload }),
  })
  const text = await response.text()

  if (!response.ok) {
    const message = parseLocalProjectionError(text)
    throw new Error(message || `Local-dev Growth projection failed with ${response.status}.`)
  }

  return JSON.parse(text) as BillingSubscriptionResponse
}

function parseLocalProjectionError(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : text
  } catch {
    return text
  }
}

const planViews: PlanView[] = [
  {
    plan: 'free',
    title: 'Free',
    summary: 'Start with hosted checkout and signed project webhooks.',
    features: ['Hosted checkout', 'Project API keys', 'Signed webhooks', 'Local-dev proof loop'],
  },
  {
    plan: 'growth',
    title: 'Growth',
    summary: 'Lower take rate with a private Zama subscription proof.',
    featured: true,
    features: ['Private subscription pass', 'Immutable checkout snapshots', 'Webhook retry outbox', 'Local-dev proof support'],
  },
  {
    plan: 'enterprise',
    title: 'Enterprise',
    summary: 'Talk to sales for negotiated rates and custom settlement policy.',
    features: ['Negotiated checkout fee', 'Custom limits', 'Operational review', 'Dedicated settlement policy'],
  },
]

function buildCompareSections(plansByKey: Map<BillingPlan, BillingPlanCatalogEntry>): CompareSection[] {
  return [
    {
      title: 'Payment processing',
      rows: [
        { label: 'Hosted checkout', free: true, growth: true, enterprise: true },
        { label: 'Dynamic QR / POS', free: true, growth: true, enterprise: true },
        {
          label: 'Platform fee',
          free: formatBps(plansByKey.get('free')?.checkoutFeeBps),
          growth: formatBps(plansByKey.get('growth')?.checkoutFeeBps),
          enterprise: formatBps(plansByKey.get('enterprise')?.checkoutFeeBps),
        },
        { label: 'Checkout billing snapshot', free: true, growth: true, enterprise: true },
      ],
    },
    {
      title: 'Privacy and settlement',
      rows: [
        { label: 'Encrypted subscription proof', free: false, growth: true, enterprise: true },
        { label: 'Local-dev private proof', free: 'Default fee', growth: true, enterprise: true },
        { label: 'Contract fee terms', free: true, growth: true, enterprise: 'Review' },
        { label: 'Custom settlement policy', free: false, growth: false, enterprise: true },
      ],
    },
    {
      title: 'Operations',
      rows: [
        { label: 'Signed webhooks', free: true, growth: true, enterprise: true },
        { label: 'Manual delivery resend', free: true, growth: true, enterprise: true },
        { label: 'Priority retry budget', free: false, growth: true, enterprise: true },
        { label: 'Integration review', free: false, growth: false, enterprise: true },
      ],
    },
  ]
}

function ensureHexAddress(address: string | null | undefined, label: string): Hex {
  if (!address?.startsWith('0x')) {
    throw new Error(`${label} is not deployed in the contract manifest.`)
  }

  return address as Hex
}

function billingCycleFor(plan: BillingPlan, cycle: BillingCycle): BillingCycle {
  return plan === 'growth' ? cycle : 'monthly'
}

function formatPlan(plan: BillingPlan) {
  return planViews.find((item) => item.plan === plan)?.title ?? plan
}

function formatMoney(priceUsd: number | null | undefined, cycle: BillingCycle) {
  if (priceUsd === null || priceUsd === undefined) {
    return { amount: 'Custom', unit: '' }
  }

  return {
    amount: `$${priceUsd.toLocaleString('en-US')}`,
    unit: cycle === 'annual' ? '/ year' : '/ month',
  }
}

function formatMinorUnits(value: number) {
  return `${(value / 1_000000).toLocaleString('en-US', { maximumFractionDigits: 2 })} cUSDT`
}

function formatMinorUnitsBigInt(value: bigint) {
  const whole = value / 1_000000n
  const fraction = value % 1_000000n
  const fractionText = fraction.toString().padStart(6, '0').replace(/0+$/, '')

  return `${whole.toLocaleString('en-US')}${fractionText ? `.${fractionText}` : ''} cUSDT`
}

function formatBps(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Contract required'
  }

  return `${(value / 100).toFixed(2)}%`
}

function valueForPlan(value: FeatureValue) {
  if (value === true) {
    return (
      <span className="inline-flex items-center text-foreground">
        <CheckIcon className="size-4" />
      </span>
    )
  }

  if (value === false) {
    return (
      <span className="inline-flex items-center text-muted-foreground">
        <MinusIcon className="size-4" />
      </span>
    )
  }

  return <span className="text-muted-foreground">{value}</span>
}

function defaultChainState(plansByKey: Map<BillingPlan, BillingPlanCatalogEntry>): ChainSubscriptionState {
  return {
    status: 'checking',
    plan: 'free',
    billingCycle: 'monthly',
    passId: null,
    feeBps: plansByKey.get('free')?.checkoutFeeBps ?? null,
    message: 'Reading subscription pass from chain...',
  }
}

function chainConfigForEnvironment(): BillingChainConfig {
  const config = contractEnvironmentConfig('local-dev')
  const manifest = config.manifest
  const registry = ensureHexAddress(manifest?.contracts.PrivateSubscriptionRegistry ?? null, 'PrivateSubscriptionRegistry')
  const token = ensureHexAddress(manifest?.contracts.ConfidentialUSDMock ?? null, 'ConfidentialUSDMock')

  return {
    chain: config.chain,
    token,
    walletChain: config.walletChain,
    registry,
  }
}

function contractUnavailableMessage(config: BillingChainConfig): string {
  return `PrivateSubscriptionRegistry is not deployed at ${config.registry} on ${config.chain.name}. Start the local chain and run deploy:localhost before reading the chain source.`
}

function chainReadErrorMessage(caught: unknown, config: BillingChainConfig | null): string {
  const fallback = 'Could not read subscription state from the configured contract chain.'
  const message = caught instanceof Error ? caught.message : fallback

  if (!config) {
    return message
  }
  if (message.includes('returned no data') || message.includes('address is not a contract')) {
    return contractUnavailableMessage(config)
  }
  if (message.includes('fetch failed') || message.includes('HTTP request failed')) {
    return `${config.chain.name} RPC is not reachable. Start the local chain before reading the subscription contract.`
  }

  return message
}

export function MerchantBillingPanel({ initialBilling, ownerAddress }: MerchantBillingPanelProps) {
  const router = useRouter()
  const plansByKey = useMemo(() => new Map(initialBilling.plans.map((plan) => [plan.plan, plan])), [initialBilling.plans])
  const compareSections = useMemo(() => buildCompareSections(plansByKey), [plansByKey])
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    initialBilling.subscription.billingCycle === 'annual' ? 'annual' : 'monthly',
  )
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>(
    initialBilling.subscription.plan === 'free' ? 'growth' : initialBilling.subscription.plan,
  )
  const [chainSubscription, setChainSubscription] = useState<ChainSubscriptionState>(() =>
    defaultChainState(plansByKey),
  )
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentPlan = chainSubscription.plan
  const currentCycle = chainSubscription.billingCycle
  const growthCycle = billingCycleFor('growth', billingCycle)
  const growthCatalog = plansByKey.get('growth')
  const growthPriceUsd = growthCycle === 'annual' ? growthCatalog?.annualPriceUsd : growthCatalog?.monthlyPriceUsd
  const growthPriceMinorUnits =
    growthCycle === 'annual' ? growthCatalog?.annualPriceMinorUnits : growthCatalog?.monthlyPriceMinorUnits
  const growthIntentAmount = growthPriceMinorUnits ?? null
  const growthPeriodLabel = growthCycle === 'annual' ? '365 days' : '30 days'
  const isGrowthCurrent = currentPlan === 'growth' && currentCycle === growthCycle
  const growthBusy = busyKey === `growth:${growthCycle}`
  const upgradeDisabled = growthBusy || isGrowthCurrent || !growthCatalog?.selfServe
  const upgradeLabels: Array<[boolean, string]> = [
    [isGrowthCurrent, 'Current entitlement'],
    [growthBusy, 'Processing...'],
    [true, 'Project local-dev Growth'],
  ]
  const upgradeLabel = upgradeLabels.find(([matches]) => matches)?.[1] ?? 'Project local-dev Growth'

  const refreshChainSubscription = useCallback(
    async () => {
      let config: BillingChainConfig | null = null

      try {
        config = chainConfigForEnvironment()
        const publicClient = createPublicClient({ chain: config.chain, transport: http() })
        const registryBytecode = await publicClient.getBytecode({ address: config.registry })

        if (!registryBytecode || registryBytecode === '0x') {
          setChainSubscription({
            status: 'unavailable',
            plan: 'free',
            billingCycle: 'monthly',
            passId: null,
            feeBps: plansByKey.get('free')?.checkoutFeeBps ?? null,
            message: contractUnavailableMessage(config),
          })
          return
        }

        const merchantAddress = getAddress(ownerAddress)
        const passId = (await publicClient.readContract({
          address: config.registry,
          abi: privateSubscriptionRegistryAbi,
          functionName: 'passOfMerchant',
          args: [merchantAddress],
        })) as bigint

        if (passId === 0n) {
          setChainSubscription({
            status: 'contract_default',
            plan: 'free',
            billingCycle: 'monthly',
            passId: null,
            feeBps: plansByKey.get('free')?.checkoutFeeBps ?? null,
            message: 'No subscription pass on chain; contract default fee applies.',
          })
          return
        }

        const termsVersion = (await publicClient.readContract({
          address: config.registry,
          abi: privateSubscriptionRegistryAbi,
          functionName: 'termsVersionOf',
          args: [passId],
        })) as bigint

        setChainSubscription((current) => ({
          status: current.status === 'anchored' ? 'anchored' : 'encrypted',
          plan: initialBilling.subscription.plan,
          billingCycle: initialBilling.subscription.billingCycle,
          passId: passId.toString(),
          feeBps:
            current.status === 'anchored'
              ? current.feeBps
              : plansByKey.get(initialBilling.subscription.plan)?.checkoutFeeBps ?? null,
          message: `Subscription pass #${passId.toString()} found on local-dev; encrypted terms v${termsVersion.toString()}.`,
        }))
      } catch (caught) {
        setChainSubscription({
          status: caught instanceof Error && caught.message.includes('PrivateSubscriptionRegistry') ? 'unavailable' : 'error',
          plan: 'free',
          billingCycle: 'monthly',
          passId: null,
          feeBps: plansByKey.get('free')?.checkoutFeeBps ?? null,
          message: chainReadErrorMessage(caught, config),
        })
      }
    },
    [initialBilling.subscription.billingCycle, initialBilling.subscription.plan, ownerAddress, plansByKey],
  )

  useEffect(() => {
    void refreshChainSubscription()
  }, [refreshChainSubscription])

  async function handlePurchase(plan: BillingPlan = selectedPlan) {
    const cycle = billingCycleFor(plan, billingCycle)
    const catalog = plansByKey.get(plan)
    const priceMinorUnitsValue =
      cycle === 'annual' ? catalog?.annualPriceMinorUnits : catalog?.monthlyPriceMinorUnits
    const intentAmount = priceMinorUnitsValue ?? null
    const isCurrentSelection = currentPlan === plan && currentCycle === cycle
    const canUseLocalProjection = plan === 'growth'

    setSelectedPlan(plan)

    if (!catalog?.selfServe) {
      setError('Enterprise pricing requires a review before the private entitlement can be changed.')
      return
    }

    if (isCurrentSelection) {
      setStatus(`Already on ${formatPlan(plan)} ${cycle}.`)
      setError(null)
      return
    }

    setBusyKey(`${plan}:${cycle}`)
    setError(null)

    try {
      if (canUseLocalProjection) {
        if (intentAmount === null || intentAmount <= 0 || !Number.isSafeInteger(intentAmount)) {
          throw new Error('Growth subscription price is not available in the contract manifest.')
        }

        const config = chainConfigForEnvironment()
        const rpcUrl = config.walletChain.rpcUrls[0]
        if (!rpcUrl) {
          throw new Error('Hardhat RPC URL is missing from the local-dev wallet chain.')
        }

        const provider = ensureEthereumProvider()
        const merchantAddress = getAddress(ownerAddress)
        const priceMinorUnits = BigInt(intentAmount)

        setStatus('Switching wallet to Hardhat Local...')
        await ensureWalletChain(provider, config.walletChain)

        const walletClient = createWalletClient({ chain: config.chain, transport: custom(provider) })
        const publicClient = createPublicClient({ chain: config.chain, transport: http(rpcUrl) })
        const [selectedAddress] = await walletClient.requestAddresses()
        if (!selectedAddress) {
          throw new Error('No wallet account selected.')
        }

        const signerAddress = getAddress(selectedAddress)
        if (signerAddress !== merchantAddress) {
          throw new Error(`Switch MetaMask to the merchant wallet ${merchantAddress.slice(0, 6)}...${merchantAddress.slice(-4)} before upgrading.`)
        }

        const [registryCode, tokenCode] = await Promise.all([
          publicClient.getBytecode({ address: config.registry }),
          publicClient.getBytecode({ address: config.token }),
        ])
        if (!registryCode || registryCode === '0x') {
          throw new Error(contractUnavailableMessage(config))
        }
        if (!tokenCode || tokenCode === '0x') {
          throw new Error(`ConfidentialUSDMock is not deployed at ${config.token} on ${config.chain.name}.`)
        }

        setStatus(`Reading encrypted cUSDT balance for ${signerAddress.slice(0, 6)}...${signerAddress.slice(-4)}...`)
        const balanceHandle = (await publicClient.readContract({
          address: config.token,
          abi: confidentialUsdMockAbi,
          functionName: 'balanceOf',
          args: [signerAddress],
        })) as Hex
        const balance = await decryptLocalEuint64Handle(rpcUrl, balanceHandle)
        if (balance < priceMinorUnits) {
          throw new Error(`Encrypted cUSDT balance is ${formatMinorUnitsBigInt(balance)}; ${formatMinorUnitsBigInt(priceMinorUnits)} is required. Claim local cUSDT before upgrading.`)
        }

        setStatus('Submitting encrypted Growth plan and cUSDT charge...')
        const encryptedUpgrade = await encryptLocalSubscriptionChange({
          chainId: config.chain.id,
          contractAddress: config.registry,
          paidAmount: priceMinorUnits,
          planCode: 2n,
          rpcUrl,
          userAddress: signerAddress,
        })
        const requestTxHash = await walletClient.writeContract({
          account: signerAddress,
          address: config.registry,
          abi: privateSubscriptionRegistryAbi,
          functionName: 'requestMerchantSubscriptionChange',
          args: [merchantAddress, encryptedUpgrade.planCodeHandle, encryptedUpgrade.paidAmountHandle, encryptedUpgrade.inputProof],
        })
        await publicClient.waitForTransactionReceipt({ hash: requestTxHash })

        setStatus('Finalizing the encrypted boolean and projecting Growth entitlement...')
        const projected = await projectLocalGrowthEntitlement(merchantAddress, {
          billingCycle: cycle,
          plan: 'growth',
          subscriptionRequestTxHash: requestTxHash,
        })
        const projectedPlan = projected.plans.find((plan) => plan.plan === 'growth')
        setChainSubscription({
          status: 'anchored',
          plan: 'growth',
          billingCycle: projected.subscription.billingCycle,
          passId: projected.subscription.passId ?? null,
          feeBps: projectedPlan?.checkoutFeeBps ?? null,
          message: `Local-dev Growth entitlement projected from ${projected.subscription.entitlementTxHash?.slice(0, 10) ?? 'operator'}...`,
        })
        setBillingCycle(projected.subscription.billingCycle)
        setSelectedPlan('growth')
        setStatus('Local-dev Growth entitlement projected. New checkout sessions will snapshot the Growth fee.')
        router.refresh()
        return
      }

      throw new Error('Only local-dev Growth projection is enabled in this MVP.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Subscription update failed.')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Billing update failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : status ? (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>Billing</AlertTitle>
          <AlertDescription>{status}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-5 rounded-2xl border bg-background p-4 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex max-w-2xl flex-col gap-2">
            <Badge className="w-fit" variant="secondary">
              <LockKeyholeIcon />
              Private subscription
            </Badge>
            <div className="flex flex-col gap-1">
              <h1 className="text-3xl font-semibold tracking-tight">Upgrade Mermer Pay</h1>
              <p className="text-sm text-muted-foreground">
                Pick the account plan that controls new checkout fee snapshots. The selected tier is proven through a
                local-dev private Zama subscription pass.
              </p>
            </div>
          </div>

          <div className="md:pt-7">
            <Tabs value={billingCycle} onValueChange={(value) => setBillingCycle(value as BillingCycle)}>
              <TabsList>
                <TabsTrigger value="annual">Annual</TabsTrigger>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {planViews.map((plan) => {
            const catalog = plansByKey.get(plan.plan)
            const cycle = billingCycleFor(plan.plan, billingCycle)
            const priceUsd = cycle === 'annual' ? catalog?.annualPriceUsd : catalog?.monthlyPriceUsd
            const price = catalog?.selfServe ? formatMoney(priceUsd, cycle) : formatMoney(null, cycle)
            const isSelected = selectedPlan === plan.plan
            const isCurrent = currentPlan === plan.plan && currentCycle === cycle
            const isGrowth = plan.plan === 'growth'
            const isEnterprise = plan.plan === 'enterprise'
            const accent = isGrowth
              ? 'from-lime-300 via-emerald-400 to-cyan-400'
              : isEnterprise
                ? 'from-slate-300 via-sky-400 to-zinc-500'
                : 'from-zinc-200 via-zinc-300 to-zinc-500'

            return (
              <Tilt
                key={plan.plan}
                className="group h-full"
                glareBorderRadius="1rem"
                glareColor="#ffffff"
                glareEnable
                glareMaxOpacity={0.16}
                glarePosition="all"
                perspective={900}
                scale={1.025}
                tiltMaxAngleX={7}
                tiltMaxAngleY={9}
                transitionSpeed={900}
              >
                <Card
                  className={cn(
                    'relative flex h-full flex-col overflow-hidden transition-[border-color,box-shadow] duration-300 group-hover:shadow-2xl',
                    isEnterprise ? 'cursor-default' : 'cursor-pointer',
                    isGrowth && 'bg-[radial-gradient(circle_at_top_right,rgba(190,242,100,0.28),transparent_36%),linear-gradient(180deg,rgba(255,255,255,1),rgba(250,250,250,1))]',
                    isSelected && !isEnterprise && 'border-foreground shadow-xl ring-2 ring-foreground',
                  )}
                  onClick={() => {
                    if (isEnterprise) {
                      return
                    }
                    setSelectedPlan(plan.plan)
                    setError(null)
                  }}
                  size="sm"
                >
                  <div aria-hidden className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', accent)} />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -right-12 -top-12 size-28 rounded-full bg-lime-300/30 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
                  />
                  <CardHeader>
                    <CardTitle>{plan.title}</CardTitle>
                    <CardDescription>{plan.summary}</CardDescription>
                    <CardAction>
                      {isEnterprise ? (
                        <Badge variant="secondary">Sales</Badge>
                      ) : isCurrent ? (
                        <Badge variant="secondary">Current</Badge>
                      ) : isSelected ? (
                        <Badge variant="default">
                          <CheckIcon />
                          Selected
                        </Badge>
                      ) : (
                        <CircleIcon className="size-4 text-muted-foreground" />
                      )}
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-4">
                    <div className="flex items-end gap-2">
                      <span className="text-3xl font-semibold">{price.amount}</span>
                      {price.unit ? <span className="pb-1 text-sm text-muted-foreground">{price.unit}</span> : null}
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">Checkout fee</span>
                      <span className="font-medium">{catalog ? formatBps(catalog.checkoutFeeBps) : 'Custom'}</span>
                    </div>
                    <Separator />
                    <ul className="flex flex-col gap-2">
                      {plan.features.map((feature) => (
                        <li className="flex items-center gap-2 text-sm" key={feature}>
                          <CheckIcon className="size-4 text-muted-foreground" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {isGrowth ? (
                      <div className="mt-auto flex flex-col gap-3 rounded-xl border bg-background/80 p-3 shadow-sm">
                        <div className="text-sm">
                          <span className="font-medium">Growth charges</span>
                          <span className="text-muted-foreground">
                            {' '}
                            {growthIntentAmount === null ? formatMoney(growthPriceUsd, growthCycle).amount : formatMinorUnits(growthIntentAmount)} for {growthPeriodLabel}.
                          </span>
                        </div>
                        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                          <Badge className="w-fit" variant={chainSubscription.status === 'anchored' ? 'default' : 'secondary'}>
                            {chainSubscription.status === 'anchored' ? 'Chain tier' : 'Chain source'}
                          </Badge>
                          <span>{chainSubscription.message}</span>
                        </div>
                        <Button
                          className="w-full"
                          disabled={upgradeDisabled}
                          onClick={(event) => {
                            event.stopPropagation()
                            void handlePurchase('growth')
                          }}
                        >
                          <BadgeCheckIcon data-icon="inline-start" />
                          {upgradeLabel}
                          <ArrowRightIcon data-icon="inline-end" />
                        </Button>
                      </div>
                    ) : null}
                    {isEnterprise ? (
                      <div className="mt-auto rounded-xl border border-dashed bg-muted/30 p-3">
                        <div className="text-sm font-medium">Contact sales</div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Rate, limits, and settlement policy are negotiated outside the self-serve checkout.
                        </p>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </Tilt>
            )
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Compare tiers and features</h2>
          <p className="text-sm text-muted-foreground">One account subscription controls every project under the merchant workspace.</p>
        </div>

        {compareSections.map((section) => (
          <Card key={section.title} size="sm">
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[42%] whitespace-normal text-[10px] leading-tight sm:text-sm">Feature</TableHead>
                    <TableHead className="w-[18%] text-center text-[10px] leading-tight sm:text-sm">Free</TableHead>
                    <TableHead className="w-[20%] text-center text-[10px] leading-tight sm:text-sm">Growth</TableHead>
                    <TableHead className="w-[20%] text-center text-[10px] leading-tight sm:text-sm">Enterprise</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.rows.map((row) => (
                    <TableRow key={row.label}>
                      <TableCell className="whitespace-normal text-[10px] font-medium leading-tight sm:text-sm">
                        {row.label}
                      </TableCell>
                      <TableCell className="whitespace-normal text-center text-[10px] leading-tight sm:text-sm">
                        {valueForPlan(row.free)}
                      </TableCell>
                      <TableCell className="whitespace-normal text-center text-[10px] leading-tight sm:text-sm">
                        {valueForPlan(row.growth)}
                      </TableCell>
                      <TableCell className="whitespace-normal text-center text-[10px] leading-tight sm:text-sm">
                        {valueForPlan(row.enterprise)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  )
}
