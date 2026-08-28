import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, documents } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { deleteDocument } from '@/lib/storage'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const [row] = await db.select().from(documents).where(eq(documents.id, parseInt(id)))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    await deleteDocument(row.fileUrl)
  } catch (err) {
    // File may already be gone from storage — don't block removing the DB row over it.
    console.warn('[documents DELETE] storage cleanup failed', err)
  }

  await db.delete(documents).where(eq(documents.id, parseInt(id)))
  return NextResponse.json({ ok: true })
}
