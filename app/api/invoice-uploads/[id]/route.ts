import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, invoiceUploads } from '@/lib/db'
import { eq } from 'drizzle-orm'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const { status } = await req.json()
  if (status !== 'pending' && status !== 'processed')
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })

  const [updated] = await db
    .update(invoiceUploads)
    .set({ status, processedAt: status === 'processed' ? new Date() : null })
    .where(eq(invoiceUploads.id, parseInt(id)))
    .returning()
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(updated)
}
