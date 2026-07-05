import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { syncAllRoomCalendars } from '@/lib/ical-sync'

async function handle(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const isCron = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  try {
    const result = await syncAllRoomCalendars()
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[ical-sync]', err)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
