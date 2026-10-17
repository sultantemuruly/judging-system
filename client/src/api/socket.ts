// The one WebSocket to the server: connects with this device's role, keeps the
// clock in sync, reconnects with backoff, and tracks every action until the
// server ACKs or NACKs it. A judge's actions are also queued on the device
// (and in localStorage) and resent after a reconnect, so no tap is lost (§9).

import type {
  AckPayload, ActionFrame, FightView, NackPayload, QueueStatusPayload, ServerFrame, Session, TournamentState,
} from './protocol';
import { ActionQueue, type QueuedAction } from './queue';
import { deviceId, newId } from './ids';
import { addTimeSample, noteServerTime, resetTimeSamples, serverNow } from './serverClock';

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'replaced';

/** The server's answer to one action: ok, or the NACK reason. */
export interface ActionResult {
  ok: boolean;
  reason?: string;
}

// Auto-detect the WebSocket URL:
//  - HTTPS (production): wss:// through the reverse proxy at /ws
//  - HTTP (local dev):   ws:// directly to the Go server on :8080
const BASE_URL = window.location.protocol === 'https:'
  ? `wss://${window.location.host}/ws`
  : `ws://${window.location.hostname}:8080/ws`;

const PING_EVERY_MS = 3_000;
/** No frame for this long means the connection is dead even if the browser hasn't noticed. */
const SILENCE_LIMIT_MS = 8_000;
const MAX_BACKOFF_MS = 5_000;

let session: Session = { role: 'operator' };
let socket: WebSocket | null = null;
let status: ConnectionStatus = 'closed';
let backoff = 500;
let reconnectTimer = 0;
let pingTimer = 0;
let watchdogTimer = 0;
let lastFrameAt = 0;
const lastSeq: Record<string, number> = {};

let queue: ActionQueue | null = null;
const waiting = new Map<string, (r: ActionResult) => void>();

// ---- subscriptions ----

type Listener<T> = (value: T) => void;
const stateListeners = new Set<Listener<FightView>>();
const tournamentListeners = new Set<Listener<TournamentState>>();
const resultListeners = new Set<(type: string, r: ActionResult) => void>();
const statusListeners = new Set<() => void>();

function subscribe<T>(set: Set<T>, cb: T) {
  set.add(cb);
  return () => { set.delete(cb); };
}

export const subscribeToState = (cb: Listener<FightView>) => subscribe(stateListeners, cb);
export const subscribeToTournament = (cb: Listener<TournamentState>) => subscribe(tournamentListeners, cb);
/** Called with every ACK/NACK of an action sent from this device. */
export const subscribeToResults = (cb: (type: string, r: ActionResult) => void) => subscribe(resultListeners, cb);
export const subscribeToStatus = (cb: () => void) => subscribe(statusListeners, cb);

export interface ConnectionInfo {
  status: ConnectionStatus;
  /** Judge actions made on this device that the server hasn't confirmed yet. */
  pending: number;
}

let info: ConnectionInfo = { status, pending: 0 };
export const getConnectionInfo = () => info;

function setStatus(next: ConnectionStatus) {
  status = next;
  publishInfo();
}

function publishInfo() {
  reportQueue();
  const pending = queue?.size ?? 0;
  if (info.status === status && info.pending === pending) return;
  info = { status, pending };
  statusListeners.forEach(cb => cb());
}

// ---- connection ----

/** The page decides the connection's role: /judge/N is judge seat N, /viewer a viewer, anything else the operator. */
export function sessionForPath(path: string): Session {
  const judge = path.match(/^\/judge\/([1-3])\/?$/);
  if (judge) return { role: 'judge', seat: Number(judge[1]) };
  if (path.startsWith('/viewer')) return { role: 'viewer' };
  return { role: 'operator' };
}

function sameSession(a: Session, b: Session) {
  return a.role === b.role && (a.seat ?? 0) === (b.seat ?? 0);
}

/** Connects (or reconnects) as the given role. Judges get a durable queue per seat. */
export function connect(next: Session) {
  if (socket && sameSession(session, next) && status !== 'replaced') return;
  session = next;
  queue = next.role === 'judge' ? new ActionQueue(`queue:judge:${next.seat}`, safeStorage()) : null;
  disconnect();
  open();
}

/** After another device took this judge seat, take it back. */
export function reclaimSeat() {
  disconnect();
  open();
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function disconnect() {
  clearTimeout(reconnectTimer);
  clearTimeout(retryTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  stopTimers();
}

function open() {
  const q = new URLSearchParams({ role: session.role, device: deviceId() });
  if (session.seat) q.set('seat', String(session.seat));
  const ws = new WebSocket(`${BASE_URL}?${q}`);
  socket = ws;
  setStatus('connecting');

  ws.onopen = () => {
    if (socket !== ws) return;
    backoff = 500;
    lastFrameAt = Date.now();
    Object.keys(lastSeq).forEach(k => delete lastSeq[k]);
    reportedPending = -1; // a new connection hears the queue size again
    setStatus('open');
    startTimers();
    flushQueue();
  };
  ws.onmessage = (event) => {
    if (socket !== ws) return; // a socket we already gave up on
    lastFrameAt = Date.now();
    for (const line of String(event.data).split('\n')) {
      if (line) handleFrame(JSON.parse(line) as ServerFrame);
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    stopTimers();
    socket = null;
    if (status === 'replaced') return; // don't fight the other device for the seat
    setStatus('closed');
    reconnectTimer = window.setTimeout(open, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };
}

function handleFrame(msg: ServerFrame) {
  if (msg.server_time) noteServerTime(msg.server_time);
  if (msg.seq !== undefined) {
    if (msg.seq < (lastSeq[msg.type] ?? 0)) return; // older than what we have
    lastSeq[msg.type] = msg.seq;
  }
  switch (msg.type) {
    case 'STATE_UPDATE':
      stateListeners.forEach(cb => cb(msg.payload as FightView));
      break;
    case 'TOURNAMENT_STATE_UPDATE':
      tournamentListeners.forEach(cb => cb(msg.payload as TournamentState));
      break;
    case 'TIME_SYNC':
      addTimeSample((msg.payload as { client_sent: number }).client_sent, msg.server_time);
      break;
    case 'ACK':
      settle((msg.payload as AckPayload).id, { ok: true });
      break;
    case 'NACK': {
      const p = msg.payload as NackPayload;
      if (RETRYABLE.has(p.reason) && queue?.pending().some(a => a.id === p.id)) {
        keepForRetry(p.id, p.reason);
      } else {
        settle(p.id, { ok: false, reason: p.reason });
      }
      break;
    }
    case 'SESSION_REPLACED':
      setStatus('replaced');
      break;
  }
}

// ---- queue status ----

let reportedPending = -1;

/** Tells the server how many of this judge's taps are still unconfirmed, so the
 *  operator can't confirm a result while a tap is on its way (§7). */
function reportQueue() {
  if (!queue) return;
  const pending = queue.size;
  if (pending === reportedPending) return;
  const status: QueueStatusPayload = { pending };
  if (rawSend({ id: '', type: 'QUEUE_STATUS', payload: status })) reportedPending = pending;
}

// ---- clock sync and liveness ----

function ping() {
  rawSend({ id: '', type: 'TIME_SYNC', payload: { client_sent: Date.now() } });
}

function startTimers() {
  resetTimeSamples();
  [0, 300, 600, 900, 1200].forEach(ms => window.setTimeout(ping, ms));
  pingTimer = window.setInterval(ping, PING_EVERY_MS);
  watchdogTimer = window.setInterval(() => {
    if (status === 'open' && Date.now() - lastFrameAt > SILENCE_LIMIT_MS) {
      socket?.close(); // half-dead connection: reconnect now
    }
  }, 1_000);
}

function stopTimers() {
  clearInterval(pingTimer);
  clearInterval(watchdogTimer);
}

// ---- actions ----

function rawSend(frame: ActionFrame): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(frame));
  return true;
}

const sentTypes = new Map<string, string>();

function settle(id: string, r: ActionResult) {
  queue?.settle(id);
  const type = sentTypes.get(id) ?? '';
  sentTypes.delete(id);
  waiting.get(id)?.(r);
  waiting.delete(id);
  resultListeners.forEach(cb => cb(type, r));
  publishInfo();
}

/** NACK reasons that say the server failed, not that the action broke a rule:
 *  nothing was applied, so a judge's tap stays queued and is sent again. */
const RETRYABLE = new Set(['server_error']);
const RETRY_AFTER_MS = 2_000;
let retryTimer = 0;

function keepForRetry(id: string, reason: string) {
  resultListeners.forEach(cb => cb(sentTypes.get(id) ?? '', { ok: false, reason }));
  clearTimeout(retryTimer);
  retryTimer = window.setTimeout(flushQueue, RETRY_AFTER_MS);
}

/** Resends everything still unconfirmed, oldest first. It may have been made
 *  while offline, so the server judges it by the time it was made. */
function flushQueue() {
  for (const a of queue?.pending() ?? []) {
    sentTypes.set(a.id, a.type);
    rawSend({ ...a, offline: true });
  }
}

/**
 * Sends an action and resolves with the server's answer.
 * On a judge's device the action is queued until answered and resent after a
 * reconnect. Elsewhere an action made while disconnected fails immediately.
 */
export function sendAction(type: string, payload: unknown = {}): Promise<ActionResult> {
  const action: QueuedAction = { id: newId(), type, payload, client_time: Math.round(serverNow()) };
  const result = new Promise<ActionResult>(resolve => waiting.set(action.id, resolve));
  sentTypes.set(action.id, type);

  if (queue) {
    queue.add(action);
    publishInfo();
    rawSend(action);
    return result;
  }
  if (!rawSend(action)) {
    settle(action.id, { ok: false, reason: 'no_connection' });
  }
  return result;
}
