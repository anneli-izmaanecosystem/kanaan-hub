import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { forwardToBot } from '@/lib/bot'

/**
 * GET /api/trips — read from the WhatsApp service (lib/bot.ts)
 *   ?scope=today   — anything departing today (default)
 *   ?scope=open    — not yet finished, whatever the date
 *   ?scope=all     — everything, newest first
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const scope = req.nextUrl.searchParams.get('scope') ?? 'today'
  return forwardToBot('GET', `/dashboard/trips?scope=${encodeURIComponent(scope)}`)
}
