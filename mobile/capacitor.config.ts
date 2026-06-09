import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aisleshub.app',
  appName: 'AIsle',
  webDir: 'www',
  server: {
    url: 'https://www.aisleshub.com',
    cleartext: false,
    androidScheme: 'https',
  },
};

export default config;
