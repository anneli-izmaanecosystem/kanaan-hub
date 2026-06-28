import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, fuelFills, fuelAllocations, alpheusDays } from '@/lib/db'
import { eq, and } from 'drizzle-orm'

// PATCH /api/fuel-fills/[id] — update fill or finalise with allocations
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const fillId = parseInt(id)
  if (isNaN(fillId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const body = await req.json()
    const { action, allocations, notes, flag, photoUrl } = body

    if (action === 'finalise') {
      // Validate allocations sum to fill litres
      const [fill] = await db.select().from(fuelFills).where(eq(fuelFills.id, fillId))
      if (!fill) return NextResponse.json({ error: 'Fill not found' }, { status: 404 })

      if (!allocations?.length)
        return NextResponse.json({ error: 'At least one allocation required to finalise' }, { status: 400 })

      const allocTotal = allocations.reduce((sum: number, a: any) => sum + parseFloat(a.litres), 0)
      const fillLitres = parseFloat(String(fill.litres))
      if (Math.abs(allocTotal - fillLitres) > 0.5)
        return NextResponse.json({
          error: `Allocation litres (${allocTotal}L) must equal fill litres (${fillLitres}L)`,
        }, { status: 400 })

      // Wipe existing allocations and re-insert
      await db.delete(fuelAllocations).where(eq(fuelAllocations.fillId, fillId))

      // Auto-match each off-site allocation to an alpheus_days row by date
      const insertedAllocs = []
      for (const a of allocations) {
        let dayId: number | null = null

        if (a.allocType === 'offsite') {
          const [matchedDay] = await db
            .select({ id: alpheusDays.id })
            .from(alpheusDays)
            .where(eq(alpheusDays.dayDate, fill.fillDate))
            .limit(1)
          dayId = matchedDay?.id ?? null
        }

        const cost = parseFloat(a.litres) * parseFloat(String(fill.ratePerLitre))

        const [alloc] = await db.insert(fuelAllocations).values({
          fillId,
          dayId,
          allocType:   a.allocType,
          clientName:  a.clientName ?? null,
          billingInfo: a.billingInfo ?? null,
          hoursWorked: a.hoursWorked != null ? String(a.hoursWorked) : null,
          litres:      String(a.litres),
          cost:        String(cost.toFixed(2)),
          notes:       a.notes ?? null,
        }).returning()

        insertedAllocs.push(alloc)
      }

      // Mark fill as final
      const [updated] = await db
        .update(fuelFills)
        .set({ status: 'final', notes: notes ?? undefined, flag: flag ?? undefined, updatedAt: new Date() })
        .where(eq(fuelFills.id, fillId))
        .returning()

      return NextResponse.json({ fill: updated, allocations: insertedAllocs })
    }

    // Simple field update (notes, photoUrl, flag)
    const [updated] = await db
      .update(fuelFills)
      .set({
        ...(notes    !== undefined && { notes }),
        ...(photoUrl !== undefined && { photoUrl }),
        ...(flag     !== undefined && { flag }),
        updatedAt: new Date(),
      })
      .where(eq(fuelFills.id, fillId))
      .returning()

    return NextResponse.json(updated)
  } catch (err: any) {
    console.error('[fuel-fills PATCH]', err)
    return NextResponse.json({ error: 'Failed to update fill' }, { status: 500 })
  }
}
