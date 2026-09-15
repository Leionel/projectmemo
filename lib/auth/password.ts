import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

/**
 * 使用 Node.js 原生 scrypt 对密码进行加盐单向哈希。
 * 格式：scrypt$<salt_hex>$<derivedKey_hex>
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

/**
 * 校验明文密码是否与存储的 scrypt 哈希匹配。
 * 使用 timingSafeEqual 防止时序侧信道攻击。
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash || typeof password !== "string" || typeof storedHash !== "string") {
    return false;
  }
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const saltHex = parts[1];
  const expectedKeyHex = parts[2];
  if (!saltHex || !expectedKeyHex) {
    return false;
  }

  try {
    const salt = Buffer.from(saltHex, "hex");
    const expectedKey = Buffer.from(expectedKeyHex, "hex");
    const derivedKey = (await scryptAsync(password, salt, expectedKey.length)) as Buffer;
    return timingSafeEqual(derivedKey, expectedKey);
  } catch {
    return false;
  }
}
