// Estimates the offset between this device's clock and the server's, so every
// screen counts down from server time (§9: screens within 0.2 s of each other).
//
// The socket sends TIME_SYNC pings; each reply gives one sample
//   offset = server_time + rtt / 2 − receive_time
// and the sample with the smallest round trip among the last few is trusted most.

interface Sample {
  offset: number;
  rtt: number;
}

const MAX_SAMPLES = 8;
let samples: Sample[] = [];
let offset = 0;
let synced = false;

/** Current server time in ms, as best known. */
export function serverNow(): number {
  return Date.now() + offset;
}

export function clockOffset(): number {
  return offset;
}

/** Records a TIME_SYNC reply. */
export function addTimeSample(clientSent: number, serverTime: number, receivedAt = Date.now()) {
  const rtt = Math.max(0, receivedAt - clientSent);
  samples = [...samples, { offset: serverTime + rtt / 2 - receivedAt, rtt }].slice(-MAX_SAMPLES);
  offset = samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
  synced = true;
}

/** Any server frame carries server_time; it is only used until a real sample exists. */
export function noteServerTime(serverTime: number) {
  if (!synced && serverTime > 0) offset = serverTime - Date.now();
}

export function resetTimeSamples() {
  samples = [];
  synced = false;
}
