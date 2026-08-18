import { Plus } from 'lucide-react'

interface QuickTaskAddProps {
  canCreate: boolean
  onOpen: () => void
}

export function QuickTaskAdd({ canCreate, onOpen }: QuickTaskAddProps) {
  return (
    <button
      type="button"
      disabled={!canCreate}
      title={canCreate ? 'Dodaj szybkie zadanie' : 'Zadania mogą tworzyć dorośli i administratorzy'}
      onClick={onOpen}
      className="mobile-cta gold-glow inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gold px-4 py-2.5 text-sm font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
    >
      <Plus className="h-4 w-4" />
      Dodaj szybkie zadanie
    </button>
  )
}
