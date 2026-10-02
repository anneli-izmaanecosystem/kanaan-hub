import { NextResponse } from 'next/server'

// The WhatsApp booking bot runs in the whatsapp-backend service, not here, and its data —
// trips, drivers, destinations, fare settings, every message — lives in that service's
// database, which this app has no connection to. The Transportation and WhatsApp tabs
// therefore read and edit it through the service's /dashboard API
// (whatsapp-backend/app/routers/dashboard.py). Board actions that message people
// (allocating a driver, cancelling a trip) run there too, so the guest, driver and Anneli
// are told exactly as they would be from WhatsApp.
//
// KANAAN_BOT_URL is the service's base URL, e.g. https://backend-stage.labourlinksoftware.co.za/kanaan
// KANAAN_BOT_SECRET is its INTERNAL_MIRROR_SECRET (sent as X-Internal-Secret).

/**
 * Sends a dashboard request to the WhatsApp service and returns its answer as this
 * route's response. Failures come back as `{ error }`, which is what the pages read.
 */
export async function forwardToBot(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<NextResponse> {
  const base = process.env.KANAAN_BOT_URL
  const secret = process.env.KANAAN_BOT_SECRET
  if (!base || !secret) {
    return NextResponse.json({ error: 'KANAAN_BOT_URL / KANAAN_BOT_SECRET are not set' }, { status: 503 })
  }

  let res: Response
  try {
    res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'X-Internal-Secret': secret,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      // Allocating waits for WhatsApp to deliver each card before sending the next.
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    // On this machine the service is the simulator, which stops with a restart: say so.
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(base)
    const error = local && (err as Error).name !== 'TimeoutError'
      ? `The WhatsApp simulator is not running at ${base}. Start it with whatsapp-backend/sim/run-simulator.cmd (npm run dev starts it too).`
      : `WhatsApp service unreachable: ${(err as Error).message}`
    return NextResponse.json({ error }, { status: 502 })
  }

  const json = await res.json().catch(() => null)
  if (res.ok) return NextResponse.json(json)

  // FastAPI puts the reason in `detail`: a sentence for the service's own refusals, a
  // list of field errors when the request did not parse.
  const detail = (json as { detail?: unknown } | null)?.detail
  const error = typeof detail === 'string' ? detail : `WhatsApp service: ${res.status} ${res.statusText}`.trim()
  if (res.status === 401) {
    // Our secret, not the signed-in user, was refused; passing 401 on would read as a logout.
    return NextResponse.json({ error: 'WhatsApp service refused KANAAN_BOT_SECRET' }, { status: 502 })
  }
  if (res.status === 422) return NextResponse.json({ error }, { status: 400 })
  return NextResponse.json({ error }, { status: res.status >= 500 ? 502 : res.status })
}
