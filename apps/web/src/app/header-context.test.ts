import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getHeaderSubtitle, type HeaderContext } from './header-context'

const rootFile = (path: string) => readFileSync(resolve(process.cwd(), '../..', path), 'utf8')

describe('global mobile header context', () => {
  it('uses the current user name on the dashboard', () => {
    expect(getHeaderSubtitle('dashboard', 'Krzysiek')).toBe('Dzień dobry, Krzysiek')
  })

  it.each<[HeaderContext, string]>([
    ['calendar', 'Kalendarz rodzinny'],
    ['tasks', 'Zadania'],
    ['shopping', 'Zakupy'],
    ['budget', 'Budżet'],
    ['properties', 'Opłaty stałe'],
    ['notifications', 'Powiadomienia'],
    ['admin', 'Administracja'],
  ])('maps %s to a single shared subtitle', (context, subtitle) => {
    expect(getHeaderSubtitle(context, 'Krzysiek')).toBe(subtitle)
  })

  it('keeps the compact header sticky, overflow-safe and native-safe', () => {
    const header = rootFile('apps/web/src/components/AppHeader.tsx')
    const switcher = rootFile('apps/web/src/features/family/components/FamilySwitcher.tsx')
    const css = rootFile('apps/web/src/styles/index.css')

    expect(header).toContain('sticky top-0 z-30')
    expect(header).toContain('min-w-0 flex-1')
    expect(switcher).toContain("compactBranding='text-[11.5px] font-medium uppercase leading-[1.2] tracking-[.17em] text-[#FFD84D]'")
    expect(switcher).toContain('block truncate ${compact?compactBranding')
    expect(switcher).toContain("compact?compactBranding:'text-xs text-brand-muted'")
    expect(switcher).toContain('appearance-none truncate')
    expect(header).toContain('truncate text-[13.5px]')
    expect(header).toContain('shrink-0')
    expect(css).toContain('@media (max-width: 767px)')
    expect(css).toContain('height: 64px')
    expect(css).toContain('height: calc(64px + var(--safe-area-inset-top')
  })
})
