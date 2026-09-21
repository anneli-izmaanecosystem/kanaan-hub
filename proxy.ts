import { NextResponse } from 'next/server'
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Read inline rather than importing the flag from lib/auth: proxy runs separately
// from render code and shouldn't lean on shared modules (see Next's proxy docs).
const publishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

// /api/whatsapp is called by Meta, which cannot sign in. It authenticates itself with
// the X-Hub-Signature-256 HMAC that the route verifies before doing anything.
const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/api/mobile/(.*)', '/api/whatsapp/(.*)'])

// With no publishable key Clerk can't start, and protecting every route behind it
// would make the whole app unreachable. Pass requests through instead, matching
// lib/auth.ts, which hands routes a stub user id under the same condition.
export default publishableKey
  ? clerkMiddleware(
      async (auth, req) => {
        if (!isPublicRoute(req)) {
          await auth.protect()
        }
      },
      { publishableKey },
    )
  : () => NextResponse.next()

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
