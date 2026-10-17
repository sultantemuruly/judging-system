import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionFrame } from './protocol';

/** A WebSocket the test drives by hand. */
class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: ActionFrame[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.readyState = 2; }

  // test controls
  open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  receive(frame: object) { this.onmessage?.({ data: JSON.stringify({ server_time: Date.now(), ...frame }) }); }
  queueStatuses() { return this.sent.filter(f => f.type === 'QUEUE_STATUS').map(f => (f.payload as { pending: number }).pending); }
}

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

async function loadSocket() {
  vi.resetModules();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('location', { protocol: 'http:', hostname: 'ring.local', host: 'ring.local' });
  vi.stubGlobal('window', globalThis);
  return import('./socket');
}

describe('socket', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("reports a judge's unconfirmed taps to the server (§7)", async () => {
    const socket = await loadSocket();
    socket.connect({ role: 'judge', seat: 2 });
    const ws = FakeSocket.instances[0];
    ws.open();
    expect(ws.queueStatuses()).toEqual([0]);

    socket.sendAction('REGISTER_HIT', { corner: 'Red' });
    const tap = ws.sent.find(f => f.type === 'REGISTER_HIT')!;
    expect(ws.queueStatuses()).toEqual([0, 1]);

    ws.receive({ type: 'ACK', payload: { id: tap.id } });
    expect(ws.queueStatuses()).toEqual([0, 1, 0]);
  });

  it('reports the queue again after a reconnect, with the resent taps', async () => {
    const socket = await loadSocket();
    socket.connect({ role: 'judge', seat: 1 });
    const first = FakeSocket.instances[0];
    socket.sendAction('REGISTER_HIT', { corner: 'Blue' }); // made while not connected yet
    first.open();

    const resent = first.sent.filter(f => f.type === 'REGISTER_HIT');
    expect(resent).toHaveLength(1);
    expect(resent[0].offline).toBe(true);
    expect(first.queueStatuses().at(-1)).toBe(1);
  });

  it('an operator never sends a queue status', async () => {
    const socket = await loadSocket();
    socket.connect({ role: 'operator' });
    const ws = FakeSocket.instances[0];
    ws.open();
    socket.sendAction('START_ROUND');
    expect(ws.queueStatuses()).toEqual([]);
  });
});
