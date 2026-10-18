// Random IDs for actions and devices. crypto.randomUUID only exists in secure
// contexts (HTTPS or localhost); phones on http://192.168.x.x need the fallback.
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** A stable ID for this browser, so reconnecting is not mistaken for a second device. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('device-id');
    if (!id) {
      id = newId();
      localStorage.setItem('device-id', id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}
