import{Capacitor}from'@capacitor/core'

export const PRODUCTION_API_ORIGIN='https://family-planner-two-rho.vercel.app'

export function resolveApiUrl(path:string,native=Capacitor.isNativePlatform(),configuredOrigin=import.meta.env.VITE_PUBLIC_API_ORIGIN as string|undefined){
  if(!path.startsWith('/api/'))throw new Error('API path must start with /api/')
  if(!native)return path
  const origin=(configuredOrigin||PRODUCTION_API_ORIGIN).replace(/\/$/,'')
  return new URL(path,`${origin}/`).toString()
}
