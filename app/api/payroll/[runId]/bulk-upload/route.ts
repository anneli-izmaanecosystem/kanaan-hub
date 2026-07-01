import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Anthropic from '@anthropic-ai/sdk'
import AdmZip from 'adm-zip'
import { db, payrollRuns, workers } from '@/lib/db'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ runId: string }> }

const client = new Anthropic()

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

function fuzzyMatch(parsed: string, name: string): boolean {
  const a = parsed.toLowerCase().replace(/[^a-z]/g, '')
  const b = name.toLowerCase().replace(/[^a-z]/g, '')
  if (a === b || b.startsWith(a) || a.startsWith(b) || b.includes(a) || a.includes(b)) return true
  // Token-level edit distance — handles OCR variants like Florah/Flora, Nozipho/Nozipo
  const aToks = parsed.toLowerCase().split(/\s+/).map(t => t.replace(/[^a-z]/g, '')).filter(t => t.length >= 4)
  const bToks = name.toLowerCase().split(/\s+/).map(t => t.replace(/[^a-z]/g, '')).filter(t => t.length >= 4)
  return aToks.some(at => bToks.some(bt => editDistance(at, bt) <= 1))
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
  const uploaded = formData.getAll('file') as File[]
  if (uploaded.length === 0) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp'
  type ImageEntry = { name: string; buffer: Buffer; mediaType: ImageMediaType }
  const entries: ImageEntry[] = []

  for (const file of uploaded) {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
    if (ext === '.zip') {
      // Extract images from zip
      const zip = new AdmZip(Buffer.from(await file.arrayBuffer()))
      for (const e of zip.getEntries()) {
        const eext = e.name.toLowerCase().slice(e.name.lastIndexOf('.'))
        if (!e.isDirectory && IMAGE_EXTS.has(eext)) {
          const mt: ImageMediaType = eext === '.png' ? 'image/png' : eext === '.webp' ? 'image/webp' : 'image/jpeg'
          entries.push({ name: e.name, buffer: e.getData(), mediaType: mt })
        }
      }
    } else if (IMAGE_EXTS.has(ext)) {
      const mt: ImageMediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      entries.push({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()), mediaType: mt })
    }
  }

  if (entries.length === 0)
    return NextResponse.json({ error: 'No images found — upload image files or a zip containing images' }, { status: 400 })

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
    const base64 = entry.buffer.toString('base64')
    const mediaType = entry.mediaType

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

        const rawDays: any[] = w.days ?? []
        const warnings: string[] = [...(w.warnings ?? [])]

        // Filter out days with dates outside the pay period — Claude sometimes
        // misreads handwritten month/year, producing dates that get saved to the
        // DB but never appear in the attendance page (which only shows periodStart–periodEnd).
        const validDays = rawDays.filter(d => {
          if (!d.date || d.date < run.periodStart || d.date > run.periodEnd) {
            warnings.push(`Date ${d.date} is outside pay period (${run.periodStart}–${run.periodEnd}) — skipped`)
            return false
          }
          return true
        })

        results.push({
          filename:        entry.name,
          workerName,
          workerId:        match?.id ?? null,
          matched:         !!match,
          days:            validDays,
          shop_deductions: w.shop_deductions ?? [],
          warnings,
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

  // Only expose the fields the client needs (including payStructure for UI decisions)
  const runWorkers = allWorkers.map(w => ({
    id: w.id, name: w.name,
    payStructure: w.payStructure,
    stdHoursPerDay: w.stdHoursPerDay,
  }))
  return NextResponse.json({ ok: true, runWorkers, results })
}
