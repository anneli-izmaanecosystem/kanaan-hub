// The slice of Meta's webhook payload this flow reads. Meta sends a deeply nested
// envelope with far more in it; typing only what we consume keeps the parsing honest
// about what the state machine actually depends on.

export interface WaContact {
  wa_id: string                 // sender's number, digits only, no '+'
  profile?: { name?: string }
}

/**
 * Present when the message is a reply to one of ours — every tap on a template's
 * quick-reply button carries it, and `id` is the wamid of the template that was tapped.
 * That is how a tap on "Accept" is tied back to the trip whose card it was on.
 */
export interface WaContext {
  from: string
  id: string
}

export interface WaTextMessage {
  from: string
  id: string
  timestamp: string
  type: 'text'
  text: { body: string }
  context?: WaContext
}

/**
 * A tap on a template's quick-reply button. Unlike in-session buttons these carry no
 * id we chose — only the visible text (and a payload that defaults to the same text),
 * so handlers match on wording.
 */
export interface WaButtonMessage {
  from: string
  id: string
  timestamp: string
  type: 'button'
  button: { payload: string; text: string }
  context?: WaContext
}

export interface WaInteractiveMessage {
  from: string
  id: string
  timestamp: string
  type: 'interactive'
  interactive:
    | { type: 'button_reply'; button_reply: { id: string; title: string } }
    | { type: 'list_reply';   list_reply:   { id: string; title: string; description?: string } }
  context?: WaContext
}

export interface WaLocationMessage {
  from: string
  id: string
  timestamp: string
  type: 'location'
  location: { latitude: number; longitude: number; name?: string; address?: string }
  context?: WaContext
}

/** Anything we receive but do not act on — images, stickers, reactions, audio. */
export interface WaOtherMessage {
  from: string
  id: string
  timestamp: string
  type: string
  context?: WaContext
}

export type WaMessage =
  | WaTextMessage
  | WaButtonMessage
  | WaInteractiveMessage
  | WaLocationMessage
  | WaOtherMessage

/** Delivery receipts. Useful for diagnosing a template that silently never lands. */
export interface WaStatus {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  recipient_id: string
  errors?: { code: number; title: string; message?: string }[]
}

export interface WaChangeValue {
  messaging_product: 'whatsapp'
  metadata: { display_phone_number: string; phone_number_id: string }
  contacts?: WaContact[]
  messages?: WaMessage[]
  statuses?: WaStatus[]
}

export interface WaWebhookBody {
  object: string
  entry: { id: string; changes: { field: string; value: WaChangeValue }[] }[]
}

/** What the reply actually was, flattened to the two things the state machine needs. */
export interface InboundReply {
  /** Button/list id when tapped, else null — ids are stable, titles are not. */
  replyId: string | null
  /** Typed text, or the tapped button's visible title. */
  text: string
}

export function isTextMessage(m: WaMessage): m is WaTextMessage {
  return m.type === 'text'
}

export function isInteractiveMessage(m: WaMessage): m is WaInteractiveMessage {
  return m.type === 'interactive'
}

export function isLocationMessage(m: WaMessage): m is WaLocationMessage {
  return m.type === 'location'
}

export function isButtonMessage(m: WaMessage): m is WaButtonMessage {
  return m.type === 'button'
}

/**
 * Flattens a message into the id/text pair the state machine branches on. A tapped
 * button carries an id we chose when sending; typed text carries none, so callers
 * must handle a null id rather than assuming a tap.
 */
export function readReply(m: WaMessage): InboundReply {
  if (isInteractiveMessage(m)) {
    const i = m.interactive
    return i.type === 'button_reply'
      ? { replyId: i.button_reply.id, text: i.button_reply.title }
      : { replyId: i.list_reply.id,   text: i.list_reply.title }
  }
  if (isButtonMessage(m)) return { replyId: null, text: (m.button.text || m.button.payload).trim() }
  if (isTextMessage(m)) return { replyId: null, text: m.text.body.trim() }
  return { replyId: null, text: '' }
}

/**
 * Whether a reply is one of the given button labels (or typed equivalents). Template
 * buttons come back as text only, so wording is the contract there — keep these
 * comparisons against the exact labels submitted to Meta.
 */
export function said(reply: InboundReply, ...labels: string[]): boolean {
  const t = reply.text.trim().toLowerCase()
  return labels.some(l => l.toLowerCase() === t)
}
