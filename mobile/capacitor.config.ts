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
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#0b0d17',
    },
  },
};

export default config;
