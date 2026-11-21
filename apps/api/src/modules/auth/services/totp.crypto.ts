import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encryptionKey(): Buffer {
  const encoded = process.env.AUTH_TOTP_ENCRYPTION_KEY;
  if (!encoded || !/^[0-9a-fA-F]{64}$/.test(encoded)) {
    throw new Error('AUTH_TOTP_ENCRYPTION_KEY must be a 32-byte hex value');
  }
  return Buffer.from(encoded, 'hex');
}

export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

export function encodeBase32(input: Buffer): string {
  let value = 0;
  let bits = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function totpProvisioningUri(email: string, secret: Buffer): string {
  const issuer = 'KIIRO-HOST';
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${encodeBase32(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function codeAtStep(secret: Buffer, step: bigint): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** DIGITS);
  return String(binary).padStart(DIGITS, '0');
}

/** Returns the matching time-step only if it has not already been consumed. */
export function verifyTotp(
  secret: Buffer,
  code: string,
  lastUsedStep: bigint | null,
  nowMs = Date.now(),
): bigint | null {
  if (!/^\d{6}$/.test(code) || !Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  const current = BigInt(Math.floor(nowMs / 1000 / PERIOD_SECONDS));
  const candidate = Buffer.from(code, 'ascii');
  for (const delta of [-1n, 0n, 1n]) {
    const step = current + delta;
    if (step < 0n || (lastUsedStep !== null && step <= lastUsedStep)) continue;
    const expected = Buffer.from(codeAtStep(secret, step), 'ascii');
    if (timingSafeEqual(candidate, expected)) return step;
  }
  return null;
}

/** AES-256-GCM: version byte, nonce, authentication tag, ciphertext. */
export function encryptTotpSecret(secret: Buffer): Buffer {
  if (secret.length !== 20) throw new Error('Invalid TOTP secret size');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptTotpSecret(payload: Uint8Array): Buffer {
  const data = Buffer.from(payload);
  if (data.length !== 49 || data[0] !== 1) throw new Error('Invalid encrypted TOTP secret');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(1, 13));
  decipher.setAuthTag(data.subarray(13, 29));
  const secret = Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]);
  if (secret.length !== 20) throw new Error('Invalid decrypted TOTP secret');
  return secret;
}
