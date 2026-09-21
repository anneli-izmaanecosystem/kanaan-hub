import { NextRequest } from 'next/server'
import { db, waMessages } from '@/lib/db'
import { verifySignature, verifyChallenge } from '@/lib/whatsapp/verify'
import { handleGuestMessage, startConversation, loadConversation, STEPS } from '@/lib/whatsapp/conversation'
import { handleOpsMessage } from '@/lib/whatsapp/ops'
import { handleDriverMessage } from '@/lib/whatsapp/driver'
import { markRead } from '@/lib/whatsapp/client'
import { mirrorInbound, mirrorStatus } from '@/lib/whatsapp/mirror'
import { readReply, type WaWebhookBody, type WaMessage, type WaStatus } from '@/lib/whatsapp/types'
import { toE164 } from '@/lib/whatsapp/config'
import { isStartKeyword } from '@/lib/whatsapp/trigger'
import { roleFor } from '@/lib/whatsapp/roles'

// Meta calls this endpoint, not a signed-in user, so it sits outside Clerk — proxy.ts
// must treat it as public. Authentication is the X-Hub-Signature-256 HMAC instead.

/** One-off handshake when the webhook URL is saved in the Meta dashboard. */
export async function GET(req: NextRequest) {
  const challenge = verifyChallenge(req.nextUrl.searchParams)
  if (!challenge) return new Response('Forbidden', { status: 403 })
  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

export async function POST(req: NextRequest) {
  // The signature covers the exact bytes Meta sent, so the raw text is read first and
  // parsed only after it verifies.
  const raw = await req.text()

  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new Response('Invalid signature', { status: 401 })
  }

  let body: WaWebhookBody
  try {
    body = JSON.parse(raw) as WaWebhookBody
  } catch {
    return new Response('Malformed JSON', { status: 400 })
  }

  // Meta retries anything that is not answered quickly, and a retry that re-runs the
  // state machine would double-book a car. Every message is therefore processed inside
  // a claim on its wamid, and the response is always 200 so Meta stops resending.
  try {
    await processWebhook(body)
  } catch (err) {
    // Returning 500 makes Meta retry, which for a half-applied state change makes things
    // worse rather than better. Log loudly and accept.
    console.error('[whatsapp] webhook processing failed —', err)
  }

  return new Response('ok', { status: 200 })
}

async function processWebhook(body: WaWebhookBody) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value) continue

      // A Meta app can have more than one WhatsApp number attached. Only let messages
      // delivered to this deployment's configured number reach the Kanaan flow.
      const configuredPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
      if (configuredPhoneNumberId && value.metadata?.phone_number_id !== configuredPhoneNumberId) {
        console.warn('[whatsapp] ignoring webhook for an unconfigured phone number')
        continue
      }

      for (const status of value.statuses ?? []) {
        if (status.status === 'failed') {
          console.error('[whatsapp] delivery failed for', status.id, status.errors)
        }
        mirrorStatus(status.id, status.status, describeStatusError(status))
      }

      for (const message of value.messages ?? []) {
        await handleMessage(message)
      }
    }
  }
}

/**
 * Records the message, then routes it by who sent it.
 *
 * The insert doubles as the idempotency claim: wa_message_id is unique, so a retry of a
 * message already seen conflicts, inserts nothing, and returns early without touching
 * the conversation.
 */
async function handleMessage(message: WaMessage) {
  const phone = toE164(message.from)
  const { replyId, text } = readReply(message)

  const claimed = await db
    .insert(waMessages)
    .values({
      waMessageId: message.id,
      phone,
      role: await roleFor(phone),
      direction: 'inbound',
      kind: message.type,
      body: text || null,
      payload: JSON.stringify(message),
    })
    .onConflictDoNothing({ target: waMessages.waMessageId })
    .returning({ id: waMessages.id })

  if (claimed.length === 0) {
    console.warn('[whatsapp] ignoring repeat delivery of', message.id)
    return
  }

  mirrorInbound(phone, message.type, { body: text || null, waMessageId: message.id, payload: message })

  await markRead(message.id)

  const role = await roleFor(phone)
  if (role === 'guest') {
    const convo = await loadConversation(phone)

    // "nii" is the public entry point. It also deliberately restarts an abandoned
    // conversation so a returning guest never gets dropped into an old booking draft.
    // Typed only: a tapped button whose title happens to be a greeting is a reply, not a restart.
    if (!replyId && isStartKeyword(text)) {
      await startConversation(phone)
      return
    }

    // Ignore unrelated messages until the guest explicitly opts into the flow.
    if (convo.step === STEPS.idle) return

    await handleGuestMessage(phone, message)
    return
  }

  if (role === 'ops') {
    await handleOpsMessage(phone, message)
    return
  }
  await handleDriverMessage(phone, message)
}

function describeStatusError(status: WaStatus): string | null {
  return status.errors?.length ? status.errors.map(e => e.message ?? e.title).join('; ') : null
}
