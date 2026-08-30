import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, invoiceUploads } from '@/lib/db'
import { desc } from 'drizzle-orm'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const rows = await db.select().from(invoiceUploads).orderBy(desc(invoiceUploads.createdAt))
  return NextResponse.json(rows)
}
