/** Native loc_merge offsets are signed bytes, relative to the loc's anchor tile. */
export interface LocMergeBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Delays are 20ms client cycles. Reversed bounds are valid on the wire. */
export interface LocMergePayload extends LocMergeBounds {
  locId: number;
  tile: { x: number; y: number };
  level: number;
  shape: number;
  rotation: number;
  playerIndex: number;
  start: number;
  end: number;
}

export function validateLocMerge(merge: LocMergePayload): void {
  const integer = (name: string, value: number, min: number, max: number) => {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(`loc_merge ${name} must be an integer in ${min}..${max}`);
    }
  };
  integer("locId", merge.locId, 0, 0xffff);
  integer("x", merge.tile.x, 0, 0xffff);
  integer("z", merge.tile.y, 0, 0xffff);
  integer("level", merge.level, 0, 3);
  integer("shape", merge.shape, 0, 31);
  integer("rotation", merge.rotation, 0, 3);
  integer("playerIndex", merge.playerIndex, 0, 2047);
  integer("start", merge.start, 0, 0xffff);
  integer("end", merge.end, merge.start + 1, 0xffff);
  for (const key of ["minX", "minZ", "maxX", "maxZ"] as const) integer(key, merge[key], -128, 127);
}
