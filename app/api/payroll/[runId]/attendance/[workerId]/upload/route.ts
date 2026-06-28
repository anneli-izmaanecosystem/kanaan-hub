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

  const prompt = `You are reading a handwritten or printed employee timesheet for ${workerName || 'a worker'}.
The pay period is ${periodStart} to ${periodEnd}.

Extract every day's attendance record. For each day return:
- date (YYYY-MM-DD format)
- present (true/false)
- hours (number or null if not shown or not applicable)
- absent_reason (null, "sick", "annual_leave", "unpaid", or "other")
- note (any written note for that day, or null)

Only include days that appear in the timesheet. If a day is not shown, omit it.
Return ONLY valid JSON in this exact shape, no explanation:
{
  "days": [
    { "date": "YYYY-MM-DD", "present": true, "hours": 6.5, "absent_reason": null, "note": null }
  ],
  "warnings": ["any issues or unclear entries"]
}`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
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
