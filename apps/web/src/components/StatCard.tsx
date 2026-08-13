import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string
  detail: string
}

export function StatCard({ icon: Icon, label, value, detail }: StatCardProps) {
  return (
    <article className="surface rounded-2xl p-4 md:p-5">
      <div className="mb-4 flex items-center gap-2 text-sm text-brand-muted">
        <Icon className="h-4 w-4 text-brand-gold" />
        {label}
      </div>
      <div className="text-2xl font-semibold tracking-tight md:text-3xl">{value}</div>
      <p className="mt-1 text-xs text-brand-muted">{detail}</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full w-2/3 rounded-full bg-brand-gold" />
      </div>
    </article>
  )
}
