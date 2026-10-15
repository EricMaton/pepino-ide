/** Minimal persistent string store; Capacitor Preferences in the app, a Map in tests. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
