// The WhatsApp booking bot runs in the whatsapp-backend service, not here. The board's
// manual actions that have to message people (allocating a driver, cancelling a trip)
// go through its internal API, so the guest, driver and Anneli are told exactly as they
// would be from WhatsApp.
//
// KANAAN_BOT_URL is the service's base URL, e.g. https://backend-stage.labourlinksoftware.co.za/kanaan
// KANAAN_BOT_SECRET is its INTERNAL_MIRROR_SECRET (sent as X-Internal-Secret).

export class BotError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'BotError'
  }
}

export async function callBot(path: string, body: object): Promise<unknown> {
  const base = process.env.KANAAN_BOT_URL
  const secret = process.env.KANAAN_BOT_SECRET
  if (!base || !secret) throw new BotError('KANAAN_BOT_URL / KANAAN_BOT_SECRET are not set', 503)

  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = (json as { detail?: string } | null)?.detail ?? res.statusText
    throw new BotError(`WhatsApp service: ${detail}`, res.status)
  }
  return json
}
