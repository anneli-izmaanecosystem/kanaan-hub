// Sending side of the WhatsApp Cloud API. One function per message shape the car-booking
// flow actually uses; anything the flow does not send is deliberately absent.
//
// The shapes here mirror docs/kanaan-whatsapp-templates.xlsx exactly, including the two
// limits that silently fail: a reply button title is capped at 20 characters, and a
// template's URL button numbers its variables from {{1}} in its own scope rather than
// carrying on from the body.

import { mirrorOutbound } from './mirror'
import { db, waMessages } from '@/lib/db'
import { roleFor } from './roles'
import { toE164 } from './config'

const GRAPH = 'https://graph.facebook.com'

// Bump via env when Meta retires a version; the payload shapes below have been stable
// across recent ones, so this is a config change rather than a code change.
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0'

export interface ReplyButton {
  /** Returned verbatim on the webhook when tapped, so keep these stable. */
  id: string
  title: string
}

export interface ListRow {
  id: string
  title: string
  description?: string
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button'
  sub_type?: 'url' | 'quick_reply'
  index?: string
  parameters: { type: 'text'; text: string }[]
}

/** Thrown for any non-2xx from Graph, with Meta's own error text preserved. */
export class WhatsAppError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message)
    this.name = 'WhatsAppError'
  }
}

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN)
}

async function send(payload: Record<string, unknown>): Promise<string | null> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const token = process.env.WHATSAPP_ACCESS_TOKEN

  // Without credentials, log the payload and carry on. The state machine still advances,
  // so the whole flow can be driven locally without a WABA attached.
  if (!phoneNumberId || !token) {
    console.warn('[whatsapp] not configured — would have sent:', JSON.stringify(payload))
    return null
  }

  const res = await fetch(`${GRAPH}/${API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  })

  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = (json as { error?: { message?: string } } | null)?.error?.message ?? res.statusText
    throw new WhatsAppError(`WhatsApp send failed: ${detail}`, res.status, json)
  }

  const id = (json as { messages?: { id: string }[] } | null)?.messages?.[0]?.id ?? null
  await recordOutbound(payload, id)
  return id
}

/** What a payload reads as in a thread: the text, the card body, or the template name. */
function describePayload(p: Record<string, unknown>): { kind: string; body: string; templateName: string | null } {
  const type = String(p.type ?? 'other')
  if (type === 'text') return { kind: 'text', body: String((p.text as { body: string }).body), templateName: null }
  if (type === 'interactive') {
    const i = p.interactive as { body?: { text: string }; action?: { buttons?: { reply: { title: string } }[]; sections?: { rows: { title: string }[] }[]; parameters?: { display_text: string } } }
    const choices = [
      ...(i.action?.buttons?.map(b => b.reply.title) ?? []),
      ...(i.action?.sections?.flatMap(s => s.rows.map(r => r.title)) ?? []),
      ...(i.action?.parameters?.display_text ? [i.action.parameters.display_text] : []),
    ]
    return { kind: 'interactive', body: `${i.body?.text ?? ''}${choices.length ? `
[${choices.join(' | ')}]` : ''}`, templateName: null }
  }
  if (type === 'template') {
    const t = p.template as { name: string; components?: { type: string; parameters?: { text?: string }[] }[] }
    const params = t.components?.flatMap(c => c.parameters?.map(x => x.text ?? '') ?? []) ?? []
    return { kind: 'template', body: params.join(' · '), templateName: t.name }
  }
  if (type === 'location') {
    const l = p.location as { name?: string; address?: string }
    return { kind: 'location', body: l.name ?? l.address ?? 'location', templateName: null }
  }
  return { kind: type, body: '', templateName: null }
}

/**
 * The outbound half of wa_messages (the webhook writes the inbound half), so the whole
 * thread can be read back on the dashboard and a reply to a template can be traced to
 * its trip. Never allowed to fail a send that Meta has already accepted.
 */
async function recordOutbound(payload: Record<string, unknown>, waMessageId: string | null) {
  if (!waMessageId || typeof payload.to !== 'string') return
  try {
    const phone = toE164(payload.to)
    const { kind, body, templateName } = describePayload(payload)
    await db
      .insert(waMessages)
      .values({ waMessageId, phone, role: await roleFor(phone), direction: 'outbound', kind, templateName, body, payload: JSON.stringify(payload) })
      .onConflictDoNothing({ target: waMessages.waMessageId })
  } catch (err) {
    console.error('[whatsapp] could not record outbound message —', err)
  }
}

/** Plain text. Only valid inside the 24-hour window. */
export async function sendText(to: string, body: string) {
  const id = await send({
    to,
    type: 'text',
    // Links in the body stay tappable; we just don't want Meta rendering a preview card
    // under every message that mentions a phone number or URL.
    text: { body, preview_url: false },
  })
  mirrorOutbound(to, 'text', { body, waMessageId: id })
  return id
}

/**
 * Up to three quick-reply buttons under a body. In-session only — the template
 * equivalent goes through sendTemplate.
 */
export async function sendButtons(
  to: string,
  body: string,
  buttons: ReplyButton[],
  opts: { header?: string; footer?: string } = {},
) {
  if (buttons.length === 0 || buttons.length > 3) {
    throw new Error(`WhatsApp allows 1-3 reply buttons, got ${buttons.length}`)
  }
  for (const b of buttons) {
    if (b.title.length > 20) {
      throw new Error(`Reply button "${b.title}" is ${b.title.length} characters; the limit is 20`)
    }
  }

  const id = await send({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(opts.header ? { header: { type: 'text', text: opts.header } } : {}),
      body: { text: body },
      ...(opts.footer ? { footer: { text: opts.footer } } : {}),
      action: { buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
    },
  })
  mirrorOutbound(to, 'interactive', { body, waMessageId: id })
  return id
}

/**
 * A scrolling list, for anything past three choices — the driver picker, which grows as
 * drivers are added and would otherwise blow the button limit.
 */
export async function sendList(
  to: string,
  body: string,
  buttonLabel: string,
  rows: ListRow[],
  opts: { header?: string; footer?: string; sectionTitle?: string } = {},
) {
  if (rows.length === 0 || rows.length > 10) {
    throw new Error(`A WhatsApp list allows 1-10 rows, got ${rows.length}`)
  }
  for (const r of rows) {
    if (r.title.length > 24) {
      throw new Error(`List row "${r.title}" is ${r.title.length} characters; the limit is 24`)
    }
  }

  const id = await send({
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(opts.header ? { header: { type: 'text', text: opts.header } } : {}),
      body: { text: body },
      ...(opts.footer ? { footer: { text: opts.footer } } : {}),
      action: {
        button: buttonLabel,
        sections: [{ title: opts.sectionTitle ?? 'Choose', rows }],
      },
    },
  })
  mirrorOutbound(to, 'interactive', { body, waMessageId: id })
  return id
}

/** A single link button — used for the card-capture link, which changes per trip. */
export async function sendCtaUrl(to: string, body: string, displayText: string, url: string) {
  const id = await send({
    to,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: body },
      action: { name: 'cta_url', parameters: { display_text: displayText, url } },
    },
  })
  mirrorOutbound(to, 'interactive', { body, waMessageId: id })
  return id
}

/** A pin the recipient can tap through to their maps app. */
export async function sendLocation(
  to: string,
  location: { latitude: number; longitude: number; name?: string; address?: string },
) {
  const id = await send({ to, type: 'location', location })
  mirrorOutbound(to, 'location', { body: location.name ?? location.address ?? null, waMessageId: id, payload: location })
  return id
}

/**
 * A pre-approved template — the only thing that may be sent outside the 24-hour window.
 *
 * `body` parameters fill {{1}}, {{2}}… in submission order. `urlButtonParam` fills the
 * URL button's own {{1}}: it is a separate scope, and numbering it as the next body
 * variable is the mistake that gets a template rejected.
 */
export async function sendTemplate(
  to: string,
  name: string,
  opts: {
    language?: string
    body?: string[]
    header?: string[]
    urlButtonParam?: string
  } = {},
) {
  const components: TemplateComponent[] = []

  if (opts.header?.length) {
    components.push({ type: 'header', parameters: opts.header.map(text => ({ type: 'text', text })) })
  }
  if (opts.body?.length) {
    components.push({ type: 'body', parameters: opts.body.map(text => ({ type: 'text', text })) })
  }
  if (opts.urlButtonParam) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: opts.urlButtonParam }],
    })
  }

  const id = await send({
    to,
    type: 'template',
    template: {
      name,
      // en_GB throughout: WhatsApp has no en_ZA and en_GB matches South African spelling.
      language: { code: opts.language ?? 'en_GB' },
      ...(components.length ? { components } : {}),
    },
  })
  mirrorOutbound(to, 'template', { templateName: name, body: opts.body?.join(' · ') ?? null, waMessageId: id })
  return id
}

/** Grey ticks turn blue. Courtesy only — never gate state on this succeeding. */
export async function markRead(waMessageId: string) {
  try {
    await send({ status: 'read', message_id: waMessageId })
  } catch (err) {
    console.error('[whatsapp] could not mark read —', err)
  }
}
