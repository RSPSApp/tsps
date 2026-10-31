import { createHash } from "crypto";

/**
 * JSON resources served next to the game socket, on the same port and origin the
 * client already connects to. Readers are read-only; writers are local-development only.
 *
 * This exists so a plugin can back an interface with data the client should not have to
 * know about - a search, a list, a definition - without inventing a packet for it.
 * Resources are request/response shaped and can be large; the game protocol is neither.
 *
 * Readers are public and read-only by design: everything served there is cache-derived
 * data the client can already read out of its own cache. Writers exist for the local map
 * editor's drop overrides and must only be registered outside production. Anything
 * player-specific or privileged belongs on the game socket, where the session is
 * already authenticated.
 */
export type ContentApiHandler = (
    query: URLSearchParams,
    /** Path segments after the resource name, e.g. ["30002"] for /api/interfaces/30002. */
    segments: string[]
) => unknown;

/**
 * A development-only write handler. Writers are deliberately separate from the
 * read-only resources above: the content API is public, and only a local editor
 * may change files behind it.
 */
export type ContentApiWriter = (
    query: URLSearchParams,
    segments: string[],
    body: string,
    method: string
) => unknown;

export type ContentApiResponse = {
    status: number;
    body: string;
    headers: Record<string, string>;
};

export class ContentApi {
    public static readonly PREFIX = "/api/";
    private static readonly handlers = new Map<string, ContentApiHandler>();
    private static readonly writers = new Map<string, ContentApiWriter>();

    public static register(name: string, handler: ContentApiHandler): void {
        const normalized = this.normalizeName(name);
        this.handlers.set(normalized, handler);
    }

    public static registerWriter(name: string, handler: ContentApiWriter): void {
        const normalized = this.normalizeName(name);
        this.writers.set(normalized, handler);
    }

    private static normalizeName(name: string): string {
        const normalized = String(name ?? "").trim().toLowerCase();
        if (!/^[a-z0-9-]+$/.test(normalized)) {
            throw new Error(`Invalid content resource name: ${String(name)}`);
        }
        return normalized;
    }

    /** Plugins re-register on reload; clearing keeps stale handlers from lingering. */
    public static clear(): void {
        this.handlers.clear();
        this.writers.clear();
    }

    /**
     * Returns null when the url is not ours, so the caller can fall through to its own
     * routes. `ifNoneMatch` is the request's If-None-Match header, if any. `body` is the
     * already-read request body for a writer request.
     */
    public static resolve(
        method: string,
        url: string,
        ifNoneMatch?: string,
        body?: string
    ): ContentApiResponse | null {
        if (!url.startsWith(this.PREFIX)) {
            return null;
        }

        const parsed = new URL(url, "http://localhost");
        const path = parsed.pathname.slice(this.PREFIX.length);
        const segments = path.split("/").filter((segment) => segment.length > 0);
        const name = (segments.shift() ?? "").toLowerCase();
        const verb = String(method ?? "GET").toUpperCase();

        if (verb !== "GET" && verb !== "HEAD") {
            const writer = this.writers.get(name);
            if (!writer) {
                return {
                    ...this.json(405, { error: "method not allowed" }),
                    headers: { "Content-Type": "application/json", Allow: "GET, HEAD" },
                };
            }
            let payload: unknown;
            try {
                payload = writer(
                    parsed.searchParams,
                    segments.map((segment) => segment.toLowerCase()),
                    body ?? "",
                    verb
                );
            } catch (error) {
                console.error(`[content-api] ${name} write failed`, error);
                return this.json(500, { error: "writer failed" });
            }
            if (payload === undefined) {
                return this.json(404, { error: "not found" });
            }
            return this.json(200, payload ?? null);
        }

        const handler = this.handlers.get(name);
        if (!handler) {
            return this.json(404, { error: "unknown resource" });
        }

        // Read-only resources: anything but a read is a client mistake, not a 404.
        let payload: unknown;
        try {
            payload = handler(parsed.searchParams, segments.map((segment) => segment.toLowerCase()));
        } catch (error) {
            console.error(`[content-api] ${name} failed`, error);
            return this.json(500, { error: "handler failed" });
        }
        if (payload === undefined) {
            return this.json(404, { error: "not found" });
        }

        const responseBody = JSON.stringify(payload ?? null);
        const etag = `"${createHash("sha1").update(responseBody).digest("base64")}"`;
        if (ifNoneMatch && this.matchesEtag(ifNoneMatch, etag)) {
            return { status: 304, body: "", headers: { ETag: etag } };
        }
        return {
            status: 200,
            body: responseBody,
            headers: { "Content-Type": "application/json", ETag: etag },
        };
    }

    private static matchesEtag(ifNoneMatch: string, etag: string): boolean {
        return ifNoneMatch
            .split(",")
            .map((candidate) => candidate.trim())
            .some((candidate) => candidate === etag || candidate === "*");
    }

    private static json(status: number, payload: unknown): ContentApiResponse {
        return {
            status,
            body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
        };
    }
}
