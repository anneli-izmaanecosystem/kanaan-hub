import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { forwardToBot } from '@/lib/bot'

// Drivers live with the bot, which matches their replies by WhatsApp number; the service
// validates and stores them (lib/bot.ts).

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  return forwardToBot('GET', '/dashboard/drivers')
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  return forwardToBot('POST', '/dashboard/drivers', await req.json().catch(() => null))
}
