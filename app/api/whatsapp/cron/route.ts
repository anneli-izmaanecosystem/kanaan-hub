import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { tick } from '@/lib/whatsapp/scheduler'

// The scheduled sends for the car-booking flow (see lib/whatsapp/scheduler.ts). Vercel
// calls this on the cron in vercel.json; a signed-in user can also poke it from the
// board. Same auth shape as /api/ical-sync.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const isCron = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const report = await tick()
  return NextResponse.json(report)
}
