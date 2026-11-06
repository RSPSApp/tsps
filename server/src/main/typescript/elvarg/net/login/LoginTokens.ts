import { createHash, randomBytes } from "crypto";

/**
 * Remembered logins ("Stay logged in"). The client keeps a random token instead of the
 * password; the account keeps only its SHA-256. Each token login swaps the token for a new
 * one, so a copied token stops working once either copy is used, and presenting the swapped-out
 * token again revokes that browser's entry.
 */
export const LOGIN_TOKENS_ATTRIBUTE = "login:tokens";
/** A remembered login lasts 30 days from its last use. */
export const LOGIN_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** Browsers remembered per account; a new one drops the least recently used. */
export const MAX_LOGIN_TOKENS = 5;

/** LOGIN packet flags. */
export const LOGIN_FLAG_REMEMBER = 1;
/** The password field holds a remembered-login token. */
export const LOGIN_FLAG_TOKEN = 2;
/** The client handles the character list and picks a character after login. */
export const LOGIN_FLAG_CHARACTER_SELECT = 4;

export interface LoginTokenEntry {
    hash: string;
    /** The token this one replaced; seeing it again means the browser's token was copied. */
    previousHash?: string;
    lastUsed: number;
}

export type LoginTokenCheck =
    | { kind: "valid"; index: number }
    | { kind: "reused"; index: number }
    | { kind: "invalid" };

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function hashLoginToken(token: string): string {
    return createHash("sha256").update(token, "latin1").digest("hex");
}

/** The saved entries still in date, dropping anything malformed. */
export function readLoginTokens(value: unknown, now: number): LoginTokenEntry[] {
    if (!Array.isArray(value)) return [];
    const entries: LoginTokenEntry[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const { hash, previousHash, lastUsed } = raw as Record<string, unknown>;
        if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) continue;
        if (typeof lastUsed !== "number" || !Number.isFinite(lastUsed)) continue;
        if (now - lastUsed > LOGIN_TOKEN_LIFETIME_MS) continue;
        entries.push({
            hash,
            ...(typeof previousHash === "string" && HASH_PATTERN.test(previousHash) ? { previousHash } : {}),
            lastUsed,
        });
    }
    return entries;
}

export function checkLoginToken(entries: readonly LoginTokenEntry[], token: string): LoginTokenCheck {
    const hash = hashLoginToken(token);
    const index = entries.findIndex((entry) => entry.hash === hash);
    if (index !== -1) return { kind: "valid", index };
    const reused = entries.findIndex((entry) => entry.previousHash === hash);
    return reused !== -1 ? { kind: "reused", index: reused } : { kind: "invalid" };
}

/** A new token: replaces the entry at `index` (a token login), or adds one (a password login). */
export function issueLoginToken(
    entries: readonly LoginTokenEntry[],
    now: number,
    index?: number,
): { token: string; entries: LoginTokenEntry[] } {
    const token = randomBytes(32).toString("base64url");
    const hash = hashLoginToken(token);
    const next = [...entries];
    if (index !== undefined && next[index]) {
        next[index] = { hash, previousHash: next[index].hash, lastUsed: now };
    } else {
        next.push({ hash, lastUsed: now });
        next.sort((a, b) => b.lastUsed - a.lastUsed);
        next.length = Math.min(next.length, MAX_LOGIN_TOKENS);
    }
    return { token, entries: next };
}

export function revokeLoginToken(entries: readonly LoginTokenEntry[], index: number): LoginTokenEntry[] {
    return entries.filter((_, i) => i !== index);
}
