import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { db, workers, entities } from '@/lib/db'
import { eq } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const rows = await db
    .select({ worker: workers, entity: entities })
    .from(workers)
    .innerJoin(entities, eq(workers.entityId, entities.id))
    .where(eq(workers.active, true))

  return NextResponse.json(rows.map(({ worker, entity }) => ({
    ...worker,
    entityName: entity.name,
    entityType: entity.entityType,
  })))
}
