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
    // No Keyboard.resizeOnFullScreen: SystemBars already resizes the WebView for the keyboard
    // edge-to-edge, and Capacitor warns that both together lead to unexpected behavior.
    SystemBars: {
      // Light icons on the brutalist black background
      style: 'DARK',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
