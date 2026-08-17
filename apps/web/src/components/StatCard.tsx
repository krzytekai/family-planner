import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  onClick?: () => void
}

export function StatCard({ icon: Icon, label, value, detail, onClick }: StatCardProps) {
  const content = (
    <>
      <div className="mb-4 flex items-center gap-2 text-sm text-brand-muted">
        <Icon className="h-4 w-4 text-brand-gold" />
        {label}
      </div>
      <div className="text-2xl font-semibold tracking-tight md:text-3xl">{value}</div>
      <p className="mt-1 text-xs text-brand-muted">{detail}</p>
    </>
  )

  if (onClick) return <button type="button" onClick={onClick} className="surface rounded-2xl p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-gold/30 md:p-5">{content}</button>
  return <article className="surface rounded-2xl p-4 md:p-5">{content}</article>
}
