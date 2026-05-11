import { Suspense } from 'react'
import DashboardContent from './DashboardContent'

export default function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <DashboardContent searchParamsPromise={searchParams} />
    </Suspense>
  )
}
