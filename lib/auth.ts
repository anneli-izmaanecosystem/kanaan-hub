import { auth as clerkAuth, currentUser as clerkCurrentUser } from '@clerk/nextjs/server'

// Clerk only initialises when a publishable key is present. Without one — no .env
// file at all, as in a fresh checkout or CI — every route would throw instead of
// returning a useful response, so auth degrades to a single stub identity and the
// app stays browsable. `authEnabled` is false only when the key is genuinely
// absent, so a deployment that sets the key keeps the real Clerk behaviour.
export const authEnabled = !!(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY
)

// Stands in for a signed-in Clerk user id while auth is disabled. It is a real,
// stable string so rate-limit keys and `uploadedBy` columns still have a value.
export const STUB_USER_ID = 'local-dev-user'

type AuthResult = Awaited<ReturnType<typeof clerkAuth>>

// Drop-in for Clerk's `auth()`. Callers only ever read `userId`, so the stub fills
// that in and leaves the rest of the session object off.
export async function auth(): Promise<AuthResult> {
  if (!authEnabled) return { userId: STUB_USER_ID } as unknown as AuthResult
  return clerkAuth()
}

// Drop-in for Clerk's `currentUser()`. Returns null when disabled, which callers
// already handle — they fall back to the user id for display.
export async function currentUser(): Promise<Awaited<ReturnType<typeof clerkCurrentUser>>> {
  if (!authEnabled) return null
  return clerkCurrentUser()
}
