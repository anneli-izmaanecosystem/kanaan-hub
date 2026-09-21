// Fire-and-forget mirror of the live guest-booking conversation into the Python
// whatsapp-backend service, purely so its admin UI has something to show. Next.js stays
// the only thing that talks to Meta and Stripe for this flow — mirroring never blocks
// the booking, and a mirroring failure must never surface to a real guest.

import { toE164 } from './config'

const MIRROR_URL = process.env.WHATSAPP_MIRROR_URL
const MIRROR_SECRET = process.env.WHATSAPP_MIRROR_SECRET

function mirrorConfigured(): boolean {
  return Boolean(MIRROR_URL && MIRROR_SECRET)
}

function post(path: string, body: Record<string, unknown>) {
  if (!mirrorConfigured()) return
  fetch(`${MIRROR_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': MIRROR_SECRET! },
    body: JSON.stringify(body),
  }).catch(err => console.warn('[whatsapp mirror] failed —', err))
}

export function mirrorOutbound(
  to: string,
  messageType: string,
  opts: { templateName?: string; body?: string | null; waMessageId?: string | null; payload?: unknown } = {},
) {
  post('/internal/messages', {
    wa_message_id: opts.waMessageId ?? null,
    direction: 'outbound',
    phone_number: toE164(to),
    message_type: messageType,
    template_name: opts.templateName ?? null,
    body: opts.body ?? null,
    payload: opts.payload ?? {},
    status: 'sent',
  })
}

export function mirrorInbound(
  from: string,
  messageType: string,
  opts: { body?: string | null; waMessageId?: string; payload?: unknown } = {},
) {
  post('/internal/messages', {
    wa_message_id: opts.waMessageId ?? null,
    direction: 'inbound',
    phone_number: toE164(from),
    message_type: messageType,
    body: opts.body ?? null,
    payload: opts.payload ?? {},
    status: 'received',
  })
}

export function mirrorStatus(waMessageId: string, status: string, errorMessage?: string | null) {
  post('/internal/messages/status', { wa_message_id: waMessageId, status, error_message: errorMessage ?? null })
}

export function mirrorFlow(
  phoneNumber: string,
  currentStep: string,
  context: unknown,
  opts: { flowName?: string; status?: string } = {},
) {
  post('/internal/flows', {
    phone_number: toE164(phoneNumber),
    flow_name: opts.flowName ?? 'kanaan_car_booking',
    status: opts.status ?? 'active',
    current_step: currentStep,
    context: context ?? {},
  })
}
