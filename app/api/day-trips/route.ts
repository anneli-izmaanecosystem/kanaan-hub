import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { forwardToBot } from '@/lib/bot'

// Guests who tapped Day Trip in the WhatsApp chat. Day trips are not offered yet, so the
// WhatsApp service keeps each request for the admin to follow up (lib/bot.ts).

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  return forwardToBot('GET', '/dashboard/day-trips')
}
