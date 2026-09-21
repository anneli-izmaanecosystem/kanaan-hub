import { NextRequest } from 'next/server'

export function checkMobileAuth(req: NextRequest): boolean {
  // With MOBILE_API_KEY unset there is no secret to match against, so deny
  // outright rather than leaning on an absent header not comparing equal to it.
  const expected = process.env.MOBILE_API_KEY
  if (!expected) return false

  return req.headers.get('x-mobile-api-key') === expected
}
