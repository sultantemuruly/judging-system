// The one WebSocket to the server: connects with this device's role, keeps the
// clock in sync, reconnects with backoff, and tracks every action until the
// server ACKs or NACKs it. A judge's actions are also queued on the device
// (and in localStorage) and resent after a reconnect, so no tap is lost (§9).

import type {
  AckPayload, ActionFrame, FightView, HelloPayload, JudgeAccessPayload, JudgeAuthFailedPayload, LoginRequest, LoginResponse, NackPayload,
  QueueStatusPayload, ServerFrame, Session, TournamentState,
} from './protocol';
import { ActionQueue, type QueuedAction } from './queue';
import { deviceId, newId } from './ids';
import { addTimeSample, noteServerTime, resetTimeSamples, serverNow } from './serverClock';

/** 'locked': the server refused this judge seat's password, or the operator isn't
 *  logged in; no reconnect until a new password is entered. */
export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'replaced' | 'locked';

/** The server's answer to one action: ok, or the NACK reason. */
export interface ActionResult {
  ok: boolean;
  reason?: string;
  /** Admin login locked out: seconds until the next try is accepted. */
  retryAfterS?: number;
}

// The WebSocket URL:
//  - built app (nginx, HTTP on the LAN or HTTPS): same origin, /ws through the proxy
//  - Vite dev server (:5173): straight to the Go server on :8080
const BASE_URL = import.meta.env.DEV
  ? `ws://${window.location.hostname}:8080/ws`
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

// Admin login: same origin in both modes (Vite proxies /api to the Go server in dev).
const LOGIN_URL = '/api/login';
const LOGOUT_URL = '/api/logout';

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
const accessListeners = new Set<() => void>();

function subscribe<T>(set: Set<T>, cb: T) {
  set.add(cb);
  return () => { set.delete(cb); };
}

export const subscribeToState = (cb: Listener<FightView>) => subscribe(stateListeners, cb);
export const subscribeToTournament = (cb: Listener<TournamentState>) => subscribe(tournamentListeners, cb);
/** Called with every ACK/NACK of an action sent from this device. */
export const subscribeToResults = (cb: (type: string, r: ActionResult) => void) => subscribe(resultListeners, cb);
export const subscribeToStatus = (cb: () => void) => subscribe(statusListeners, cb);
export const subscribeToJudgeAccess = (cb: () => void) => subscribe(accessListeners, cb);

let judgeAccess: JudgeAccessPayload = { protected: [false, false, false] };
/** Which judge seats need a password, as the server last said. */
export const getJudgeAccess = () => judgeAccess;

export interface ConnectionInfo {
  status: ConnectionStatus;
  /** Judge actions made on this device that the server hasn't confirmed yet. */
  pending: number;
  /** Locked although this device gave a password (or admin token): it was wrong or has been changed. */
  wrongPassword: boolean;
  /** Locked out after too many wrong passwords: no try is accepted for this many ms (0 if not). */
  retryAfterMs: number;
}

let retryAfterMs = 0;
let info: ConnectionInfo = { status, pending: 0, wrongPassword: false, retryAfterMs: 0 };
export const getConnectionInfo = () => info;

function setStatus(next: ConnectionStatus) {
  status = next;
  publishInfo();
}

function publishInfo() {
  reportQueue();
  const pending = queue?.size ?? 0;
  const wrongPassword = status === 'locked' && triedPassword !== '';
  const wait = status === 'locked' ? retryAfterMs : 0;
  if (info.status === status && info.pending === pending && info.wrongPassword === wrongPassword && info.retryAfterMs === wait) return;
  info = { status, pending, wrongPassword, retryAfterMs: wait };
  statusListeners.forEach(cb => cb());
}

// ---- connection ----

/** The page decides the connection's role: /judge/N is judge seat N, /viewer and
 *  the judge picker (/judge) are viewers, anything else the operator. */
export function sessionForPath(path: string): Session {
  const judge = path.match(/^\/judge\/([1-3])\/?$/);
  if (judge) return { role: 'judge', seat: Number(judge[1]) };
  if (path.startsWith('/viewer') || path.startsWith('/judge')) return { role: 'viewer' };
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

// ---- admin login ----

const ADMIN_TOKEN_KEY = 'admin-token';
let memoryToken = '';

function savedToken(): string {
  try {
    return safeStorage()?.getItem(ADMIN_TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

function saveToken(token: string) {
  memoryToken = token;
  try {
    if (token) safeStorage()?.setItem(ADMIN_TOKEN_KEY, token);
    else safeStorage()?.removeItem(ADMIN_TOKEN_KEY);
  } catch { /* private mode: logged in until the page closes */ }
}

/** Logs the operator in and reconnects with the new token. */
export async function loginAdmin(login: string, password: string): Promise<ActionResult> {
  const body: LoginRequest = { login, password };
  let res: Response;
  try {
    res = await fetch(LOGIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, reason: 'no_connection' };
  }
  if (res.status === 401) return { ok: false, reason: 'wrong_login' };
  if (res.status === 429) return { ok: false, reason: 'too_many_attempts', retryAfterS: Number(res.headers.get('Retry-After')) || undefined };
  if (!res.ok) return { ok: false, reason: 'server_error' };
  saveToken(((await res.json()) as LoginResponse).token);
  if (session.role === 'operator') {
    disconnect();
    open();
  }
  return { ok: true };
}

/** Forgets the admin token on this device; the operator's pages lock. */
export function logoutAdmin() {
  const token = savedToken();
  // End the session on the server too, so the token is useless if copied.
  if (token) {
    fetch(LOGOUT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .catch(() => { /* offline: the session still expires when idle */ });
  }
  saveToken('');
  if (session.role === 'operator') {
    disconnect();
    open();
  }
}

// ---- judge seat passwords ----

const passwordKey = (seat: number) => `judge-password:${seat}`;
/** The password the current connection was opened with ('' for none). */
let triedPassword = '';
/** Fallback when localStorage is unavailable. */
const memoryPasswords: Record<number, string> = {};

function savedPassword(seat: number): string {
  try {
    return safeStorage()?.getItem(passwordKey(seat)) ?? '';
  } catch {
    return '';
  }
}

/** Remembers this seat's password on the device and connects with it ('' tries
 *  without one, e.g. after the admin removed it). Taps still queued from before
 *  are sent once the server lets the device in. */
export function unlockSeat(password: string) {
  if (session.role !== 'judge' || !session.seat) return;
  try {
    safeStorage()?.setItem(passwordKey(session.seat), password);
  } catch { /* private mode: the password lasts until the page closes */ }
  memoryPasswords[session.seat] = password;
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
  // Only the role and seat go in the URL, which proxies log; the device and
  // its credentials go in the HELLO frame, the first thing sent.
  const q = new URLSearchParams({ role: session.role });
  const hello: HelloPayload = { device: deviceId() };
  triedPassword = '';
  if (session.seat) {
    q.set('seat', String(session.seat));
    triedPassword = savedPassword(session.seat) || memoryPasswords[session.seat] || '';
    if (triedPassword) hello.password = triedPassword;
  } else if (session.role === 'operator') {
    triedPassword = savedToken();
    if (triedPassword) hello.token = triedPassword;
  }
  const ws = new WebSocket(`${BASE_URL}?${q}`);
  socket = ws;
  setStatus('connecting');

  ws.onopen = () => {
    if (socket !== ws) return;
    rawSend({ id: '', type: 'HELLO', payload: hello }); // before anything else
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
    if (status === 'locked') return; // the same password would be refused again
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
    case 'JUDGE_ACCESS':
      judgeAccess = msg.payload as JudgeAccessPayload;
      accessListeners.forEach(cb => cb());
      break;
    case 'JUDGE_AUTH_FAILED':
      retryAfterMs = (msg.payload as JudgeAuthFailedPayload).retry_after_ms ?? 0;
      setStatus('locked');
      break;
    case 'ADMIN_AUTH_FAILED':
      retryAfterMs = 0;
      setStatus('locked');
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
    if (status === 'open' && Date.now() - lastFrameAt > SILENCE_LIMIT_MS) reconnectNow();
  }, 1_000);
}

/** A half-dead connection: on a phone the browser can take a long time to
 *  report it closed, so drop it and connect again right away. */
function reconnectNow() {
  disconnect();
  setStatus('closed');
  open();
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
