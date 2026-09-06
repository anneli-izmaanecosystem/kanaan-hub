import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, fuelFills, fuelAllocations, alpheusDays } from '@/lib/db'
import { desc, eq, and } from 'drizzle-orm'

// GET /api/fuel-fills — full list with allocations for recon view
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const fills = await db
    .select()
    .from(fuelFills)
    .orderBy(desc(fuelFills.fillDate), desc(fuelFills.createdAt))

  const allocations = await db.select().from(fuelAllocations)
  const days = await db.select({ id: alpheusDays.id, dayDate: alpheusDays.dayDate }).from(alpheusDays)

  // Attach allocations (with the Alpheus Day date they're matched to, if any) to each fill
  const result = fills.map(f => ({
    ...f,
    allocations: allocations.filter(a => a.fillId === f.id).map(a => ({
      ...a,
      dayDate: a.dayId != null ? days.find(d => d.id === a.dayId)?.dayDate ?? null : null,
    })),
  }))

  return NextResponse.json(result)
}
