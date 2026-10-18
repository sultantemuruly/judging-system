// Actions waiting for the server's ACK. A judge's taps are kept here — and in
// localStorage, so they survive a page reload — until the server confirms
// them, and are resent in order after a reconnect (§9).
//
// localStorage is the one copy: every change re-reads it first, so two tabs of
// the same seat never overwrite each other's unsent taps. Memory is only the
// fallback when storage is unavailable.

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
  private memoryOnly = false;

  constructor(key: string, storage: KVStorage | null) {
    this.key = key;
    this.storage = storage;
    this.items = [];
    this.items = this.load();
  }

  add(action: QueuedAction) {
    this.items = [...this.load(), action];
    this.save();
  }

  /** Removes an action once the server answered it (ACK or a final NACK). */
  settle(id: string) {
    const current = this.load();
    this.items = current.filter(a => a.id !== id);
    if (this.items.length !== current.length) this.save();
  }

  /** Unanswered actions, oldest first. */
  pending(): readonly QueuedAction[] {
    this.items = this.load();
    return this.items;
  }

  get size(): number {
    return this.pending().length;
  }

  private load(): QueuedAction[] {
    try {
      if (!this.storage || this.memoryOnly) return this.items;
      const raw = this.storage.getItem(this.key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return this.items;
    }
  }

  private save() {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.items));
    } catch {
      // Storage full or blocked: from now on the queue works in memory only,
      // so it never reads back a copy that misses the latest taps.
      this.memoryOnly = true;
    }
  }
}
