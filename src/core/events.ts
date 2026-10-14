/** Topic name -> payload type. Payloads must be plain data so they can cross into plugin sandboxes. */
export type EventMap = Record<string, unknown>;

type Handler = (payload: never) => void;

/**
 * Typed pub/sub keyed by string topics. A failing handler never stops the
 * others: its error goes to [onHandlerError].
 */
export class EventBus<Events extends EventMap> {
  private readonly handlers = new Map<keyof Events, Set<Handler>>();

  constructor(
    private readonly onHandlerError: (error: unknown, topic: keyof Events) => void = (error, topic) =>
      console.error(`EventBus handler failed for "${String(topic)}"`, error),
  ) {}

  subscribe<K extends keyof Events>(topic: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    const stored = handler as Handler;
    set.add(stored);
    return () => {
      set.delete(stored);
    };
  }

  publish<K extends keyof Events>(topic: K, payload: Events[K]): void {
    const set = this.handlers.get(topic);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as (payload: Events[K]) => void)(payload);
      } catch (error) {
        this.onHandlerError(error, topic);
      }
    }
  }
}
