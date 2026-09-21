import { SignIn } from '@clerk/nextjs'
import { authEnabled } from '@/lib/auth'

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      {authEnabled ? (
        <SignIn />
      ) : (
        // No Clerk key configured, so there is nothing to sign in to — say so
        // rather than crashing on a <SignIn /> with no provider above it.
        <div className="max-w-sm rounded-lg border border-gray-200 bg-white px-6 py-5 text-center">
          <p className="text-sm font-medium text-gray-900">Sign-in is disabled</p>
          <p className="mt-1 text-xs text-gray-500">
            No Clerk publishable key is configured, so the app is running unauthenticated.
            Set <code className="font-mono">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> to enable sign-in.
          </p>
        </div>
      )}
    </div>
  )
}
