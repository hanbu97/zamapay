import { NextResponse } from 'next/server'

const SESSION_COOKIE_NAME = 'zamapay_session'

export async function POST() {
  const response = new NextResponse(null, { status: 204 })
  response.cookies.set({
    httpOnly: true,
    maxAge: 0,
    name: SESSION_COOKIE_NAME,
    path: '/',
    sameSite: 'lax',
    value: '',
  })

  return response
}
