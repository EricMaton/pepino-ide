import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { useEffect, useState } from 'react';

/** Below this the visual viewport shrank for something smaller than a keyboard (e.g. browser chrome). */
const KEYBOARD_MIN_HEIGHT = 150;

/** Whether the on-screen keyboard is showing: native events in the app, visualViewport in the browser. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const handles = [
        Keyboard.addListener('keyboardWillShow', () => setVisible(true)),
        Keyboard.addListener('keyboardWillHide', () => setVisible(false)),
      ];
      return () => handles.forEach((handle) => void handle.then((listener) => listener.remove()));
    }
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setVisible(window.innerHeight - viewport.height > KEYBOARD_MIN_HEIGHT);
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);

  return visible;
}
