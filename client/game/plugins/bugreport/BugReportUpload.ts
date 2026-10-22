/** The plugin-message channel. Mirrored by server/plugins/interface/BugReports.plugin.js. */
export const BUG_REPORT_CHANNEL = "bug-report";
/** Base64 characters per chunk: a chunk message stays under the 16 KB plugin-message limit. */
export const CHUNK_CHARS = 15_000;
/** The largest report the server takes, in base64 characters. Mirrored by the server. */
export const MAX_REPORT_CHARS = 3_000_000;
/**
 * Chunks per burst, one burst per BURST_MS: 40 a second, under the server's 64 plugin messages
 * a second per player, with room left for voice signalling.
 */
const BURST = 10;
const BURST_MS = 250;
const READY_TIMEOUT_MS = 15_000;
/** Filing on GitHub takes a few requests; the server gives up on them after 60 seconds. */
const RESULT_TIMEOUT_MS = 90_000;
const RESEND_ROUNDS = 3;

export type BugReportReply = { type: string; id?: string; [key: string]: unknown };
export type BugReportSent = { issueUrl?: string; issueNumber?: number };

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

/** A report as base64 slices of its UTF-8 JSON, in order. */
export function encodeReport(report: unknown): string[] {
    const base64 = bytesToBase64(new TextEncoder().encode(JSON.stringify(report)));
    const chunks: string[] = [];
    for (let i = 0; i < base64.length; i += CHUNK_CHARS) chunks.push(base64.slice(i, i + CHUNK_CHARS));
    return chunks;
}

/**
 * Sends one report over the plugin-message channel: `begin`, the chunks in paced bursts, `end`,
 * then any chunks the server says are missing. The server answers `sent` once the report is
 * filed, or `rejected`/`failed` with a reason to show the player.
 */
export class BugReportUpload {
    private waiting?: {
        id: string;
        types: readonly string[];
        resolve: (reply: BugReportReply) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    };

    constructor(
        private readonly send: (data: Record<string, unknown>) => void,
        private readonly sleep: (ms: number) => Promise<void> = (ms) =>
            new Promise((resolve) => setTimeout(resolve, ms)),
    ) {}

    /** A reply from the server; true when this upload was waiting for it. */
    handle(reply: BugReportReply): boolean {
        const waiting = this.waiting;
        if (!waiting || reply.id !== waiting.id) return false;
        if (reply.type === "rejected" || reply.type === "failed") {
            this.finish();
            waiting.reject(new Error(typeof reply.reason === "string" ? reply.reason : "The server refused the report."));
            return true;
        }
        if (!waiting.types.includes(reply.type)) return false;
        this.finish();
        waiting.resolve(reply);
        return true;
    }

    /** Stops waiting, e.g. on logout. */
    cancel(reason: string): void {
        const waiting = this.waiting;
        if (!waiting) return;
        this.finish();
        waiting.reject(new Error(reason));
    }

    async upload(
        id: string,
        chunks: readonly string[],
        onProgress: (sent: number) => void = () => {},
    ): Promise<BugReportSent> {
        const chars = chunks.reduce((total, chunk) => total + chunk.length, 0);
        if (chars > MAX_REPORT_CHARS) throw new Error("The report is too large to send.");
        const ready = this.wait(id, ["ready"], READY_TIMEOUT_MS);
        this.send({ type: "begin", id, chunks: chunks.length, chars });
        await ready;
        let pending = chunks.map((_, index) => index);
        for (let round = 0; ; round++) {
            for (let i = 0; i < pending.length; i++) {
                if (i > 0 && i % BURST === 0) await this.sleep(BURST_MS);
                const index = pending[i];
                this.send({ type: "chunk", id, index, data: chunks[index] });
                if (round === 0) onProgress((i + 1) / chunks.length);
            }
            const result = this.wait(id, ["missing", "sent"], RESULT_TIMEOUT_MS);
            this.send({ type: "end", id });
            const reply = await result;
            if (reply.type === "sent") {
                return {
                    issueUrl: typeof reply.issueUrl === "string" ? reply.issueUrl : undefined,
                    issueNumber: typeof reply.issueNumber === "number" ? reply.issueNumber : undefined,
                };
            }
            const missing = Array.isArray(reply.chunks)
                ? reply.chunks.filter((index): index is number =>
                    Number.isInteger(index) && index >= 0 && index < chunks.length)
                : [];
            if (missing.length === 0 || round + 1 >= RESEND_ROUNDS) {
                throw new Error("Part of the report didn't reach the server.");
            }
            pending = missing;
        }
    }

    private wait(id: string, types: readonly string[], timeoutMs: number): Promise<BugReportReply> {
        this.cancel("Another report started.");
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.waiting?.timer !== timer) return;
                this.waiting = undefined;
                reject(new Error("The server didn't answer."));
            }, timeoutMs);
            this.waiting = { id, types, resolve, reject, timer };
        });
    }

    private finish(): void {
        if (this.waiting) clearTimeout(this.waiting.timer);
        this.waiting = undefined;
    }
}
