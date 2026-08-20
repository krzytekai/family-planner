import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ANDROID_FIREBASE_PACKAGE = 'pl.rodzinny.planer'
export const DEFAULT_FIREBASE_CONFIG_PATH = path.resolve('android/app/google-services.json')

function validationError(message) {
  return new Error(`${message}\nThis Android build is NOT FCM-ready.`)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export async function validateAndroidFirebaseConfig(configPath = DEFAULT_FIREBASE_CONFIG_PATH) {
  let rawConfig
  try {
    rawConfig = await readFile(configPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw validationError('ERROR: android/app/google-services.json is missing.')
    }
    throw validationError('ERROR: android/app/google-services.json could not be read.')
  }

  let config
  try {
    config = JSON.parse(rawConfig)
  } catch {
    throw validationError('ERROR: android/app/google-services.json is not valid JSON.')
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw validationError('ERROR: google-services.json must contain a JSON object.')
  }

  if (!nonEmptyString(config.project_info?.project_id) || !nonEmptyString(config.project_info?.project_number)) {
    throw validationError('ERROR: google-services.json is missing required Firebase project information.')
  }

  if (!Array.isArray(config.client) || config.client.length === 0) {
    throw validationError('ERROR: google-services.json does not contain Firebase Android clients.')
  }

  const matchingClient = config.client.find(
    (client) => client?.client_info?.android_client_info?.package_name === ANDROID_FIREBASE_PACKAGE,
  )

  if (!matchingClient) {
    throw validationError(`ERROR: google-services.json does not contain package ${ANDROID_FIREBASE_PACKAGE}.`)
  }

  if (!nonEmptyString(matchingClient.client_info?.mobilesdk_app_id)) {
    throw validationError(`ERROR: Firebase client for ${ANDROID_FIREBASE_PACKAGE} is missing mobilesdk_app_id.`)
  }

  return { packageName: ANDROID_FIREBASE_PACKAGE }
}

const isMainModule = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  const configPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FIREBASE_CONFIG_PATH
  try {
    await validateAndroidFirebaseConfig(configPath)
    console.log(`Firebase Android config OK for ${ANDROID_FIREBASE_PACKAGE}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'ERROR: Firebase Android config validation failed.')
    process.exitCode = 1
  }
}
