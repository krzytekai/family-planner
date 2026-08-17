import type { LucideIcon } from 'lucide-react'

interface ComingSoonCardProps {
  icon: LucideIcon
  title: string
  description: string
  compact?: boolean
}

export function ComingSoonCard({ icon: Icon, title, description, compact = false }: ComingSoonCardProps) {
  return (
    <article className={`surface rounded-2xl ${compact ? 'p-5' : 'grid min-h-64 place-items-center p-6 text-center'}`}>
      <div className={compact ? 'flex items-center gap-3' : ''}>
        <div className={`grid place-items-center rounded-2xl bg-brand-gold/10 text-brand-gold ${compact ? 'h-10 w-10 shrink-0' : 'mx-auto h-12 w-12'}`}><Icon className={compact ? 'h-5 w-5' : 'h-6 w-6'} /></div>
        <div className={compact ? '' : 'mt-4'}>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-brand-muted">{description}</p>
        </div>
      </div>
    </article>
  )
}
