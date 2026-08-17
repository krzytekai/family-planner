import { useState } from 'react'
import { Plus } from 'lucide-react'
import { QuickTaskModal } from './QuickTaskModal'
import type { NewTaskInput, TaskMember } from '../types'

interface QuickTaskAddProps {
  familyId: string
  members: TaskMember[]
  canCreate: boolean
  saving: boolean
  onCreate: (input: NewTaskInput) => Promise<void>
}

export function QuickTaskAdd({ familyId, members, canCreate, saving, onCreate }: QuickTaskAddProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        disabled={!canCreate}
        title={canCreate ? 'Dodaj szybkie zadanie' : 'Zadania mogą tworzyć dorośli i administratorzy'}
        onClick={() => setOpen(true)}
        className="gold-glow inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gold px-4 py-2.5 text-sm font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Plus className="h-4 w-4" />
        Dodaj szybkie zadanie
      </button>
      {open ? <QuickTaskModal familyId={familyId} members={members} saving={saving} onCreate={onCreate} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
