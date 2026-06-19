import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Anthropic from '@anthropic-ai/sdk'
import { ratelimit } from '@/lib/ratelimit'
import { todaySA } from '@/lib/date-sa'

const client = new Anthropic()

const SYSTEM_TEMPLATE = `You are a booking assistant for Kanaan Guest Farm in South Africa.
Extract booking details from the user's message and return a JSON object.
Today's date is {TODAY}.

Rooms:
- Rooms 1-7, 16-18: Premium, R350/person/night, R450 solo
- Rooms 8-14: Budget, R250/person/night, R350 solo
- Room 15: Dorm, R200/bed/night
- Camping A-C: R250/spot/night

Return ONLY valid JSON with these fields (null if unknown):
{
  "guestName": string | null,
  "contact": string | null,
  "checkIn": "YYYY-MM-DD" | null,
  "checkOut": "YYYY-MM-DD" | null,
  "adults": number | null,
  "children": number | null,
  "roomPreference": string | null,
  "specialRequests": string | null,
  "estimatedTotal": number | null
}`

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { success } = await ratelimit.limit(userId)
  if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { text } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 })

  try {
    const system = SYSTEM_TEMPLATE.replace('{TODAY}', todaySA())
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: text }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : '{}'
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
    return NextResponse.json(parsed)
  } catch (err: any) {
    console.error('[parse-booking]', err)
    return NextResponse.json({ error: 'Failed to parse booking' }, { status: 500 })
  }
}
