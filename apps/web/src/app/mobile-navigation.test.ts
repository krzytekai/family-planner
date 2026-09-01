import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read=(path:string)=>readFileSync(resolve(process.cwd(),'../..',path),'utf8')
const mobile=read('apps/web/src/components/MobileNav.tsx')
const sidebar=read('apps/web/src/components/Sidebar.tsx')
const app=read('apps/web/src/app/App.tsx')
const header=read('apps/web/src/app/header-context.ts')
const navigation=read('apps/web/src/app/navigation.ts')

describe('hotfix 7.6.3 mobile navigation contract',()=>{
  it('contains five equal destinations without the central quick-add button',()=>{expect(mobile).toContain('grid-cols-5');expect(mobile).not.toContain('onQuickAdd');expect(mobile).not.toContain('canQuickAdd');expect(mobile).not.toContain('<Plus')})
  it('keeps the required destination order',()=>{const labels=['Start','Kalendarz','Zadania','Opłaty stałe','Więcej'];const positions=labels.map(label=>mobile.indexOf(label));expect(positions.every(value=>value>=0)).toBe(true);expect(positions).toEqual([...positions].sort((a,b)=>a-b))})
  it('routes fixed charges to the existing properties view and active state',()=>{expect(mobile).toContain("item('properties','Opłaty stałe',ReceiptText,canProperties)");expect(mobile).toContain('activeView===view');expect(app).toContain("activeView === 'properties' && canProperties")})
  it('keeps properties out of More and retains shopping and budget',()=>{const menu=mobile.slice(mobile.indexOf('mobile-more-menu'),mobile.indexOf('<nav className="mobile-nav'));expect(menu).not.toContain("go('properties')");expect(menu).not.toContain('Nieruchomości');expect(menu).toContain('Zakupy');expect(menu).toContain('Budżet')})
  it('separates guarded administration options',()=>{expect(mobile).toContain('Zarządzanie');expect(mobile).toContain('Rodzina i administracja');expect(mobile).toContain('isPlatformAdmin?');expect(mobile).toContain('Administracja platformy')})
  it('uses the new product name on mobile desktop and header without changing the route',()=>{expect(sidebar).toContain("label:'Opłaty stałe',view:'properties'");expect(header).toContain("properties: 'Opłaty stałe'");expect(navigation).toContain("'properties'")})
})
