import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootFile = (path: string) => readFileSync(resolve(process.cwd(), '../..', path), 'utf8')

describe('Android foundation', () => {
  it('uses the local Vite bundle and secure Android defaults', () => {
    const config = rootFile('capacitor.config.ts')
    const manifest = rootFile('android/app/src/main/AndroidManifest.xml')

    expect(config).toContain("appId: 'pl.turscy.planer'")
    expect(config).toContain("webDir: 'apps/web/dist'")
    expect(config).toContain('allowMixedContent: false')
    expect(config).not.toContain('server:')
    expect(manifest).toContain('android.permission.INTERNET')
    expect(manifest).not.toContain('usesCleartextTraffic')
  })

  it('keeps native safe areas and controlled Back handling wired', () => {
    const css = rootFile('apps/web/src/styles/index.css')
    const app = rootFile('apps/web/src/app/App.tsx')

    expect(css).toContain('--safe-area-inset-top')
    expect(css).toContain('--safe-area-inset-bottom')
    expect(css).toContain('100dvh')
    expect(app).toContain('useNativeBackButton')
    expect(app).toContain('NATIVE_BACK_EVENT')
  })
})
