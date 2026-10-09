import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, keyLength) as Buffer;
  return `scrypt:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltText, hashText] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(hashText, "base64url");
  if (expected.length !== keyLength) return false;
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return timingSafeEqual(actual, expected);
}

// Look-alike characters (0/O, 1/l/I) are left out so a credential read aloud or copied by hand is typed correctly.
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SPECIALS = "!@#$%*?";
const TEMPORARY_LENGTH = 8;

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]!;
}

/** 8 characters with at least one uppercase, lowercase, digit and special character, so it meets the password policy. */
export function generateTemporaryCredential(): string {
  const all = UPPERCASE + LOWERCASE + DIGITS + SPECIALS;
  const characters = [pick(UPPERCASE), pick(LOWERCASE), pick(DIGITS), pick(SPECIALS)];
  while (characters.length < TEMPORARY_LENGTH) characters.push(pick(all));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [characters[index], characters[swap]] = [characters[swap]!, characters[index]!];
  }
  return characters.join("");
}

export function generateTemporaryPassword(): string {
  return generateTemporaryCredential();
}
