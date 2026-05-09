import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Anthropic from '@anthropic-ai/sdk'
import { db, bookings, rooms, employees } from '@/lib/db'
import { eq, gte, and } from 'drizzle-orm'
import { ratelimit } from '@/lib/ratelimit'

const client = new Anthropic()

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { success } = await ratelimit.limit(userId)
  if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { messages } = await req.json()
  if (!Array.isArray(messages)) return NextResponse.json({ error: 'Invalid messages' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]

  const [upcomingBookings, activeRooms, activeStaff] = await Promise.all([
    db.select({ id: bookings.id, guestName: bookings.guestName, checkIn: bookings.checkIn,
                checkOut: bookings.checkOut, roomId: bookings.roomId, status: bookings.status })
      .from(bookings)
      .where(and(gte(bookings.checkIn, today), eq(bookings.status, 'confirmed')))
      .orderBy(bookings.checkIn)
      .limit(20),
    db.select().from(rooms).where(eq(rooms.active, true)),
    db.select({ id: employees.id, name: employees.name, department: employees.department }).from(employees).where(eq(employees.active, true)),
  ])

  const system = `You are a helpful assistant for Kanaan Guest Farm management.
Today is ${today}.

Active rooms: ${activeRooms.map(r => `${r.name} (${r.type}, R${r.ratePp}/pp/night)`).join(', ')}

Upcoming confirmed bookings (next 20):
${upcomingBookings.map(b => `- Booking #${b.id}: ${b.guestName}, Room ${b.roomId}, ${b.checkIn}→${b.checkOut}`).join('\n')}

Active staff: ${activeStaff.map(e => `${e.name} (${e.department || 'Staff'})`).join(', ')}

Be concise and helpful. For booking creation suggest they use the Bookings page.`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      messages: messages.slice(-10),
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    return NextResponse.json({ reply: text })
  } catch (err: any) {
    console.error('[ai chat]', err)
    return NextResponse.json({ error: 'AI unavailable' }, { status: 500 })
  }
}
