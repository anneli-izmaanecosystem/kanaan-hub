import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { forwardToBot } from '@/lib/bot'

// One row per phone number that has ever exchanged a message with the WhatsApp number,
// newest activity first — the chat list on the dashboard's WhatsApp tab. Read from the
// WhatsApp service, which owns the database the bot logs into (lib/bot.ts).
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  return forwardToBot('GET', '/dashboard/conversations')
}
