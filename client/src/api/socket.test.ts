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
  /** The HELLO frame, which must be the first thing sent after opening. */
  hello() {
    expect(this.sent[0]?.type).toBe('HELLO');
    return this.sent[0].payload as { device: string; token?: string };
  }
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

  it('replaces a silent connection at once, without waiting for the browser to close it', async () => {
    const socket = await loadSocket();
    socket.connect({ role: 'judge', seat: 3 });
    const first = FakeSocket.instances[0];
    first.open();

    vi.advanceTimersByTime(9_000); // no frame from the server for 9 s
    expect(first.closed).toBe(true);
    expect(FakeSocket.instances).toHaveLength(2);

    // A late frame on the old socket is ignored; the new one takes over.
    socket.sendAction('REGISTER_HIT', { corner: 'Red' });
    const second = FakeSocket.instances[1];
    second.open();
    expect(second.sent.some(f => f.type === 'REGISTER_HIT' && f.offline)).toBe(true);
  });

  it('an operator never sends a queue status', async () => {
    const socket = await loadSocket();
    socket.connect({ role: 'operator' });
    const ws = FakeSocket.instances[0];
    ws.open();
    socket.sendAction('START_ROUND');
    expect(ws.queueStatuses()).toEqual([]);
  });

  it('the judge picker and the board connect as viewers', async () => {
    const socket = await loadSocket();
    expect(socket.sessionForPath('/board')).toEqual({ role: 'viewer' });
    expect(socket.sessionForPath('/judge')).toEqual({ role: 'viewer' });
    expect(socket.sessionForPath('/judge/')).toEqual({ role: 'viewer' });
    expect(socket.sessionForPath('/judge/2')).toEqual({ role: 'judge', seat: 2 });
  });

  it('the operator connects with the admin token and locks without one', async () => {
    const socket = await loadSocket();
    socket.connect({ role: 'operator' });
    const first = FakeSocket.instances[0];
    first.open();
    expect(first.hello().token).toBeUndefined();
    first.receive({ type: 'ADMIN_AUTH_FAILED', payload: {} });
    first.onclose?.();
    expect(socket.getConnectionInfo()).toMatchObject({ status: 'locked', sessionExpired: false });
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.instances).toHaveLength(1);

    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ token: 'tok-1' }) }));
    vi.stubGlobal('fetch', fetch);
    expect(await socket.loginAdmin('admin', 'pw')).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ login: 'admin', password: 'pw' }) }));
    const second = FakeSocket.instances[1];
    second.open();
    expect(second.hello().token).toBe('tok-1');

    socket.logoutAdmin();
    expect(fetch).toHaveBeenLastCalledWith('/api/logout', expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'tok-1' }) }));
    const third = FakeSocket.instances[2];
    third.open();
    expect(third.hello().token).toBeUndefined();
  });

  it('says the session ended when a saved admin token is refused, and stops reconnecting', async () => {
    const socket = await loadSocket();
    socket.connect({ role: 'operator' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ token: 'tok-old' }) })));
    await socket.loginAdmin('admin', 'pw');
    const ws = FakeSocket.instances.at(-1)!;
    ws.open();
    expect(ws.hello().token).toBe('tok-old');
    ws.receive({ type: 'ADMIN_AUTH_FAILED', payload: {} });
    ws.onclose?.();
    expect(socket.getConnectionInfo()).toMatchObject({ status: 'locked', sessionExpired: true });
    const count = FakeSocket.instances.length;
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.instances).toHaveLength(count);
  });

  it('a wrong admin login keeps the operator locked', async () => {
    const socket = await loadSocket();
    socket.connect({ role: 'operator' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    expect(await socket.loginAdmin('admin', 'nope')).toEqual({ ok: false, reason: 'wrong_login' });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('reports a locked admin login with its wait', async () => {
    const socket = await loadSocket();
    socket.connect({ role: 'operator' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '30' }) })));
    expect(await socket.loginAdmin('admin', 'x')).toEqual({ ok: false, reason: 'too_many_attempts', retryAfterS: 30 });
  });

  it('keeps the device out of the URL, which proxies log', async () => {
    const socket = await loadSocket();
    socket.connect({ role: 'judge', seat: 3 });
    const ws = FakeSocket.instances.at(-1)!;
    expect([...new URL(ws.url).searchParams.keys()].sort()).toEqual(['role', 'seat']);
    ws.open();
    expect(ws.hello().device).toBeTruthy();
  });

  it("says which session its status is about, so a page ignores the previous page's lock", async () => {
    const socket = await loadSocket();
    socket.connect({ role: 'operator' });
    const op = FakeSocket.instances[0];
    op.open();
    op.receive({ type: 'ADMIN_AUTH_FAILED', payload: {} });
    op.onclose?.();
    expect(socket.getConnectionInfo()).toMatchObject({ status: 'locked', session: { role: 'operator' } });

    socket.connect({ role: 'judge', seat: 2 });
    expect(socket.getConnectionInfo()).toMatchObject({ status: 'connecting', session: { role: 'judge', seat: 2 } });
  });

  it('asks the server which seats are locked and taken', async () => {
    const socket = await loadSocket();
    const seats = { occupied: [true, false, false] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => seats })));
    expect(await socket.fetchJudgeSeats()).toEqual(seats);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await socket.fetchJudgeSeats()).toBeNull();
  });
});
