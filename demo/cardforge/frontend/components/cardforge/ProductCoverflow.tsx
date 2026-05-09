'use client'

import { BoxIcon, Gamepad2Icon, GemIcon, KeyboardIcon, SparklesIcon, SwordsIcon } from 'lucide-react'
import { EffectCoverflow, Keyboard, Pagination } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import { cn } from '@/lib/utils'

type CardForgeProduct = {
  accent: string
  category: string
  description: string
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
    image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=900&q=80',
    price: 40,
    rarity: 'Common',
    title: 'Neon Credit Card',
  },
  {
    accent: 'from-emerald-300/75 via-teal-500/35 to-black',
    category: 'Arena pass',
    description: 'Match entry, demo wallet credit, and a timed reward slot.',
    image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=900&q=80',
    price: 80,
    rarity: 'Rare',
    title: 'Arena Access Card',
  },
  {
    accent: 'from-fuchsia-300/80 via-purple-600/35 to-black',
    category: 'Weapon crate',
    description: 'Three demo codes released after finality-safe payment.',
    image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=900&q=80',
    price: 120,
    rarity: 'Epic',
    title: 'Mythic Loadout Card',
  },
  {
    accent: 'from-amber-200/80 via-orange-500/35 to-black',
    category: 'Skin vault',
    description: 'Cosmetic vault claim with encrypted checkout delivery.',
    image: 'https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?auto=format&fit=crop&w=900&q=80',
    price: 160,
    rarity: 'Legend',
    title: 'Cyber Skin Card',
  },
  {
    accent: 'from-lime-200/85 via-yellow-400/40 to-black',
    category: 'Full bundle',
    description: 'Premium pack for credits, access, loadout, and vault drops.',
    image: 'https://images.unsplash.com/photo-1593305841991-05c297ba4575?auto=format&fit=crop&w=900&q=80',
    price: 200,
    rarity: 'Mythic',
    title: 'Founders Drop Card',
  },
]

const icons = [GemIcon, Gamepad2Icon, SwordsIcon, KeyboardIcon, BoxIcon]

export function ProductCoverflow() {
  return (
    <section className="flex min-h-[calc(100vh-8.5rem)] w-full min-w-0 items-center overflow-hidden py-8">
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
              <article className="relative h-[29rem] overflow-hidden rounded-2xl border border-black/10 bg-zinc-950 text-white shadow-2xl shadow-black/25">
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
                        <span className="ml-2 align-baseline text-lg font-semibold text-white/70">cUSDT</span>
                      </p>
                    </div>
                    <button
                      aria-label={`Buy ${product.title}`}
                      className="rounded-full bg-[#f4ff00] px-5 py-2 text-sm font-semibold text-black shadow-lg shadow-black/25 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f4ff00]"
                      type="button"
                    >
                      Buy
                    </button>
                  </div>
                </div>
              </article>
            </SwiperSlide>
          )
        })}
      </Swiper>
    </section>
  )
}
