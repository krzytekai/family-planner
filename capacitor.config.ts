import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'pl.rodzinny.planer',
  appName: 'Planer rodzinny',
  webDir: 'apps/web/dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#0A0A0F',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
      hidden: false,
    },
    PushNotifications: {
      presentationOptions: ['alert', 'sound'],
    },
  },
}

export default config
