import type { SceneFragment } from "../buffer/SceneBuffer";

type Chunk = { signature: string; fragment: SceneFragment };

let defaultMaxSquares = 4;
let defaultMaxBytes = 128 << 20;

/** The Performance preset sets these before workers build scenery. */
export function setSceneChunkCacheLimits(maxSquares: number, maxBytes: number): void {
    defaultMaxSquares = Math.max(1, maxSquares | 0);
    defaultMaxBytes = Math.max(0, maxBytes | 0);
}

/**
 * What a worker keeps of the scenery it packed for a map square, per 8x8-tile chunk. A loc-only
 * rebuild (one tree felled) changes one chunk and would otherwise pack every model in the square
 * again; a chunk whose models and positions are unchanged reuses its packed fragment instead.
 *
 * An entry is the chunk's signature (every input the packing reads) and its output, so a reuse
 * is the same geometry that packing would give. The newest squares are kept, within a byte limit.
 */
export class SceneChunkCache {
    private readonly squares = new Map<number, Map<number, Chunk>>();
    private bytes = 0;

    constructor(
        private readonly maxSquares = defaultMaxSquares,
        private readonly maxBytes = defaultMaxBytes,
    ) {}

    /** The square's chunks as stored by the last build of it. */
    chunksOf(squareId: number): ReadonlyMap<number, Chunk> | undefined {
        return this.squares.get(squareId);
    }

    /** Replaces a square's chunks with the ones its latest build used (older ones are gone). */
    store(squareId: number, chunks: Map<number, Chunk>): void {
        const previous = this.squares.get(squareId);
        if (previous) this.bytes -= SceneChunkCache.size(previous);
        this.squares.delete(squareId);
        const size = SceneChunkCache.size(chunks);
        if (size > this.maxBytes) return;
        this.squares.set(squareId, chunks);
        this.bytes += size;
        for (const id of this.squares.keys()) {
            if (this.squares.size <= this.maxSquares && this.bytes <= this.maxBytes) break;
            if (id === squareId) continue;
            this.bytes -= SceneChunkCache.size(this.squares.get(id)!);
            this.squares.delete(id);
        }
    }

    clear(): void {
        this.squares.clear();
        this.bytes = 0;
    }

    private static size(chunks: Map<number, Chunk>): number {
        let size = 0;
        for (const chunk of chunks.values()) size += chunk.fragment.byteLength + chunk.signature.length * 2;
        return size;
    }
}
