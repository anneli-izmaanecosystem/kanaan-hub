import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { forwardToBot } from '@/lib/bot'

/**
 * GET /api/trips — every trip from the WhatsApp service (lib/bot.ts), abandoned drafts included.
 * The Dispatch page sorts and filters them itself (app/dashboard/transfers/page.tsx).
 */
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  return forwardToBot('GET', '/dashboard/trips?scope=all')
}
