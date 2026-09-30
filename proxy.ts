import { NextResponse } from 'next/server'
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Read inline rather than importing the flag from lib/auth: proxy runs separately
// from render code and shouldn't lean on shared modules (see Next's proxy docs).
const publishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

// Meta's and Paystack's webhooks go to the whatsapp-backend service, which runs the
// booking bot; nothing here needs to be reachable without signing in.
const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/api/mobile/(.*)'])

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
