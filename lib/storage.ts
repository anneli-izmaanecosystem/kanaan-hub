import { createClient } from '@supabase/supabase-js'

const BUCKET = 'invoice-uploads'

function client() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Uploads a captured invoice photo and returns its public URL. The bucket must exist and
// be public (or fronted by a CDN that is) — invoice photos aren't sensitive enough to need
// signed URLs, and the web dashboard just needs to display them directly.
export async function uploadInvoicePhoto(buffer: Buffer, contentType: string): Promise<string> {
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await client().storage.from(BUCKET).upload(path, buffer, { contentType })
  if (error) throw new Error(`Supabase upload failed: ${error.message}`)

  const { data } = client().storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

// ── Compliance documents (COIDA / UIF certificates, filings) ─────────────────
// Unlike invoice photos these can carry ID numbers and banking details, so the
// bucket is private — `documents.fileUrl` stores the object path, and callers
// resolve it to a short-lived signed URL on read (getDocumentUrl below).
const DOC_BUCKET = 'compliance-documents'
let docBucketReady = false

async function ensureDocBucket() {
  if (docBucketReady) return
  const { data: buckets } = await client().storage.listBuckets()
  if (!buckets?.some(b => b.name === DOC_BUCKET)) {
    const { error } = await client().storage.createBucket(DOC_BUCKET, { public: false })
    // Ignore a race where another request created it first
    if (error && !/already exists/i.test(error.message)) throw new Error(`Failed to create bucket: ${error.message}`)
  }
  docBucketReady = true
}

// Uploads a compliance document and returns its storage path (not a public URL).
export async function uploadDocument(buffer: Buffer, contentType: string, originalName: string): Promise<string> {
  await ensureDocBucket()
  const ext  = originalName.includes('.') ? originalName.split('.').pop() : 'pdf'
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await client().storage.from(DOC_BUCKET).upload(path, buffer, { contentType })
  if (error) throw new Error(`Supabase upload failed: ${error.message}`)

  return path
}

// Resolves a stored document path to a signed URL, valid for `expiresIn` seconds (default 1h).
export async function getDocumentUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await client().storage.from(DOC_BUCKET).createSignedUrl(path, expiresIn)
  if (error) throw new Error(`Failed to sign document URL: ${error.message}`)
  return data.signedUrl
}

export async function deleteDocument(path: string): Promise<void> {
  const { error } = await client().storage.from(DOC_BUCKET).remove([path])
  if (error) throw new Error(`Failed to delete document: ${error.message}`)
}
