import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Anthropic from '@anthropic-ai/sdk'
import AdmZip from 'adm-zip'
import { db, payrollRuns, payrollEntries, workers } from '@/lib/db'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ runId: string }> }

const client = new Anthropic()

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

function fuzzyMatch(parsed: string, name: string): boolean {
  const a = parsed.toLowerCase().replace(/[^a-z]/g, '')
  const b = name.toLowerCase().replace(/[^a-z]/g, '')
  return a === b || b.startsWith(a) || a.startsWith(b) || b.includes(a) || a.includes(b)
}

export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params
  const rid = parseInt(runId)

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, rid))
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  // Get all workers in this run
  const runWorkers = await db
    .select({ worker: workers })
    .from(payrollEntries)
    .innerJoin(workers, eq(payrollEntries.workerId, workers.id))
    .where(eq(payrollEntries.runId, rid))

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const bytes = await file.arrayBuffer()
  const zip = new AdmZip(Buffer.from(bytes))
  const entries = zip.getEntries().filter(e => {
    const ext = e.name.toLowerCase().slice(e.name.lastIndexOf('.'))
    return !e.isDirectory && IMAGE_EXTS.has(ext)
  })

  if (entries.length === 0)
    return NextResponse.json({ error: 'No images found in zip' }, { status: 400 })

  const prompt = `You are reading a handwritten employee timesheet photo.
The pay period is ${run.periodStart} to ${run.periodEnd}.

IMPORTANT RULES:
1. The sheet has columns: Date/Day | Name | IN | LUNCH OUT | LUNCH IN | OUT | SIGN
2. Times are in 24h format — "07.30", "0730", "07:30" all mean 07:30
3. Calculate hours as: (LUNCH OUT - IN) + (OUT - LUNCH IN). E.g. 07:30→12:00 + 12:30→16:00 = 4.5+3.5 = 8h
4. The SIGN column has letters F/E (signatures) — NOT absence codes, ignore them
5. Dates are written as day number + day abbreviation: "1Mon"=1st, "8Mon"=8th, "22Mon"=22nd — a handwritten "8" may look like "2"
6. The month/year comes from the pay period: ${run.periodStart} to ${run.periodEnd}
7. Rows with no IN/OUT times = absent
8. Look for any shop deduction / grocery / store purchase section and extract those too
9. Read the worker's name from the top of the sheet (usually labelled "Name" or written prominently)

Return ONLY valid JSON, no explanation:
{
  "worker_name": "First name or full name as written on the sheet",
  "days": [
    { "date": "YYYY-MM-DD", "present": true, "hours": 8.0, "absent_reason": null, "note": null }
  ],
  "shop_deductions": [
    { "date": "YYYY-MM-DD", "amount": 150.00, "note": "groceries" }
  ],
  "warnings": ["any unclear entries"]
}`

  const results: {
    filename: string
    workerName: string
    workerId: number | null
    matched: boolean
    days: { date: string; present: boolean; hours: number | null; absent_reason: string | null; note: string | null }[]
    shop_deductions: { date: string; amount: number; note: string | null }[]
    warnings: string[]
    error?: string
  }[] = []

  for (const entry of entries) {
    const imgBuffer = entry.getData()
    const base64 = imgBuffer.toString('base64')
    const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf('.'))
    const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')

      const parsed = JSON.parse(jsonMatch[0])
      const workerName: string = parsed.worker_name ?? ''

      // Fuzzy match to workers in the run
      const match = runWorkers.find(rw => fuzzyMatch(workerName, rw.worker.name))

      results.push({
        filename:        entry.name,
        workerName,
        workerId:        match?.worker.id ?? null,
        matched:         !!match,
        days:            parsed.days ?? [],
        shop_deductions: parsed.shop_deductions ?? [],
        warnings:        parsed.warnings ?? [],
      })
    } catch (err: any) {
      results.push({
        filename:        entry.name,
        workerName:      '',
        workerId:        null,
        matched:         false,
        days:            [],
        shop_deductions: [],
        warnings:        [],
        error:           err.message ?? 'Parse failed',
      })
    }
  }

  return NextResponse.json({ ok: true, runWorkers: runWorkers.map(r => r.worker), results })
}
