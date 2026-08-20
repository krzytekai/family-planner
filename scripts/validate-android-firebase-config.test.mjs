import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ANDROID_FIREBASE_PACKAGE,
  validateAndroidFirebaseConfig,
} from './validate-android-firebase-config.mjs'

const validatorPath = fileURLToPath(new URL('./validate-android-firebase-config.mjs', import.meta.url))

function runValidator(configPath) {
  return spawnSync(process.execPath, [validatorPath, configPath], {
    encoding: 'utf8',
    windowsHide: true,
  })
}

async function withTempConfig(contents, callback) {
  const directory = await mkdtemp(path.join(tmpdir(), 'family-planner-firebase-'))
  const configPath = path.join(directory, 'google-services.json')
  try {
    if (contents !== null) await writeFile(configPath, contents, 'utf8')
    await callback(configPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function validFixture(packageName = ANDROID_FIREBASE_PACKAGE) {
  return JSON.stringify({
    project_info: {
      project_id: 'fake-project',
      project_number: '100000000000',
    },
    client: [{
      client_info: {
        mobilesdk_app_id: '1:100000000000:android:fake',
        android_client_info: { package_name: packageName },
      },
    }],
  })
}

test('fails when google-services.json is missing', async () => {
  await withTempConfig(null, async (configPath) => {
    await assert.rejects(
      validateAndroidFirebaseConfig(configPath),
      /google-services\.json is missing[\s\S]*NOT FCM-ready/,
    )
    const result = runValidator(configPath)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /google-services\.json is missing[\s\S]*NOT FCM-ready/)
  })
})

test('fails when google-services.json is invalid JSON', async () => {
  await withTempConfig('{ invalid', async (configPath) => {
    await assert.rejects(
      validateAndroidFirebaseConfig(configPath),
      /google-services\.json is not valid JSON[\s\S]*NOT FCM-ready/,
    )
  })
})

test('fails when the expected Android package is missing', async () => {
  await withTempConfig(validFixture('pl.example.wrong'), async (configPath) => {
    await assert.rejects(
      validateAndroidFirebaseConfig(configPath),
      new RegExp(`does not contain package ${ANDROID_FIREBASE_PACKAGE.replaceAll('.', '\\.')}`),
    )
    const result = runValidator(configPath)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, new RegExp(`does not contain package ${ANDROID_FIREBASE_PACKAGE.replaceAll('.', '\\.')}`))
  })
})

test('accepts a complete config for the expected Android package', async () => {
  await withTempConfig(validFixture(), async (configPath) => {
    await assert.doesNotReject(validateAndroidFirebaseConfig(configPath))
  })
})
