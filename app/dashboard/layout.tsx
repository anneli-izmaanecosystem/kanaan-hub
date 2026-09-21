import { Sidebar } from '@/components/sidebar'
import { authEnabled } from '@/lib/auth'
import { dbConfigured } from '@/lib/db'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <div className="print:hidden"><Sidebar authEnabled={authEnabled} /></div>
      <main className="flex flex-1 flex-col overflow-y-auto">
        {/* Without a database every figure reads as zero, which is indistinguishable
            from real empty data. Say which it is rather than letting the page imply
            the farm has no bookings. */}
        {!dbConfigured && (
          <div className="print:hidden border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
            No database connected - every figure below reads as empty. Set{' '}
            <span className="font-mono font-medium">POSTGRES_URL</span> in{' '}
            <span className="font-mono font-medium">.env.local</span> to load real data.
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
