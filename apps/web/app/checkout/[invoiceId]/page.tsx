import { notFound } from 'next/navigation'
import { CheckoutPaymentCard } from '@/components/checkout/CheckoutPaymentCard'
import { getContractManifest, getPublicCheckout } from '@/lib/api'

type CheckoutPageProps = {
  params: Promise<{ invoiceId: string }>
}

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { invoiceId } = await params
  const checkout = await getPublicCheckout(invoiceId)

  if (!checkout) {
    notFound()
  }

  const { evmPaymentIntent, invoice } = checkout
  const manifest = invoice.paymentRail === 'evm_erc20' ? null : await getContractManifest(invoice.environment)
  const evmAsset = invoice.paymentRail === 'evm_erc20' ? checkout.evmAsset : null

  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-[#f7f8fb] px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="absolute inset-0 -z-20 bg-[linear-gradient(135deg,#f8fafc_0%,#eef3f8_42%,#f7f1e7_100%)]" />
      <div className="absolute inset-0 -z-10 opacity-70 [background-image:linear-gradient(rgba(15,23,42,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.045)_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="absolute inset-x-0 top-0 -z-10 h-44 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(255,255,255,0))]" />

      <CheckoutPaymentCard
        amountLabel={invoice.amountLabel}
        amountMinorUnits={invoice.amountMinorUnits}
        chainInvoiceId={invoice.chainInvoiceId}
        evmAsset={evmAsset}
        evmPaymentIntent={evmPaymentIntent}
        finalityStatus={invoice.snapshot.finalityStatus}
        invoiceId={invoice.invoiceId}
        manifestChainId={manifest?.chainId ?? null}
        merchantName={invoice.merchantName}
        paymentRail={invoice.paymentRail}
        paymentTruth={invoice.snapshot.paymentTruth}
        settlementAddress={manifest?.contracts.PrivateCheckoutSettlement ?? null}
        title={invoice.title}
        tokenAddress={manifest?.contracts.ConfidentialUSDMock ?? null}
      />
    </main>
  )
}
