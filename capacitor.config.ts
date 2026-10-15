import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.pepino.ide',
  appName: 'Pepino',
  webDir: 'dist',
  backgroundColor: '#0a0a0a',
  android: {
    backgroundColor: '#0a0a0a',
  },
  plugins: {
    Keyboard: {
      // Edge-to-edge (forced from Android 15) stops the WebView from resizing for the keyboard otherwise.
      resizeOnFullScreen: true,
    },
    SystemBars: {
      // Light icons on the brutalist black background
      style: 'DARK',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
