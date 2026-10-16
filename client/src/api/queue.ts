// Actions waiting for the server's ACK. A judge's taps are kept here — and in
// localStorage, so they survive a page reload — until the server confirms
// them, and are resent in order after a reconnect (§9).

export interface QueuedAction {
  id: string;
  type: string;
  payload: unknown;
  /** When the action was made, in server time (device clock + offset). */
  client_time: number;
}

export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class ActionQueue {
  private items: QueuedAction[];
  private readonly key: string;
  private readonly storage: KVStorage | null;

  constructor(key: string, storage: KVStorage | null) {
    this.key = key;
    this.storage = storage;
    this.items = this.load();
  }

  add(action: QueuedAction) {
    this.items = [...this.items, action];
    this.save();
  }

  /** Removes an action once the server answered it (ACK or NACK). */
  settle(id: string) {
    const before = this.items.length;
    this.items = this.items.filter(a => a.id !== id);
    if (this.items.length !== before) this.save();
  }

  /** Unanswered actions, oldest first. */
  pending(): readonly QueuedAction[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  private load(): QueuedAction[] {
    try {
      const raw = this.storage?.getItem(this.key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save() {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.items));
    } catch {
      // Storage full or blocked: the queue still works in memory.
    }
  }
}
