import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const androidDirectory = resolve(root, 'android')
const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
const tasks = process.argv.slice(2)

if (tasks.length === 0) {
  console.error('Podaj co najmniej jedno zadanie Gradle, np. assembleDebug.')
  process.exit(1)
}

const result = spawnSync(wrapper, tasks, {
  cwd: androidDirectory,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
