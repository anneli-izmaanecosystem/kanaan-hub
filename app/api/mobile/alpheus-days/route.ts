import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { db, alpheusDays, alpheusDayClients } from '@/lib/db'
import { desc, eq } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const days = await db.select().from(alpheusDays).orderBy(desc(alpheusDays.dayDate)).limit(30)
  const clients = await db.select().from(alpheusDayClients)
  return NextResponse.json(days.map(d => ({ ...d, clients: clients.filter(c => c.dayId === d.id) })))
}

export async function POST(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  try {
    const body = await req.json()
    const { dayDate, dayType, notes, clients: clientBlocks } = body
    if (!dayDate) return NextResponse.json({ error: 'dayDate required' }, { status: 400 })
    if (!dayType) return NextResponse.json({ error: 'dayType required' }, { status: 400 })

    const [day] = await db.insert(alpheusDays).values({
      dayDate, dayType, notes: notes ?? null, status: 'draft', createdBy: 'mobile',
    }).returning()

    const insertedClients = []
    if (clientBlocks?.length) {
      for (const c of clientBlocks) {
        const [cl] = await db.insert(alpheusDayClients).values({
          dayId: day.id, clientName: c.clientName,
          billingInfo: c.billingInfo ?? null, hoursWorked: String(c.hoursWorked),
        }).returning()
        insertedClients.push(cl)
      }
    }
    return NextResponse.json({ day, clients: insertedClients }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to save day' }, { status: 500 })
  }
}
