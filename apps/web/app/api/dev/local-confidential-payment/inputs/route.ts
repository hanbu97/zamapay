import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error:
        'local confidential payment inputs were replaced by /api/dev/local-private-checkout/pay. Buyer payment now signs an intent and the local relayer submits PrivateCheckoutSettlement.',
    },
    { status: 410 },
  )
}
