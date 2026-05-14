'use client'

import { useEffect, useRef, useState } from 'react'
import { BoxIcon, Gamepad2Icon, GemIcon, KeyboardIcon, Loader2Icon, SparklesIcon, SwordsIcon } from 'lucide-react'
import { getAddress } from 'viem'
import { EffectCoverflow, Keyboard, Pagination } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import { CardForgeApiError, createCardForgeCheckout, prepareCardForgeCheckout } from '@/lib/cardforge-api'
import type { CardForgeConfig } from '@/lib/config'
import { cn } from '@/lib/utils'

type CardForgeProduct = {
  accent: string
  category: string
  description: string
  id: string
  image: string
  price: number
  rarity: string
  title: string
}

const products: CardForgeProduct[] = [
  {
    accent: 'from-cyan-300/80 via-blue-500/35 to-black',
    category: 'Starter loot',
    description: 'Credit shard, starter boost, and one instant access code.',
    id: 'neon-credit',
    image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=900&q=80',
    price: 40,
    rarity: 'Common',
    title: 'Neon Credit Card',
  },
  {
    accent: 'from-emerald-300/75 via-teal-500/35 to-black',
    category: 'Arena pass',
    description: 'Match entry, demo wallet credit, and a timed reward slot.',
    id: 'arena-access',
    image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=900&q=80',
    price: 80,
    rarity: 'Rare',
    title: 'Arena Access Card',
  },
  {
    accent: 'from-fuchsia-300/80 via-purple-600/35 to-black',
    category: 'Weapon crate',
    description: 'Three demo codes released after finality-safe payment.',
    id: 'mythic-loadout',
    image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=900&q=80',
    price: 120,
    rarity: 'Epic',
    title: 'Mythic Loadout Card',
  },
  {
    accent: 'from-amber-200/80 via-orange-500/35 to-black',
    category: 'Skin vault',
    description: 'Cosmetic vault claim with encrypted checkout delivery.',
    id: 'cyber-skin',
    image: 'https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?auto=format&fit=crop&w=900&q=80',
    price: 160,
    rarity: 'Legend',
    title: 'Cyber Skin Card',
  },
  {
    accent: 'from-lime-200/85 via-yellow-400/40 to-black',
    category: 'Full bundle',
    description: 'Premium pack for credits, access, loadout, and vault drops.',
    id: 'founders-drop',
    image: 'https://images.unsplash.com/photo-1593305841991-05c297ba4575?auto=format&fit=crop&w=900&q=80',
    price: 200,
    rarity: 'Mythic',
    title: 'Founders Drop Card',
  },
]

const icons = [GemIcon, Gamepad2Icon, SwordsIcon, KeyboardIcon, BoxIcon]

type ProductCoverflowProps = {
  buyerWalletAddress?: null | string
  config: CardForgeConfig
}

export function ProductCoverflow({ buyerWalletAddress, config }: ProductCoverflowProps) {
  const [busyProductId, setBusyProductId] = useState<string | null>(null)
  const preparePromisesRef = useRef(new Map<string, Promise<void>>())
  const busyProduct = products.find((product) => product.id === busyProductId) ?? null

  useEffect(() => {
    void prepareProductCheckout('mythic-loadout')
  }, [config.apiBaseUrl])

  function prepareProductCheckout(productId: string) {
    const pending = preparePromisesRef.current.get(productId)
    if (pending) {
      return pending
    }

    const next = prepareCardForgeCheckout(config, productId)
      .catch(() => undefined)
      .finally(() => {
        preparePromisesRef.current.delete(productId)
      })
    preparePromisesRef.current.set(productId, next)
    return next
  }

  async function handleBuy(product: CardForgeProduct) {
    if (busyProductId) {
      return
    }

    setBusyProductId(product.id)

    try {
      await prepareProductCheckout(product.id)
      const activeWalletAddress = await readActiveWalletAddress()
      const checkout = await createCardForgeCheckout(config, product.id, activeWalletAddress ?? buyerWalletAddress)
      window.location.assign(checkoutUrlWithPreferredPayer(checkout.checkoutUrl, activeWalletAddress ?? buyerWalletAddress))
    } catch (caught) {
      const message =
        caught instanceof CardForgeApiError
          ? caught.message
          : 'CardForge could not create the hosted checkout.'
      setBusyProductId(null)
      window.alert(message)
    }
  }

  return (
    <section className="relative flex min-h-[calc(100vh-8.5rem)] w-full min-w-0 items-center overflow-hidden py-8">
      <div className="absolute left-0 top-0 z-10 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-white/72">
        <span>{config.paymentRailLabel}</span>
        <span className="text-white/38">/</span>
        <span>{config.paymentRailMessage}</span>
      </div>
      <Swiper
        centeredSlides
        className="cardforge-coverflow !overflow-visible w-full min-w-0 pb-10"
        coverflowEffect={{
          depth: 80,
          modifier: 1,
          rotate: 10,
          scale: 0.98,
          slideShadows: false,
          stretch: 72,
        }}
        effect="coverflow"
        grabCursor
        initialSlide={2}
        keyboard={{ enabled: true }}
        modules={[EffectCoverflow, Keyboard, Pagination]}
        pagination={{ clickable: true }}
        slideToClickedSlide
        spaceBetween={48}
        slidesPerView="auto"
      >
        {products.map((product, index) => {
          const Icon = icons[index] ?? SparklesIcon

          return (
            <SwiperSlide
              className="!h-auto !w-[min(72vw,20rem)] sm:!w-[20rem] xl:!w-[22rem] 2xl:!w-[23rem]"
              key={product.title}
            >
              <article
                className="relative h-[29rem] overflow-hidden rounded-2xl border border-black/10 bg-zinc-950 text-white shadow-2xl shadow-black/25"
                onFocus={() => {
                  void prepareProductCheckout(product.id)
                }}
                onPointerEnter={() => {
                  void prepareProductCheckout(product.id)
                }}
              >
                <img alt="" className="absolute inset-0 size-full object-cover" src={product.image} />
                <div className={cn('absolute inset-0 bg-gradient-to-b', product.accent)} />
                <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-4">
                  <span className="rounded-full border border-white/15 bg-black/35 px-3 py-1 text-xs font-medium backdrop-blur">
                    {product.rarity}
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium">
                    #{String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <div className="mb-4 inline-flex size-11 items-center justify-center rounded-full bg-white text-black">
                    <Icon className="size-5" />
                  </div>
                  <p className="text-xs font-medium uppercase tracking-normal text-white/65">{product.category}</p>
                  <h2 className="mt-1 text-2xl font-semibold leading-tight tracking-normal">{product.title}</h2>
                  <p className="mt-2 min-h-10 text-sm leading-5 text-white/72">{product.description}</p>
                  <div className="mt-6 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-normal text-white/55">Price</p>
                      <p className="mt-1 text-4xl font-semibold leading-none tracking-normal">
                        {product.price}
                        <span className="ml-2 align-baseline text-lg font-semibold text-white/70">
                          {config.paymentAssetSymbol}
                        </span>
                      </p>
                    </div>
                    <button
                      aria-label={`Buy ${product.title}`}
                      aria-busy={busyProductId === product.id}
                      className="inline-flex min-w-20 items-center justify-center gap-2 rounded-full bg-[#f4ff00] px-5 py-2 text-sm font-semibold text-black shadow-lg shadow-black/25 transition hover:bg-white disabled:cursor-wait disabled:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f4ff00]"
                      disabled={busyProductId !== null}
                      onClick={() => {
                        void handleBuy(product)
                      }}
                      type="button"
                    >
                      {busyProductId === product.id ? (
                        <>
                          <Loader2Icon className="size-4 animate-spin" />
                          Preparing
                        </>
                      ) : (
                        'Buy'
                      )}
                    </button>
                  </div>
                </div>
              </article>
            </SwiperSlide>
          )
        })}
      </Swiper>
      {busyProduct ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#f4ff00]/30 bg-zinc-950/95 p-5 text-white shadow-2xl shadow-black/50">
            <div className="flex items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#f4ff00] text-black">
                <Loader2Icon className="size-6 animate-spin" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Preparing checkout</p>
                <p className="mt-1 truncate text-xs text-white/55">{busyProduct.title}</p>
              </div>
            </div>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-full animate-pulse rounded-full bg-[#f4ff00]" />
            </div>
            <p className="mt-4 text-sm leading-5 text-white/70">
              {checkoutPreparationCopy(config)}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function checkoutPreparationCopy(config: CardForgeConfig) {
  return config.paymentRail === 'evm_erc20'
    ? `Creating the hosted checkout and preparing ${config.paymentAssetSymbol} settlement.`
    : 'Creating the hosted checkout. Sepolia invoice anchoring is warmed in the background.'
}

async function readActiveWalletAddress(): Promise<null | string> {
  const provider = (window as { ethereum?: { request(args: { method: string }): Promise<unknown> } }).ethereum
  if (!provider) {
    return null
  }

  const accounts = await provider.request({ method: 'eth_accounts' })
  if (!Array.isArray(accounts)) {
    return null
  }

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

function checkoutUrlWithPreferredPayer(checkoutUrl: string, buyerWalletAddress?: null | string) {
  const preferredPayer = normalizedAddress(buyerWalletAddress)
  if (!preferredPayer) {
    return checkoutUrl
  }

  try {
    const url = new URL(checkoutUrl, window.location.href)
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
    hash.set('payer', preferredPayer)
    url.hash = hash.toString()
    return url.toString()
  } catch {
    return checkoutUrl
  }
}

function normalizedAddress(value?: null | string) {
  if (!value) {
    return null
  }

  try {
    return getAddress(value)
  } catch {
    return null
  }
}
