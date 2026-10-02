import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { forwardToBot } from '@/lib/bot'

// The tariff and policy numbers the bot quotes and schedules with. Stored by the WhatsApp
// service, which validates each field (lib/bot.ts).

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  return forwardToBot('GET', '/dashboard/transfer-settings')
}

export async function PATCH(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  return forwardToBot('PATCH', '/dashboard/transfer-settings', await req.json().catch(() => null))
}
