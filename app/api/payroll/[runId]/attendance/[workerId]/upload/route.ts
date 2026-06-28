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
1. The sheet has columns: Date/Day | Name | IN | LUNCH OUT | LUNCH IN | OUT | SIGN (or similar layout)
2. Times are written in 24-hour format, sometimes as "07.30", "0730", "07:30" — all mean 07:30
3. Calculate hours worked as: (LUNCH OUT - IN) + (OUT - LUNCH IN). E.g. 07:30→12:00 + 12:30→16:00 = 4.5 + 3.5 = 8h
4. The SIGN column contains letters like F (employee signed) or E (employer signed) — these are NOT absence codes, ignore them
5. Dates are written as day-of-month + day abbreviation, e.g. "1Mon"=1st, "8Mon"=8th, "22Mon"=22nd — read carefully, a handwritten "8" may look like "2" or "3"
6. The month and year come from the pay period: ${periodStart} to ${periodEnd}
7. If a row has no IN/OUT times, the worker was absent that day
8. Look for any separate section listing shop deductions, groceries, or store purchases — extract those too

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
