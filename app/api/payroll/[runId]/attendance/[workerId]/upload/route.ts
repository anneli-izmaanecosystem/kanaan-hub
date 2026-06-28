import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Anthropic from '@anthropic-ai/sdk'

type Params = { params: Promise<{ runId: string; workerId: string }> }

const client = new Anthropic()

export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, workerId } = await params

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const periodStart = formData.get('periodStart') as string
  const periodEnd   = formData.get('periodEnd') as string
  const workerName  = formData.get('workerName') as string

  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const bytes  = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')
  const mediaType = (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp'

  const prompt = `You are reading a handwritten employee timesheet for ${workerName || 'a worker'}.
The pay period is ${periodStart} to ${periodEnd}.

IMPORTANT RULES FOR READING THIS SHEET:
1. Each row has up to 4 time values: START | LUNCH-OUT | LUNCH-IN | END. The column headers may say "IN | OUT | LUNCH | OUT" or "IN | LUNCH OUT | LUNCH IN | OUT" or similar — ignore the labels, just read the 4 time values left to right.
2. Times are written in 24-hour format: "07.30", "0730", "07:30" all mean 07:30
3. ALWAYS calculate hours: (LUNCH-OUT − START) + (END − LUNCH-IN). Example: 07:30 → 12:00 + 12:30 → 16:00 = 4.5 + 3.5 = 8.0h. You MUST return a numeric hours value — never return null if 4 times are present.
4. If only 2 time values appear (IN and OUT, no lunch), calculate hours as OUT − IN.
5. The SIGN column contains letters like F or E — these are signatures, NOT absence codes. Ignore them.
6. Dates: day-of-month + abbreviation, e.g. "1Mon"=1st, "8Mon"=8th. A handwritten "8" may look like "2" or "3". Month/year from pay period: ${periodStart} to ${periodEnd}.
7. If a row has no time values, the worker was absent that day.
8. Look for any section listing shop deductions, groceries, or store purchases — extract those too.

Extract every day's attendance record AND any shop deductions.

Return ONLY valid JSON in this exact shape, no explanation:
{
  "days": [
    { "date": "YYYY-MM-DD", "present": true, "hours": 8.0, "absent_reason": null, "note": null }
  ],
  "shop_deductions": [
    { "date": "YYYY-MM-DD", "amount": 150.00, "note": "groceries" }
  ],
  "warnings": ["describe any entries that were unclear or hard to read"]
}`

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

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Could not parse timesheet', raw: text }, { status: 422 })

    const parsed = JSON.parse(jsonMatch[0])
    return NextResponse.json({ ok: true, runId, workerId, ...parsed })

  } catch (err: any) {
    console.error('[timesheet upload]', err)
    return NextResponse.json({ error: err.message ?? 'OCR failed' }, { status: 500 })
  }
}
