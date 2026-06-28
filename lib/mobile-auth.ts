import { NextRequest } from 'next/server'

export function checkMobileAuth(req: NextRequest): boolean {
  const key = req.headers.get('x-mobile-api-key')
  return key === process.env.MOBILE_API_KEY
}
