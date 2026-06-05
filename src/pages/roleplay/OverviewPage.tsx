import { LayoutDashboard } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export default function RoleplayOverviewPage() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E8642C]/10">
          <LayoutDashboard className="h-7 w-7 text-[#E8642C]" />
        </div>
        <p className="text-sm font-semibold text-gray-700">Roleplay Overview</p>
        <p className="mt-1 text-xs text-muted-foreground">Training portal dashboard — KPIs and recent activity</p>
        <span className="mt-4 inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
          Coming soon
        </span>
      </CardContent>
    </Card>
  )
}
