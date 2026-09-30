import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, trips, tripEvents, drivers } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { BotError, callBot } from '@/lib/bot'

// Manual intervention from the board, for the cases the chat flow cannot reach: a guest
// who phones instead of replying, a driver who texts the owner directly, a trip wedged
// because someone never tapped a button.

const ACTIONS = ['allocate', 'cancel', 'complete', 'no_show'] as const
type Action = (typeof ACTIONS)[number]

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const [trip] = await db.select().from(trips).where(eq(trips.id, parseInt(id)))
  if (!trip) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const events = await db.select().from(tripEvents).where(eq(tripEvents.tripId, trip.id))
  return NextResponse.json({ ...trip, events })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const action = body.action as Action

  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: `Unknown action. One of: ${ACTIONS.join(', ')}` }, { status: 400 })
  }

  const [trip] = await db.select().from(trips).where(eq(trips.id, parseInt(id)))
  if (!trip) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  switch (action) {
    case 'allocate': {
      const [driver] = await db.select().from(drivers).where(eq(drivers.id, Number(body.driverId)))
      if (!driver) return NextResponse.json({ error: 'Driver not found' }, { status: 400 })
      // Same transition the WhatsApp "Accept" path uses: guest confirmed, driver briefed.
      // It messages people, so it runs in the WhatsApp service (lib/bot.ts).
      const failed = await viaBot(`/bot/trips/${trip.id}/allocate`, { driver_id: driver.id })
      if (failed) return failed
      break
    }

    case 'cancel': {
      const failed = await viaBot(`/bot/trips/${trip.id}/cancel`, { reason: body.reason ?? 'cancelled from the board' })
      if (failed) return failed
      break
    }

    case 'complete': {
      await db.update(trips)
        .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
        .where(eq(trips.id, trip.id))
      await db.insert(tripEvents).values({
        tripId: trip.id, actor: 'ops', event: 'completed', detail: 'closed from the board',
      })
      break
    }

    case 'no_show': {
      await db.update(trips)
        .set({ status: 'no_show', updatedAt: new Date() })
        .where(eq(trips.id, trip.id))
      await db.insert(tripEvents).values({
        tripId: trip.id, actor: 'ops', event: 'no_show', detail: body.reason ?? 'marked from the board',
      })
      break
    }
  }

  const [updated] = await db.select().from(trips).where(eq(trips.id, trip.id))
  return NextResponse.json(updated)
}

/** Runs a board action in the WhatsApp service; returns an error response if it failed. */
async function viaBot(path: string, body: object): Promise<NextResponse | null> {
  try {
    await callBot(path, body)
    return null
  } catch (err) {
    const status = err instanceof BotError ? err.status : 502
    return NextResponse.json({ error: (err as Error).message }, { status: status >= 500 ? 502 : status })
  }
}
