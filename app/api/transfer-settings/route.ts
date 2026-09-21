import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { loadSettings, saveSettings } from '@/lib/whatsapp/settings'
import { normalisePhone } from '../drivers/route'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  return NextResponse.json(await loadSettings())
}

const MONEY = ['fareBase', 'farePerKm', 'fareMinimum', 'noShowFee'] as const
const WHOLE = ['maxChatKm', 'opsResponseMin', 'noShowWaitMin', 'holdBeforeMin', 'driverNudgeMin', 'maxLeadDays'] as const
const FLAGS = ['chargeNoShow', 'muteOpsCommentary'] as const
const PHONES = ['opsWhatsapp', 'opsEscalationWhatsapp'] as const

export async function PATCH(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const patch: Record<string, unknown> = {}

  for (const key of MONEY) {
    if (body[key] === undefined) continue
    if (body[key] === '' || body[key] === null) { patch[key] = null; continue }
    const v = Number(body[key])
    if (!Number.isFinite(v) || v < 0) {
      return NextResponse.json({ error: `${key} must be a positive amount` }, { status: 400 })
    }
    patch[key] = String(v)
  }

  for (const key of WHOLE) {
    if (body[key] === undefined) continue
    const v = Number(body[key])
    if (!Number.isInteger(v) || v < 0) {
      return NextResponse.json({ error: `${key} must be a whole number of minutes, km or days` }, { status: 400 })
    }
    patch[key] = v
  }

  for (const key of FLAGS) {
    if (body[key] !== undefined) patch[key] = Boolean(body[key])
  }

  for (const key of PHONES) {
    if (body[key] === undefined) continue
    if (!body[key]) { patch[key] = null; continue }
    const phone = normalisePhone(body[key])
    if (!phone) return NextResponse.json({ error: `${key} is not a valid number` }, { status: 400 })
    patch[key] = phone
  }

  if (body.opsPhone !== undefined) patch.opsPhone = String(body.opsPhone).trim() || null

  for (const key of ['serviceStart', 'serviceEnd'] as const) {
    if (body[key] === undefined) continue
    if (!body[key]) { patch[key] = null; continue }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body[key]))) {
      return NextResponse.json({ error: `${key} must be HH:MM` }, { status: 400 })
    }
    patch[key] = String(body[key])
  }

  // Charging a no-show with no fee set would take the full fare by accident.
  const merged = { ...(await loadSettings()), ...patch }
  if (merged.chargeNoShow && !merged.noShowFee) {
    return NextResponse.json(
      { error: 'Set a no-show fee before switching no-show charging on' },
      { status: 400 },
    )
  }

  await saveSettings(patch)
  return NextResponse.json(await loadSettings())
}
