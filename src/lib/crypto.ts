import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

function getDerivedKey(): Buffer {
  const raw = process.env.WP_ENCRYPTION_KEY ?? "";
  if (!raw) throw new Error("WP_ENCRYPTION_KEY is not set");
  // Derive a stable 32-byte key from the env value using SHA-256
  return crypto.createHash("sha256").update(raw).digest();
}

export function encrypt(plaintext: string): string {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  // Store as iv:ciphertext (both hex)
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(ciphertext: string): string {
  const key = getDerivedKey();
  const [ivHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !dataHex) throw new Error("Invalid ciphertext format");
  const iv = Buffer.from(ivHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Returns a safe masked version: shows provider prefix + last 4 chars */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "****";
  const prefix = trimmed.slice(0, 3);   // e.g. "sk-"
  const suffix = trimmed.slice(-4);      // last 4 chars
  return `${prefix}****${suffix}`;
}
