/** Bounded UTF-8 JSON framing inside the existing 16KiB plugin packet codec. */
export const MAX_CHUNKED_PLUGIN_BYTES = 512 * 1024;
export const PLUGIN_CHUNK_PAYLOAD_CHARS = 12000;
export const MAX_PLUGIN_CHUNKS = 64;
const SINGLE_MESSAGE_BYTES = 14000;
const ASSEMBLY_TTL_MS = 10000;
const encoder = new TextEncoder();

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function session(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export function encodeChunkedPluginMessage(data: Record<string, unknown>): Record<string, unknown>[] {
    if (!record(data) || !session(data.session)) throw new Error("Invalid plugin message session");
    const bytes = encoder.encode(JSON.stringify(data));
    if (bytes.length > MAX_CHUNKED_PLUGIN_BYTES) throw new Error("Plugin snapshot exceeds its byte limit");
    if (bytes.length <= SINGLE_MESSAGE_BYTES) return [data];
    const payload = encodeBase64(bytes);
    const total = Math.ceil(payload.length / PLUGIN_CHUNK_PAYLOAD_CHARS);
    if (total > MAX_PLUGIN_CHUNKS) throw new Error("Too many plugin message chunks");
    const id = crypto.randomUUID();
    return Array.from({ length: total }, (_, index) => ({
        type: "chunk", protocol: 1, session: data.session, id, index, total,
        encoding: "base64-json", payload: payload.slice(index * PLUGIN_CHUNK_PAYLOAD_CHARS, (index + 1) * PLUGIN_CHUNK_PAYLOAD_CHARS),
    }));
}

type Assembly = { session: string; id: string; total: number; started: number; parts: Map<number, string>; size: number };

export class ChunkedPluginMessageAssembler {
    private assembly?: Assembly;

    constructor(private readonly expectedSession?: string) {}

    clear(): void { this.assembly = undefined; }

    accept(frame: unknown, now: number = Date.now()): Record<string, unknown> | null {
        if (!record(frame) || !session(frame.session) ||
            (this.expectedSession !== undefined && frame.session !== this.expectedSession)) {
            throw new Error("Invalid plugin message session");
        }
        if (frame.type !== "chunk") {
            if (encoder.encode(JSON.stringify(frame)).length > SINGLE_MESSAGE_BYTES) throw new Error("Unframed plugin message too large");
            return frame;
        }
        const { id, index, total, payload } = frame;
        if (frame.protocol !== 1 || frame.encoding !== "base64-json" || !session(id) ||
            !Number.isInteger(index) || !Number.isInteger(total) || (index as number) < 0 ||
            (total as number) < 1 || (total as number) > MAX_PLUGIN_CHUNKS || (index as number) >= (total as number) ||
            typeof payload !== "string" || !payload.length || payload.length > PLUGIN_CHUNK_PAYLOAD_CHARS ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || ((index as number) < (total as number) - 1 && payload.includes("="))) {
            throw new Error("Invalid plugin chunk envelope");
        }
        if (this.assembly && now - this.assembly.started >= ASSEMBLY_TTL_MS) this.clear();
        if (!this.assembly) this.assembly = { session: frame.session, id, total: total as number, started: now, parts: new Map(), size: 0 };
        const current = this.assembly;
        if (current.session !== frame.session || current.id !== id || current.total !== total) throw new Error("Another plugin message is incomplete");
        const previous = current.parts.get(index as number);
        if (previous !== undefined) {
            if (previous !== payload) { this.clear(); throw new Error("Conflicting plugin chunk"); }
            return null;
        }
        current.parts.set(index as number, payload);
        current.size += payload.length;
        if (current.size > Math.ceil(MAX_CHUNKED_PLUGIN_BYTES / 3) * 4) { this.clear(); throw new Error("Plugin assembly exceeds byte limit"); }
        if (current.parts.size !== current.total) return null;
        this.clear();
        let joined = "";
        for (let i = 0; i < current.total; i++) joined += current.parts.get(i);
        const binary = atob(joined);
        if (binary.length > MAX_CHUNKED_PLUGIN_BYTES) throw new Error("Plugin assembly exceeds byte limit");
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (!record(value) || value.session !== current.session || value.type === "chunk") throw new Error("Invalid assembled plugin message");
        return value;
    }
}
