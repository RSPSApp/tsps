import * as pako from "pako";
import type { CacheInfo } from "../../rs/cache/CacheInfo";
import { SeqType } from "../../rs/config/seqtype/SeqType";
import type { Model } from "../../rs/model/Model";
/** Model-local signed i16 XYZ, little endian, in the encoded model's vertex order. */
export type SampledAnimationRow = {
    id: number;
    modelId: number;
    vertexCount: number;
    frameLengths: number[];
    loop: boolean;
    part: number;
    total: number;
    hash: string;
    data: string;
};
type Entry = {
    row: SampledAnimationRow;
    rows: SampledAnimationRow[];
    poses: Int16Array;
    types: Map<string, SeqType>;
};
const entries = new Map<number, Entry>();
const pending = new Map<number, {
    row: SampledAnimationRow;
    rows: Map<number, SampledAnimationRow>;
}>();
export function animationHash(bytes: Uint8Array): string {
    let hash = 2166136261;
    for (const byte of bytes)
        hash = Math.imul(hash ^ byte, 16777619);
    return (hash >>> 0).toString(16);
}
function metadata(row: SampledAnimationRow): string {
    return JSON.stringify([row.id, row.modelId, row.vertexCount, row.frameLengths, row.loop, row.total, row.hash]);
}
function valid(row: SampledAnimationRow): void {
    if (!row || !Number.isInteger(row.id) || row.id < 50000 || row.id > 65534 ||
        !Number.isInteger(row.modelId) || row.modelId < 1000000 || row.modelId > 0x7fffffff ||
        !Number.isInteger(row.vertexCount) || row.vertexCount < 1 || row.vertexCount > 24000 ||
        !Array.isArray(row.frameLengths) || !row.frameLengths.length || row.frameLengths.length > 240 ||
        row.frameLengths.some(n => !Number.isInteger(n) || n < 1 || n > 400) ||
        row.frameLengths.reduce((a, b) => a + b, 0) > 400 || typeof row.loop !== "boolean" ||
        !Number.isInteger(row.total) || row.total < 1 || row.total > 48 ||
        !Number.isInteger(row.part) || row.part < 0 || row.part >= row.total ||
        !/^[a-f0-9]{1,8}$/.test(row.hash) || typeof row.data !== "string" || row.data.length > 32000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(row.data))
        throw new Error("Invalid sampled animation chunk");
}
export const SampledAnimationRegistry = {
    revision: 0,
    accept(row: SampledAnimationRow): void {
        valid(row);
        const installed = entries.get(row.id);
        if (installed && metadata(installed.row) === metadata(row))
            return;
        let bundle = pending.get(row.id);
        if (!bundle || bundle.row.hash !== row.hash) {
            if (pending.size >= 64 && !pending.has(row.id))
                throw new Error("Too many pending animations");
            bundle = { row: structuredClone(row), rows: new Map() };
            pending.set(row.id, bundle);
        }
        if (metadata(row) !== metadata(bundle.row))
            throw new Error("Animation chunks disagree");
        bundle.rows.set(row.part, structuredClone(row));
        if (bundle.rows.size !== row.total)
            return;
        const rows = Array.from({ length: row.total }, (_, i) => bundle!.rows.get(i)!);
        const binary = atob(rows.map(r => r.data).join("")), compressed = Uint8Array.from(binary, c => c.charCodeAt(0));
        if (animationHash(compressed) !== row.hash) {
            pending.delete(row.id);
            throw new Error("Animation checksum mismatch");
        }
        const expectedBytes = row.vertexCount * row.frameLengths.length * 6;
        // Stop inflate as soon as it exceeds its declared, bounded geometry size.
        const chunks: Uint8Array[] = [], inflater = new pako.Inflate();
        let size = 0;
        inflater.onData = (chunk: Uint8Array) => {
            size += chunk.length;
            if (size > expectedBytes) throw new Error("Animation exceeds declared size");
            chunks.push(chunk);
        };
        try {
            inflater.push(compressed, true);
        } catch (error) {
            pending.delete(row.id);
            throw error;
        }
        if (inflater.err || size !== expectedBytes) {
            pending.delete(row.id);
            throw new Error("Animation geometry is truncated");
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        const view = new DataView(bytes.buffer), poses = new Int16Array(size / 2);
        for (let i = 0; i < poses.length; i++)
            poses[i] = view.getInt16(i * 2, true);
        entries.set(row.id, { row: rows[0], rows, poses, types: new Map() });
        pending.delete(row.id);
        this.revision++;
    },
    get(id: number): Entry | undefined { return entries.get(id); },
    getAll(): SampledAnimationRow[] { return [...entries.values()].flatMap(entry => entry.rows); },
    clear(): void { entries.clear(); pending.clear(); this.revision++; },
    sequence(id: number, info: CacheInfo): SeqType | undefined {
        const entry = entries.get(id);
        if (!entry)
            return undefined;
        const key = `${info.game}:${info.revision}`;
        let type = entry.types.get(key);
        if (!type) {
            type = new SeqType(id, info);
            type.frameIds = entry.row.frameLengths.map(() => 0);
            type.frameLengths = [...entry.row.frameLengths];
            type.frameStep = entry.row.loop ? type.frameIds.length : -1;
            type.maxLoops = entry.row.loop ? 99 : 1;
            type.looping = entry.row.loop;
            type.priority = 0;
            type.precedenceAnimating = 0;
            type.forcedPriority = 5;
            entry.types.set(key, type);
        }
        return type;
    },
    apply(model: Model, modelId: number, id: number, frame: number, next = frame, alpha = 0): boolean {
        const entry = entries.get(id);
        if (!entry || entry.row.modelId !== modelId || model.verticesCount !== entry.row.vertexCount)
            return false;
        const count = entry.row.frameLengths.length, stride = entry.row.vertexCount * 3, a = Math.max(0, frame | 0) % count * stride, b = Math.max(0, next | 0) % count * stride, t = Math.max(0, Math.min(1, alpha));
        model.enableFractionalAnimation();
        for (let i = 0; i < model.verticesCount; i++) {
            model.verticesX[i] = entry.poses[a + i * 3] + (entry.poses[b + i * 3] - entry.poses[a + i * 3]) * t;
            model.verticesY[i] = entry.poses[a + i * 3 + 1] + (entry.poses[b + i * 3 + 1] - entry.poses[a + i * 3 + 1]) * t;
            model.verticesZ[i] = entry.poses[a + i * 3 + 2] + (entry.poses[b + i * 3 + 2] - entry.poses[a + i * 3 + 2]) * t;
        }
        model.invalidateBounds();
        return true;
    },
};
