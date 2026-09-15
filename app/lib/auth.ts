const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const SESSION_COOKIE = "sess";
export const ADMIN_COOKIE = "adm";
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30일

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookieHeader(name: string, value: string, maxAgeSec = SESSION_TTL_SEC): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function makeSessionToken(userId: string, secret: string): Promise<string> {
  const payload = `${userId}.${Date.now() + SESSION_TTL_SEC * 1000}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function readSessionToken(token: string | undefined, secret: string): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const expected = await hmac(secret, `${userId}.${expStr}`);
  if (sig !== expected) return null;
  if (Number(expStr) < Date.now()) return null;
  return userId;
}

export async function makeAdminToken(secret: string): Promise<string> {
  return hmac(secret, "admin-session");
}

export async function verifyAdminToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  return token === (await makeAdminToken(secret));
}

export function randomInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}
