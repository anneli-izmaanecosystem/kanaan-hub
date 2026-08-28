import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db, documents, entities } from '@/lib/db'
import { desc, eq } from 'drizzle-orm'
import { uploadDocument, getDocumentUrl } from '@/lib/storage'

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 15 * 1024 * 1024 // 15MB

// GET /api/documents — list, newest first, with a fresh signed URL per file.
export async function GET(_req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const rows = await db
    .select({ doc: documents, entity: entities })
    .from(documents)
    .innerJoin(entities, eq(documents.entityId, entities.id))
    .orderBy(desc(documents.createdAt))

  const withUrls = await Promise.all(rows.map(async ({ doc, entity }) => ({
    ...doc,
    entityName: entity.tradingName ?? entity.name,
    url: await getDocumentUrl(doc.fileUrl),
  })))

  return NextResponse.json(withUrls)
}

// POST /api/documents — multipart form: file, entityId, category, title, periodLabel?, notes?
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const formData    = await req.formData()
    const file         = formData.get('file') as File | null
    const entityId     = formData.get('entityId') as string | null
    const category     = (formData.get('category') as string | null) || 'other'
    const title        = (formData.get('title') as string | null)?.trim()
    const periodLabel  = (formData.get('periodLabel') as string | null) || null
    const notes        = (formData.get('notes') as string | null) || null

    if (!file)     return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!entityId) return NextResponse.json({ error: 'Missing entityId' }, { status: 400 })
    if (!title)    return NextResponse.json({ error: 'Missing title' }, { status: 400 })
    if (!ALLOWED_TYPES.has(file.type))
      return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 })
    if (file.size > MAX_BYTES)
      return NextResponse.json({ error: 'File too large (max 15MB)' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const path   = await uploadDocument(buffer, file.type, file.name)

    const user = await currentUser()
    const uploadedBy = user?.fullName || user?.primaryEmailAddress?.emailAddress || userId

    const [row] = await db.insert(documents).values({
      entityId: parseInt(entityId),
      category: category as 'coida' | 'uif' | 'payroll' | 'other',
      title,
      periodLabel,
      fileUrl:  path,
      fileName: file.name,
      fileType: file.type,
      notes,
      uploadedBy,
    }).returning()

    return NextResponse.json({ ...row, url: await getDocumentUrl(path) }, { status: 201 })
  } catch (err: any) {
    console.error('[documents POST]', err)
    return NextResponse.json({ error: err.message ?? 'Failed to upload document' }, { status: 500 })
  }
}
