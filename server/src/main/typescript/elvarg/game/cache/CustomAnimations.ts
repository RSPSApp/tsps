import { inflateSync } from 'node:zlib';
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
const bundles = new Map<number, {
    source: string;
    rows: SampledAnimationRow[];
}>();
function hash(bytes: Uint8Array) { let n = 2166136261; for (const b of bytes)
    n = Math.imul(n ^ b, 16777619); return (n >>> 0).toString(16); }
/** Validate every chunk before replacing any source-owned registrations. */
export function registerCustomAnimations(input: SampledAnimationRow[], source: string, nativeCount: number): void {
    if (!Array.isArray(input) || input.length > 288 || typeof source !== 'string' || !source)
        throw new Error('Invalid custom animation source');
    const next = new Map<number, SampledAnimationRow[]>();
    for (const row of input) {
        if (!row || !Number.isInteger(row.id) || row.id < Math.max(50000, nativeCount) || row.id > 65534 || !Number.isInteger(row.modelId) || row.modelId < 1000000 || row.modelId > 0x7fffffff || !Number.isInteger(row.vertexCount) || row.vertexCount < 1 || row.vertexCount > 24000 || !Array.isArray(row.frameLengths) || !row.frameLengths.length || row.frameLengths.length > 240 || row.frameLengths.some(n => !Number.isInteger(n) || n < 1 || n > 400) || row.frameLengths.reduce((n, v) => n + v, 0) > 400 || typeof row.loop !== 'boolean' || !Number.isInteger(row.total) || row.total < 1 || row.total > 48 || !Number.isInteger(row.part) || row.part < 0 || row.part >= row.total || typeof row.hash !== 'string' || !/^[a-f0-9]{1,8}$/.test(row.hash) || typeof row.data !== 'string' || row.data.length > 32000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(row.data))
            throw new Error('Invalid custom animation chunk');
        if (bundles.has(row.id) && bundles.get(row.id)!.source !== source)
            throw new Error(`Animation ${row.id} belongs to another package`);
        const rows = next.get(row.id) ?? [];
        if (rows.some(r => r.part === row.part))
            throw new Error('Duplicate animation chunk');
        rows.push(structuredClone(row));
        next.set(row.id, rows);
    }
    for (const rows of next.values()) {
        rows.sort((a, b) => a.part - b.part);
        const first = rows[0];
        if (rows.length !== first.total || rows.some((row, i) => row.part !== i || row.id !== first.id || row.modelId !== first.modelId || row.vertexCount !== first.vertexCount || row.total !== first.total || row.hash !== first.hash || row.loop !== first.loop || JSON.stringify(row.frameLengths) !== JSON.stringify(first.frameLengths)))
            throw new Error('Incomplete animation bundle');
        const bytes = Buffer.from(rows.map(row => row.data).join(''), 'base64'), size = first.vertexCount * first.frameLengths.length * 6;
        if (hash(bytes) !== first.hash || inflateSync(bytes, { maxOutputLength: size }).length !== size)
            throw new Error('Invalid animation geometry');
    }
    for (const [id, bundle] of bundles)
        if (bundle.source === source)
            bundles.delete(id);
    for (const [id, rows] of next)
        bundles.set(id, { source, rows });
}
export const customAnimation = (id: number) => bundles.get(id)?.rows[0];
export const customAnimationRows = () => [...bundles.values()].flatMap(bundle => bundle.rows.map(row => structuredClone(row)));
