import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { forwardToBot } from '@/lib/bot'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  return forwardToBot('PATCH', `/dashboard/destinations/${encodeURIComponent(id)}`, await req.json().catch(() => null))
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  return forwardToBot('DELETE', `/dashboard/destinations/${encodeURIComponent(id)}`)
}
