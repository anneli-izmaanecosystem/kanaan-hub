import { createHmac, timingSafeEqual } from 'node:crypto'

// Meta signs every webhook with the app secret. The endpoint is public and drives money
// movement, so an unsigned or wrongly signed request must never reach the state machine.

/**
 * Verifies the X-Hub-Signature-256 header against the raw request body.
 *
 * The signature covers the exact bytes Meta sent, so this must be handed the body from
 * `request.text()` — re-serialising a parsed object changes key order and whitespace and
 * will never match.
 */
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret) {
    // Fail closed. An unset secret in production would otherwise wave through anything
    // that knows the URL, which is the whole attack.
    console.error('[whatsapp] WHATSAPP_APP_SECRET is not set — rejecting webhook')
    return false
  }
  if (!header?.startsWith('sha256=')) return false

  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')

  // Both are fixed-length hex for a given algorithm, but a truncated or padded header
  // would still make the buffers differ in length, which timingSafeEqual throws on.
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

/**
 * The one-off GET handshake Meta performs when the webhook URL is first saved. Returns
 * the challenge to echo back, or null if the verify token does not match.
 */
export function verifyChallenge(params: URLSearchParams): string | null {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  if (!expected) return null

  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  return mode === 'subscribe' && token === expected && challenge ? challenge : null
}
