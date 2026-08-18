import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('mobile interface density', () => {
  it('keeps the navigation compact, evenly divided and safe-area aware', () => {
    const nav = source('src/components/MobileNav.tsx')
    const css = source('src/styles/index.css')
    expect(nav).toContain('h-12 grid-cols-5')
    expect(nav).toContain('h-10 w-10')
    expect(nav).toContain("active ? <span")
    expect(nav).toContain('text-[9px]')
    expect(nav).toContain('h-[18px] w-[18px]')
    expect(css).toContain('env(safe-area-inset-bottom, 0px)')
  })

  it('separates compact shopping visuals from touch targets', () => {
    const row = source('src/features/shopping/components/ShoppingItemRow.tsx')
    const view = source('src/features/shopping/components/ShoppingView.tsx')
    expect(row).toContain('h-11 w-11')
    expect(row).toContain('h-7 w-7')
    expect(row).toContain('h-10 w-10')
    expect(view).toContain('h-7 shrink-0 whitespace-nowrap')
    expect(view).toContain('overflow-x-auto')
  })
})
