import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, fuelAllocations } from '@/lib/db'
import { eq } from 'drizzle-orm'

// PATCH /api/fuel-allocations/[id] — per-job "paid" flag, independent of the client invoice's
// own payment status (an invoice can bundle several jobs; this tracks cash received per job).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const allocId = parseInt(id)
  if (isNaN(allocId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { paid } = await req.json()
    if (typeof paid !== 'boolean')
      return NextResponse.json({ error: 'paid must be a boolean' }, { status: 400 })

    const [updated] = await db
      .update(fuelAllocations)
      .set({ paid })
      .where(eq(fuelAllocations.id, allocId))
      .returning()
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json(updated)
  } catch (err: any) {
    console.error('[fuel-allocations PATCH]', err)
    return NextResponse.json({ error: 'Failed to update allocation' }, { status: 500 })
  }
}
