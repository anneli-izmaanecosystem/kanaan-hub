import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { db, payrollRuns, entities } from '@/lib/db'
import { eq, desc } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const rows = await db
    .select({ run: payrollRuns, entity: entities })
    .from(payrollRuns)
    .innerJoin(entities, eq(payrollRuns.entityId, entities.id))
    .orderBy(desc(payrollRuns.periodStart))

  return NextResponse.json(rows.map(({ run, entity }) => ({ ...run, entityName: entity.name })))
}
