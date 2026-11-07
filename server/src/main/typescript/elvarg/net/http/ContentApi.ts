import { getWorldDefinition } from "../../game/definition/WorldDefinition";
import { createHash } from "crypto";

/**
 * Read-only JSON resources served next to the game socket, on the same port and origin the
 * client already connects to.
 *
 * This exists so a plugin can back an interface with data the client should not have to
 * know about - a search, a list, a definition - without inventing a packet for it.
 * Resources are request/response shaped and can be large; the game protocol is neither.
 *
 * Resources are public and read-only by design: everything served here is cache-derived
 * data the client can already read out of its own cache. Anything player-specific or
 * privileged belongs on the game socket, where the session is already authenticated.
 */
export type ContentApiHandler = (
    query: URLSearchParams,
    /** Path segments after the resource name, e.g. ["30002"] for /api/interfaces/30002. */
    segments: string[]
) => unknown;

export type ContentApiResponse = {
    status: number;
    body: string;
    headers: Record<string, string>;
};

export class ContentApi {
    public static readonly PREFIX = "/api/";
    private static readonly handlers = new Map<string, ContentApiHandler>();

    public static register(name: string, handler: ContentApiHandler): void {
        const normalized = String(name ?? "").trim().toLowerCase();
        if (!/^[a-z0-9-]+$/.test(normalized)) {
            throw new Error(`Invalid content resource name: ${String(name)}`);
        }
        this.handlers.set(normalized, handler);
    }

    /** Plugins re-register on reload; clearing keeps stale handlers from lingering. */
    public static clear(): void {
        this.handlers.clear();
    }

    /**
     * Returns null when the url is not ours, so the caller can fall through to its own
     * routes. `ifNoneMatch` is the request's If-None-Match header, if any.
     */
    public static resolve(
        method: string,
        url: string,
        ifNoneMatch?: string
    ): ContentApiResponse | null {
        if (!url.startsWith(this.PREFIX)) {
            return null;
        }

        const parsed = new URL(url, "http://localhost");
        const path = parsed.pathname.slice(this.PREFIX.length);
        const segments = path.split("/").filter((segment) => segment.length > 0);
        const name = (segments.shift() ?? "").toLowerCase();
        const handler: ContentApiHandler | undefined = name === "world-info"
            ? (_query, segments) => segments.length ? undefined : { name: getWorldDefinition().name }
            : this.handlers.get(name);
        if (!handler) {
            return this.json(404, { error: "unknown resource" });
        }

        // Read-only resources: anything but a read is a client mistake, not a 404.
        const verb = String(method ?? "GET").toUpperCase();
        if (verb !== "GET" && verb !== "HEAD") {
            return {
                ...this.json(405, { error: "method not allowed" }),
                headers: { "Content-Type": "application/json", Allow: "GET, HEAD" },
            };
        }

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

        const body = JSON.stringify(payload ?? null);
        const etag = `"${createHash("sha1").update(body).digest("base64")}"`;
        if (ifNoneMatch && this.matchesEtag(ifNoneMatch, etag)) {
            return { status: 304, body: "", headers: { ETag: etag } };
        }
        return {
            status: 200,
            body,
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
