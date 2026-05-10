"use client"

import Image from "next/image"
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  LockKeyholeIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  WalletCardsIcon,
  WebhookIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const steps = [
  {
    description: "Merchant creates a hosted checkout from the ZamaPay console.",
    icon: ReceiptTextIcon,
    label: "Create",
    title: "Invoice minted",
  },
  {
    description: "Buyer opens a merchant-branded checkout with encrypted amount checks.",
    icon: WalletCardsIcon,
    label: "Checkout",
    title: "Hosted payment",
  },
  {
    description: "Zama rail keeps settlement values private until authorized decrypt.",
    icon: LockKeyholeIcon,
    label: "Encrypt",
    title: "Confidential pay",
  },
  {
    description: "Finality-safe webhook releases fulfillment back to the merchant app.",
    icon: WebhookIcon,
    label: "Release",
    title: "Webhook ready",
  },
]

const timeline = [
  "Project configured",
  "Checkout link issued",
  "Encrypted payment accepted",
  "Finality-safe webhook",
]

export function LandingProductMotion() {
  const [activeStep, setActiveStep] = useState(0)
  const active = steps[activeStep]
  const ActiveIcon = active.icon

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % steps.length)
    }, 2600)

    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="landing-stage relative min-w-0 overflow-hidden rounded-xl border bg-card shadow-2xl shadow-foreground/10">
      <div className="absolute inset-x-0 top-0 h-16 bg-linear-to-b from-background/70 to-transparent" />
      <div className="grid min-w-0 gap-0 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="flex min-w-0 flex-col gap-4 border-b p-4 lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">ZamaPay workspace</div>
              <div className="text-xs text-muted-foreground">Project: merchant-prod</div>
            </div>
            <Badge variant="secondary">
              <ShieldCheckIcon data-icon="inline-start" />
              live rail
            </Badge>
          </div>

          <div className="relative aspect-[4/3] min-w-0 overflow-hidden rounded-lg border bg-muted">
            <Image
              alt="ZamaPay merchant console screenshot"
              className="landing-console-shot object-cover object-top"
              fill
              priority
              sizes="(min-width: 1024px) 360px, 100vw"
              src="/landing/merchant-console.png"
            />
            <div className="absolute inset-x-3 bottom-3 rounded-lg border bg-background/92 p-3 shadow-lg backdrop-blur">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium">Checkout readiness</span>
                <span className="text-muted-foreground">{(activeStep + 1) * 25}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-700"
                  style={{ width: `${(activeStep + 1) * 25}%` }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {steps.map((step, index) => {
              const Icon = step.icon
              const isActive = index === activeStep

              return (
                <Button
                  className="justify-start"
                  key={step.label}
                  onClick={() => setActiveStep(index)}
                  size="sm"
                  type="button"
                  variant={isActive ? "default" : "outline"}
                >
                  <Icon data-icon="inline-start" />
                  {step.label}
                </Button>
              )
            })}
          </div>
        </div>

        <div className="relative min-w-0 p-4">
          <div className="landing-orbit absolute right-6 top-5 hidden size-28 rounded-full border md:block" />
          <div className="relative flex min-h-[25rem] flex-col justify-between gap-6 rounded-lg border bg-background p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm text-muted-foreground">Hosted checkout</div>
                <h2 className="mt-1 text-2xl font-semibold tracking-normal">120 cUSDT</h2>
              </div>
              <Badge>
                <ActiveIcon data-icon="inline-start" />
                {active.label}
              </Badge>
            </div>

            <div className="grid gap-3">
              <MotionRow label="Merchant" value="Merchant checkout" />
              <MotionRow label="Invoice" value="invoice-1b7460" />
              <MotionRow label="Privacy" value="encrypted amount check" />
              <MotionRow label="Release" value={active.title} active />
            </div>

            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2Icon />
                {active.title}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{active.description}</p>
            </div>

            <div className="grid gap-3">
              {timeline.map((item, index) => (
                <div className="grid grid-cols-[1.25rem_1fr] gap-3" key={item}>
                  <div
                    className={cn(
                      "mt-0.5 size-5 rounded-full border transition-colors",
                      index <= activeStep ? "border-primary bg-primary" : "bg-background",
                    )}
                  />
                  <div className={cn("text-sm", index <= activeStep ? "text-foreground" : "text-muted-foreground")}>
                    {item}
                  </div>
                </div>
              ))}
            </div>

            <Button className="w-full" type="button">
              Continue to payment
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MotionRow({ active, label, value }: { active?: boolean; label: string; value: string }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
        active ? "bg-secondary" : "bg-background",
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  )
}
