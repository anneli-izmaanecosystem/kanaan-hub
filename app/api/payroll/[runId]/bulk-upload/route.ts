import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Anthropic from '@anthropic-ai/sdk'
import AdmZip from 'adm-zip'
import { db, payrollRuns, workers } from '@/lib/db'
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

  // Only match workers belonging to this run's entity — prevents cross-entity contamination
  const allWorkers = await db.select().from(workers).where(eq(workers.entityId, run.entityId))

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

  const prompt = `You are reading a handwritten employee timesheet or deductions sheet.
The pay period is ${run.periodStart} to ${run.periodEnd}.

CRITICAL: A single image may contain data for ONE worker OR MULTIPLE workers. Look carefully for section breaks, separate name headers, or grouped rows that belong to different people. Return one entry per worker found.

RULES:
1. Each row has up to 4 time values: START | LUNCH-OUT | LUNCH-IN | END. Column headers may say "IN | OUT | LUNCH | OUT" or "IN | LUNCH OUT | LUNCH IN | OUT" — ignore the labels, just read 4 time values left to right.
2. Times are 24h — "07.30", "0730", "07:30" all mean 07:30
3. ALWAYS calculate hours: (LUNCH-OUT − START) + (END − LUNCH-IN). E.g. 07:30→12:00 + 12:30→16:00 = 4.5+3.5 = 8.0h. Return a numeric value — never null if 4 times are present.
4. If only 2 time values (IN and OUT, no lunch), calculate as OUT − IN.
5. SIGN column letters F/E are signatures — ignore them, not absence codes
5. Dates: day number + abbreviation — "1Mon"=1st, "8Mon"=8th; handwritten "8" may look like "2"
6. Month/year from pay period: ${run.periodStart} to ${run.periodEnd}
7. Rows with no IN/OUT = absent
8. If the sheet is a deductions-only list (no IN/OUT times), return empty days array — do NOT invent attendance
9. Deductions without a specific date: use ${run.periodStart}
10. Shop deduction sections may be labelled "Shop", "Store", "Groceries", or just list items with amounts

Return ONLY valid JSON, no explanation:
{
  "workers": [
    {
      "worker_name": "Name as written on sheet",
      "days": [
        { "date": "YYYY-MM-DD", "present": true, "hours": 8.0, "absent_reason": null, "note": null }
      ],
      "shop_deductions": [
        { "date": "YYYY-MM-DD", "amount": 150.00, "note": "item description" }
      ],
      "warnings": ["any unclear entries for this worker"]
    }
  ]
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

      // Support both old single-worker format and new multi-worker format
      const workerEntries: any[] = parsed.workers
        ?? [{ worker_name: parsed.worker_name ?? '', days: parsed.days ?? [], shop_deductions: parsed.shop_deductions ?? [], warnings: parsed.warnings ?? [] }]

      for (const w of workerEntries) {
        const workerName: string = w.worker_name ?? ''
        const match = allWorkers.find(aw => fuzzyMatch(workerName, aw.name))
        results.push({
          filename:        entry.name,
          workerName,
          workerId:        match?.id ?? null,
          matched:         !!match,
          days:            w.days ?? [],
          shop_deductions: w.shop_deductions ?? [],
          warnings:        w.warnings ?? [],
        })
      }
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

  return NextResponse.json({ ok: true, runWorkers: allWorkers, results })
}
