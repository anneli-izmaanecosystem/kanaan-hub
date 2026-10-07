import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { forwardToBot } from '@/lib/bot'

/**
 * GET /api/trips — read from the WhatsApp service (lib/bot.ts), newest request first
 *   ?status=all|upcoming|running|completed   — all by default
 *   ?date=YYYY-MM-DD                         — the pickup day (SAST); every day if left out
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const params = new URLSearchParams()
  for (const key of ['status', 'date']) {
    const value = req.nextUrl.searchParams.get(key)
    if (value) params.set(key, value)
  }
  return forwardToBot('GET', `/dashboard/trips?${params}`)
}
