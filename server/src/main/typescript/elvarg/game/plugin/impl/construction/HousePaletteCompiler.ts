export const HOUSE_SCENE_CHUNKS = 13;
export const HOUSE_PLANES = 4;

export type TemplateChunk = Readonly<{
  sourceChunkX: number;
  sourceChunkY: number;
  sourcePlane: number;
  rotation: number;
}>;

/** Packs the canonical 26-bit REBUILD_REGION template chunk. */
export function packTemplateChunk(chunk: TemplateChunk): number {
  return (((chunk.sourcePlane & 3) << 24)
    | ((chunk.sourceChunkX & 0x3ff) << 14)
    | ((chunk.sourceChunkY & 0x7ff) << 3)
    | ((chunk.rotation & 3) << 1)) >>> 0;
}

export function rotateChunkX(localX: number, localY: number, rotation: number): number {
  switch (rotation & 3) {
    case 0: return localX;
    case 1: return localY;
    case 2: return 7 - localX;
    default: return 7 - localY;
  }
}

export function rotateChunkY(localX: number, localY: number, rotation: number): number {
  switch (rotation & 3) {
    case 0: return localY;
    case 1: return 7 - localX;
    case 2: return 7 - localY;
    default: return localX;
  }
}

export function rotateHotspot(localX: number, localY: number, rotation: number): Readonly<{ x: number; y: number }> {
  return { x: rotateChunkX(localX, localY, rotation), y: rotateChunkY(localX, localY, rotation) };
}

export function emptyHousePalette(): number[][][] {
  return Array.from({ length: HOUSE_PLANES }, () =>
    Array.from({ length: HOUSE_SCENE_CHUNKS }, () => Array<number>(HOUSE_SCENE_CHUNKS).fill(-1)),
  );
}
