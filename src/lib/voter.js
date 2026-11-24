// A random id for this browser, used to allow one vote per bin per device.
// It is not linked to a person and there is no account; clearing the
// browser's site data starts a new id.
const STORAGE_KEY = 'bin-there:voter-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let fallbackId = null;

function createId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // randomUUID needs HTTPS (or localhost); getRandomValues works everywhere,
  // e.g. when testing on a phone over the local network.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getVoterId() {
  try {
    let id = window.localStorage.getItem(STORAGE_KEY);

    if (!UUID_PATTERN.test(id ?? '')) {
      id = createId();
      window.localStorage.setItem(STORAGE_KEY, id);
    }

    return id;
  } catch {
    // Storage can be blocked (some private modes). Votes still work for this
    // visit, under an id that lasts until the page is closed.
    fallbackId ??= createId();
    return fallbackId;
  }
}
