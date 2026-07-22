const MAX_TIMESTAMP = 0xffffffffffff;
const RANDOM_BITS = 74n;
const MAX_RANDOM = (1n << RANDOM_BITS) - 1n;

let lastTimestamp = -1;
let lastRandom = 0n;

function random74(): bigint {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) throw new Error('UUIDv7 requires a cryptographically secure random source');
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value & MAX_RANDOM;
}

/** RFC 9562 UUIDv7 with monotonic ordering when calls share a millisecond or the clock moves backward. */
export function uuidv7(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIMESTAMP) {
    throw new Error('UUIDv7 timestamp must be a non-negative 48-bit integer');
  }

  let timestamp = Math.max(now, lastTimestamp);
  let random: bigint;
  if (timestamp > lastTimestamp) {
    random = random74();
  } else if (lastRandom < MAX_RANDOM) {
    random = lastRandom + 1n;
  } else {
    if (timestamp === MAX_TIMESTAMP) throw new Error('UUIDv7 monotonic sequence exhausted');
    timestamp += 1;
    random = random74();
  }
  lastTimestamp = timestamp;
  lastRandom = random;

  const bytes = new Uint8Array(16);
  let remainingTimestamp = timestamp;
  for (let index = 5; index >= 0; index--) {
    bytes[index] = remainingTimestamp % 256;
    remainingTimestamp = Math.floor(remainingTimestamp / 256);
  }
  bytes[6] = 0x70 | Number((random >> 70n) & 0x0fn);
  bytes[7] = Number((random >> 62n) & 0xffn);
  bytes[8] = 0x80 | Number((random >> 56n) & 0x3fn);
  for (let index = 9, shift = 48n; index < 16; index++, shift -= 8n) {
    bytes[index] = Number((random >> shift) & 0xffn);
  }

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
