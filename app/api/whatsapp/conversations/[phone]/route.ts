import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { forwardToBot } from '@/lib/bot'

// The full thread with one number, oldest first, plus where the conversation currently
// sits and the trips this number has booked. Read from the WhatsApp service (lib/bot.ts).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const phone = decodeURIComponent((await params).phone).trim()
  return forwardToBot('GET', `/dashboard/conversations/${encodeURIComponent(phone)}`)
}
