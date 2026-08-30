import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { uploadInvoicePhoto } from '@/lib/storage'
import { db, invoiceUploads } from '@/lib/db'
import { desc } from 'drizzle-orm'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

// GET /api/mobile/invoice-uploads — recent submissions, so the app can show "did it go through".
export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const rows = await db.select().from(invoiceUploads).orderBy(desc(invoiceUploads.createdAt)).limit(20)
  return NextResponse.json(rows)
}

// POST /api/mobile/invoice-uploads — multipart form: `file` (image) + optional `note`.
export async function POST(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const note = (formData.get('note') as string | null) || null

    if (!file) return NextResponse.json({ error: 'No photo provided' }, { status: 400 })
    if (!ALLOWED_TYPES.has(file.type))
      return NextResponse.json({ error: `Unsupported image type: ${file.type}` }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const imageUrl = await uploadInvoicePhoto(buffer, file.type)

    const [row] = await db.insert(invoiceUploads).values({ imageUrl, note }).returning()
    return NextResponse.json(row, { status: 201 })
  } catch (err: any) {
    console.error('[mobile/invoice-uploads POST]', err)
    return NextResponse.json({ error: err.message ?? 'Failed to submit invoice' }, { status: 500 })
  }
}
