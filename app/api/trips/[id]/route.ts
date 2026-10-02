import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { forwardToBot } from '@/lib/bot'

// Manual intervention from the board, for the cases the chat flow cannot reach: a guest
// who phones instead of replying, a driver who texts the owner directly, a trip wedged
// because someone never tapped a button. Runs in the WhatsApp service (lib/bot.ts).
// PATCH body: { action: 'allocate' | 'cancel' | 'complete' | 'no_show', driverId?, reason? }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  return forwardToBot('GET', `/dashboard/trips/${encodeURIComponent(id)}`)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  return forwardToBot('PATCH', `/dashboard/trips/${encodeURIComponent(id)}`, await req.json().catch(() => null))
}
