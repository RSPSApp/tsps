// Pure geometry for the map-editing tools: turns a shape description into the list
// of tiles it covers. No world state, no I/O, so it is cheap to unit test and cheap
// for an agent to compose - a whole city is a handful of these calls rather than
// hundreds of place_object calls.
//
// Every function returns [{ x, y }], de-duplicated, in a stable order.

const { diagonalWallFace, diagonalWallJoin } = require("./DiagonalWall");

const ROUND = Math.round;

/** Tiles along a straight line, both ends included. */
function line(x1, y1, x2, y2) {
  const tiles = [];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return [{ x: ROUND(x1), y: ROUND(y1) }];
  for (let i = 0; i <= steps; i++) {
    tiles.push({
      x: ROUND(x1 + (dx * i) / steps),
      y: ROUND(y1 + (dy * i) / steps),
    });
  }
  return unique(tiles);
}

/**
 * Ring of tiles at `radius` from a centre. `thickness` grows it outward;
 * `gapDegrees` opens an arc centred on `gapAngle` (0 = east, 90 = north).
 */
function ring(cx, cy, radius, options = {}) {
  const thickness = Math.max(1, options.thickness ?? 1);
  const gapDegrees = options.gapDegrees ?? 0;
  const gapAngle = options.gapAngle ?? 0;
  const limit = radius + 2;
  const tiles = [];
  for (let x = Math.floor(cx - limit); x <= Math.ceil(cx + limit); x++) {
    for (let y = Math.floor(cy - limit); y <= Math.ceil(cy + limit); y++) {
      const distance = Math.hypot(x - cx, y - cy);
      const outer = radius + (thickness - 1) / 2;
      const inner = radius - thickness / 2 - 0.5;
      if (distance > outer + 0.5 || distance < inner) continue;
      if (gapDegrees > 0) {
        const angle = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
        const delta = Math.abs(((angle - gapAngle + 540) % 360) - 180);
        if (delta <= gapDegrees / 2) continue;
      }
      tiles.push({ x, y });
    }
  }
  return unique(tiles);
}

/** Rectangle outline. `doorSide` opens a 1-tile doorway at the middle of that side. */
function box(x1, y1, x2, y2, options = {}) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const doorSide = options.doorSide;
  const doorWidth = Math.max(1, options.doorWidth ?? 1);
  const midX = ROUND((minX + maxX) / 2);
  const midY = ROUND((minY + maxY) / 2);
  const halfDoor = Math.floor(doorWidth / 2);
  const inDoorway = (x, y) => {
    if (!doorSide) return false;
    if (doorSide === "north" && y === maxY) return Math.abs(x - midX) <= halfDoor;
    if (doorSide === "south" && y === minY) return Math.abs(x - midX) <= halfDoor;
    if (doorSide === "east" && x === maxX) return Math.abs(y - midY) <= halfDoor;
    if (doorSide === "west" && x === minX) return Math.abs(y - midY) <= halfDoor;
    return false;
  };
  const tiles = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const onEdge = x === minX || x === maxX || y === minY || y === maxY;
      if (!onEdge || inDoorway(x, y)) continue;
      tiles.push({ x, y });
    }
  }
  return unique(tiles);
}

/** Filled square/rectangle: a tower or keep footprint. */
function tower(x, y, size = 2, options = {}) {
  const width = Math.max(1, options.width ?? size);
  const height = Math.max(1, options.height ?? size);
  const tiles = [];
  for (let dx = 0; dx < width; dx++) {
    for (let dy = 0; dy < height; dy++) tiles.push({ x: x + dx, y: y + dy });
  }
  return unique(tiles);
}

/** Tiles spaced every `spacing` along a line: pillars, braziers, lamps. */
function repeated(x1, y1, x2, y2, spacing = 4) {
  const path = line(x1, y1, x2, y2);
  return path.filter((_, index) => index % Math.max(1, spacing) === 0);
}

/** Two parallel rows offset from a centre line: an avenue of lamps or braziers. */
function avenue(x1, y1, x2, y2, options = {}) {
  const offset = Math.max(1, options.offset ?? 3);
  const spacing = Math.max(1, options.spacing ?? 4);
  const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
  const tiles = [];
  for (const tile of repeated(x1, y1, x2, y2, spacing)) {
    if (horizontal) tiles.push({ x: tile.x, y: tile.y + offset }, { x: tile.x, y: tile.y - offset });
    else tiles.push({ x: tile.x + offset, y: tile.y }, { x: tile.x - offset, y: tile.y });
  }
  return unique(tiles);
}

/** Rotate a tile list around the origin tile (0/90/180/270 degrees). */
function rotate(tiles, degrees, originX, originY) {
  const turns = (((degrees % 360) + 360) % 360) / 90;
  let out = tiles.map((tile) => ({ x: tile.x, y: tile.y }));
  for (let turn = 0; turn < turns; turn++) {
    out = out.map((tile) => ({
      x: originX + (tile.y - originY),
      y: originY - (tile.x - originX),
    }));
  }
  return unique(out);
}

/** Wall facing: 1 on north/south runs, 0 on east/west, matching the cache's loc rotation. */
function facingFor(cx, cy, x, y) {
  return Math.abs(x - cx) > Math.abs(y - cy) ? 1 : 0;
}

/** Shapes whose footprint is the loc's own size: scenery (10, 11) and ground decoration (22). */
const SIZED_SHAPES = new Set([10, 11, 22]);

/**
 * The tiles a loc covers at rotation `face`: its size for scenery and ground decoration
 * (swapped on a quarter turn), one tile for walls, wall decoration and roofs.
 */
function footprint(shape, face, sizeX = 1, sizeY = 1) {
  if (!SIZED_SHAPES.has(shape)) return { width: 1, height: 1 };
  return face % 2 === 1 ? { width: sizeY, height: sizeX } : { width: sizeX, height: sizeY };
}

/**
 * Turns a loc inside a width x height template a quarter turn clockwise, `turns` times,
 * keeping the template's low corner at 0,0. The cache's rotation is quarter turns clockwise
 * from west (0 west, 1 north, 2 east, 3 south), so each turn adds one to `face`; the loc's
 * position is its low corner, so a sized loc moves by its own footprint.
 */
function rotateLoc(loc, turns, width, height, sizeX = 1, sizeY = 1) {
  let out = { ...loc };
  let w = width;
  let h = height;
  for (let turn = 0; turn < (((turns % 4) + 4) % 4); turn++) {
    const { width: fw } = footprint(out.type, out.face, sizeX, sizeY);
    out = { ...out, dx: out.dy, dy: w - out.dx - fw, face: (out.face + 1) & 3 };
    [w, h] = [h, w];
  }
  return out;
}

/** A tile offset inside a width x height template, turned like rotateLoc. */
function rotateOffset(dx, dy, turns, width, height) {
  let x = dx;
  let y = dy;
  let w = width;
  let h = height;
  for (let turn = 0; turn < (((turns % 4) + 4) % 4); turn++) {
    [x, y] = [y, w - 1 - x];
    [w, h] = [h, w];
  }
  return { dx: x, dy: y };
}

// Straight wall rotations by tile edge, and the L corner (shape 2) for two edges of one tile.
const EDGE_FACE = { W: 0, N: 1, E: 2, S: 3 };
const CORNER_FACE = { "N,W": 0, "E,N": 1, "E,S": 2, "S,W": 3 };

/** True when a closed path of corners runs counter-clockwise (positive shoelace area). */
function counterClockwise(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area > 0;
}

/**
 * Wall pieces along a path of tile corners ([[x, y], ...]; (x, y) is the south-west corner of
 * tile x, y). Axis steps become straight walls (shape 0) on the edge they run along, two edges
 * of one tile an L corner (shape 2), and 45-degree steps diagonal walls (shape 9) across the
 * tile they cross; other angles step as a mix of the two.
 *
 * A wall piece sits on one of the two tiles beside its edge, and shows its finished face to
 * that tile's side (Varrock's city wall is placed on the tiles outside the city): `side`
 * picks the tile on the "left" or "right" of the walking direction. For a closed path,
 * `facing: "out"` or `"in"` picks it whichever way the corners run.
 *
 * `gaps` are corners whose following edge stays open; they come back as `openings`, placed
 * like a wall piece would be, so a caller can hang a gate in them.
 */
function wallPath(points, options = {}) {
  const closed = options.closed === true && points.length > 2;
  let side = options.side === "right" ? "right" : "left";
  if (closed && (options.facing === "out" || options.facing === "in")) {
    // Left of a counter-clockwise loop is its inside.
    const insideIsLeft = counterClockwise(points);
    side = (options.facing === "in") === insideIsLeft ? "left" : "right";
  }
  const gaps = new Set((options.gaps ?? []).map(([x, y]) => `${x},${y}`));
  const corners = closed ? [...points, points[0]] : points;
  const edges = new Map();
  const diagonals = new Map();
  const openings = [];
  const vertices = new Map();
  const touch = (x, y, face) => {
    if (!options.diagonalJoins) return;
    const key = `${x},${y}`;
    if (!vertices.has(key)) vertices.set(key, { x, y, count: 0, faces: new Set() });
    const vertex = vertices.get(key);
    vertex.count++;
    if (face !== undefined) vertex.faces.add(face);
  };
  for (let i = 0; i + 1 < corners.length; i++) {
    let [x, y] = corners[i];
    const [tx, ty] = corners[i + 1];
    while (x !== tx || y !== ty) {
      const sx = Math.sign(tx - x);
      const sy = Math.sign(ty - y);
      const open = gaps.has(`${x},${y}`);
      if (sx !== 0 && sy !== 0) {
        const tile = { x: Math.min(x, x + sx), y: Math.min(y, y + sy) };
        // Which finished face shows depends on the walking direction and the side asked for;
        // walking east, rotation 0/1 showed it on the right (checked by screenshot).
        const flip = (sx > 0) === (side === "left");
        const face = diagonalWallFace(sx, sy, flip);
        if (open) openings.push({ ...tile, type: 9, face });
        else {
          diagonals.set(`${tile.x},${tile.y}`, { ...tile, face });
          touch(x, y, face);
          touch(x + sx, y + sy, face);
        }
        x += sx;
        y += sy;
        continue;
      }
      // The tile on the left of the step, or the right; the wall goes on its edge facing the line.
      let tile;
      let edge;
      const left = side === "left";
      if (sx > 0) [tile, edge] = left ? [{ x, y }, "S"] : [{ x, y: y - 1 }, "N"];
      else if (sx < 0) [tile, edge] = left ? [{ x: x - 1, y: y - 1 }, "N"] : [{ x: x - 1, y }, "S"];
      else if (sy > 0) [tile, edge] = left ? [{ x: x - 1, y }, "E"] : [{ x, y }, "W"];
      else [tile, edge] = left ? [{ x, y: y - 1 }, "W"] : [{ x: x - 1, y: y - 1 }, "E"];
      if (open) {
        openings.push({ ...tile, type: 0, face: EDGE_FACE[edge] });
      } else {
        const key = `${tile.x},${tile.y}`;
        if (!edges.has(key)) edges.set(key, { ...tile, sides: [] });
        if (!edges.get(key).sides.includes(edge)) edges.get(key).sides.push(edge);
        touch(x, y, undefined);
        touch(x + sx, y + sy, undefined);
      }
      x += sx;
      y += sy;
    }
  }
  // Where a straight run turns with its walls on the outside of the turn, the two walls only
  // touch at the corner point: the game fills it with a small corner piece (shape 1) on the
  // tile diagonally outside, rotated to the corner (0 north-west, 1 north-east, 2 south-east,
  // 3 south-west of its tile), as Varrock's houses have them.
  const posts = [];
  if (options.corners !== false) {
    const turnAt = closed ? points.map((_, i) => i) : points.map((_, i) => i).slice(1, -1);
    for (const i of turnAt) {
      const [vx, vy] = points[i];
      const [px, py] = points[(i - 1 + points.length) % points.length];
      const [nx, ny] = points[(i + 1) % points.length];
      const d1 = [Math.sign(vx - px), Math.sign(vy - py)];
      const d2 = [Math.sign(nx - vx), Math.sign(ny - vy)];
      // Axis-aligned runs turning by a right angle only.
      if ((d1[0] !== 0) === (d1[1] !== 0) || (d2[0] !== 0) === (d2[1] !== 0)) continue;
      const cross = d1[0] * d2[1] - d1[1] * d2[0];
      if (cross === 0 || (cross > 0) !== (side === "right")) continue;
      const cx = d1[0] - d2[0];
      const cy = d1[1] - d2[1];
      const tile = { x: vx + (cx > 0 ? 0 : -1), y: vy + (cy > 0 ? 0 : -1) };
      if (edges.has(`${tile.x},${tile.y}`)) continue;
      const face = cy > 0 ? (cx > 0 ? 3 : 2) : (cx > 0 ? 0 : 1);
      posts.push({ ...tile, type: 1, face });
    }
  }
  const pieces = [];
  for (const { x, y, sides } of edges.values()) {
    const corner = sides.length === 2 ? CORNER_FACE[[...sides].sort().join(",")] : undefined;
    // Two opposite edges of one tile cannot share its wall slot: the first one stays.
    if (corner !== undefined) pieces.push({ x, y, type: 2, face: corner });
    else pieces.push({ x, y, type: 0, face: EDGE_FACE[sides[0]] });
  }
  for (const piece of diagonals.values()) pieces.push({ ...piece, type: 9 });
  pieces.push(...posts);
  if (vertices.size) {
    const occupied = new Set([...pieces, ...openings].map(({ x, y }) => `${x},${y}`));
    for (const { x, y, count, faces } of vertices.values()) {
      if (count < 2) continue;
      for (const face of faces) {
        const join = diagonalWallJoin(x, y, face);
        const key = `${join.x},${join.y}`;
        if (occupied.has(key)) continue;
        occupied.add(key);
        pieces.push({ ...join, diagonalJoin: true });
      }
    }
  }
  return { pieces, openings };
}

// Roof shapes, read off a Varrock house (one roof loc for every shape, 15552 there): 18 eave
// edges and 19 eave corners round the outside, 12 slopes and 16 slope corners on each ring in,
// 17 flat tops in the middle. Every edge and corner faces outward: rotation 1 on the south
// side, 0 east, 3 north, 2 west; corners 1 south-west, 0 south-east, 3 north-east, 2 north-west.
const ROOF = { eave: 18, eaveCorner: 19, slope: 12, slopeCorner: 16, flat: 17 };

/**
 * A hip roof over the box x, y (low corner), width x height: one ring of eaves (optional),
 * then one ring of slopes per plane going up from `plane`, and flat tops where the box runs
 * out (one tile wide inside a ring) or the planes do (above 3). Pieces carry their plane.
 */
function hipRoof(x, y, width, height, options = {}) {
  const pieces = [];
  let plane = options.plane ?? 2;
  let [x0, y0, x1, y1] = [x, y, x + width - 1, y + height - 1];
  const ring = (edge, corner, z) => {
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const west = tx === x0;
        const east = tx === x1;
        const south = ty === y0;
        const north = ty === y1;
        if (!west && !east && !south && !north) continue;
        let type = edge;
        let face;
        if ((west || east) && (south || north)) {
          type = corner;
          face = south ? (west ? 1 : 0) : (west ? 2 : 3);
        } else {
          face = south ? 1 : north ? 3 : west ? 2 : 0;
        }
        pieces.push({ x: tx, y: ty, z, type, face });
      }
    }
  };
  const shrink = () => { x0++; y0++; x1--; y1--; };
  if (options.eaves !== false && x1 - x0 >= 2 && y1 - y0 >= 2) {
    ring(ROOF.eave, ROOF.eaveCorner, plane);
    shrink();
  }
  while (x0 <= x1 && y0 <= y1) {
    const width1 = x1 - x0 + 1;
    const height1 = y1 - y0 + 1;
    // One tile wide, or nothing left above: flat tops cover the rest.
    if (width1 === 1 || height1 === 1 || plane > 3) {
      const z = Math.min(plane, 3);
      for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) pieces.push({ x: tx, y: ty, z, type: ROOF.flat, face: 0 });
      break;
    }
    ring(ROOF.slope, ROOF.slopeCorner, plane);
    shrink();
    // The flat tops of a ring that leaves one tile across sit on that ring's plane.
    if (x0 <= x1 && y0 <= y1 && (x1 - x0 === 0 || y1 - y0 === 0)) continue;
    plane++;
  }
  return pieces;
}

/**
 * Heights that level a building's footprint (x0, y0)-(x1, y1) and blend it into the ground.
 *
 * A tile's height is its south-west corner, and a wall stands on the corners at its two ends,
 * so the walls on the north and east sides also stand on the tiles one beyond the footprint:
 * those are levelled too. The level is the median of the stored heights there, so one bump
 * does not set it. Then `blend` rings round it move part of the way from their own height
 * towards the level (a third, then two thirds of the way out for blend 2), so the edge slopes
 * instead of stepping. heightAt(x, y) gives a tile's stored height, or null where the client
 * makes its own: those are set inside the footprint and left alone in the blend, as are
 * tiles options.keep(x, y) protects (a neighbouring building's ground).
 */
function levelPlan(heightAt, x0, y0, x1, y1, options = {}) {
  const blend = Math.max(0, options.blend ?? 2);
  const [cx0, cy0, cx1, cy1] = [x0, y0, x1 + 1, y1 + 1];
  const known = [];
  let unknown = 0;
  for (let x = cx0; x <= cx1; x++) {
    for (let y = cy0; y <= cy1; y++) {
      const height = heightAt(x, y);
      if (height === null || height === undefined) unknown++;
      else known.push(height);
    }
  }
  if (known.length === 0) return { level: null, tiles: [], spread: 0, unknown, moved: 0 };
  const sorted = [...known].sort((a, b) => a - b);
  const level = sorted[Math.floor(sorted.length / 2)];
  const spread = sorted[sorted.length - 1] - sorted[0];
  const tiles = [];
  let moved = 0;
  for (let x = cx0 - blend; x <= cx1 + blend; x++) {
    for (let y = cy0 - blend; y <= cy1 + blend; y++) {
      // Rings out from the levelled core: 0 inside it, 1 just outside, and so on.
      const ring = Math.max(cx0 - x, x - cx1, cy0 - y, y - cy1, 0);
      const height = heightAt(x, y);
      let target;
      if (ring === 0) target = level;
      else if (height === null || height === undefined) continue;
      // A neighbour already built on keeps its ground: blending into it would tilt its walls.
      else if (options.keep?.(x, y)) continue;
      else target = Math.round(level + (height - level) * (ring / (blend + 1)));
      if (target !== height) moved++;
      tiles.push({ x, y, height: target });
    }
  }
  return { level, tiles, spread, unknown, moved };
}

// Standard chair and bed models face south at rotation 0. Individual pieces can offset this.
const AWAY_FROM_WALL = { south: 2, west: 3, north: 0, east: 1 };
const LEGACY_WALL_FACING = { ...AWAY_FROM_WALL, north: 1, east: 0 };

/**
 * Where furniture goes in a room: the inside tiles x0-x1, y0-y1, with its door on `door`
 * (south/north/east/west) at doorX/doorY (the inside tile just through the door).
 *
 * A corridor from the door straight across the room stays free, so the room can always be
 * walked into; `ladder` goes at its far end. Then items in order: `wall` items along the walls
 * turned away from the wall (their footprint turning with them); `corner` items in free corners; a `centre`
 * table in the middle of the larger free side, with `chair` items either side of it. Items
 * that do not fit are left out and returned as `skipped`. Pure: no world state.
 */
function furnishPlan(room, items) {
  const { x0, y0, x1, y1, door, doorX, doorY } = room;
  const taken = new Set();
  const random = room.random;
  const varied = (list) => {
    if (!random || list.length < 2) return list;
    const offset = random(list.length);
    return [...list.slice(offset), ...list.slice(0, offset)];
  };
  const key = (x, y) => `${x},${y}`;
  const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const free = (x, y) => inside(x, y) && !taken.has(key(x, y));
  // The corridor: from the door tile straight to the opposite wall.
  const corridor = [];
  const vertical = door === "south" || door === "north";
  const far = { south: [doorX, y1], north: [doorX, y0], west: [x1, doorY], east: [x0, doorY] }[door];
  if (vertical) for (let y = y0; y <= y1; y++) corridor.push([doorX, y]);
  else for (let x = x0; x <= x1; x++) corridor.push([x, doorY]);
  const end = key(...far);
  const hasFocalPoint = !room.through && room.ladder === undefined && corridor.length >= 4 && items.some(({ place }) => place === "focal");
  for (const [x, y] of corridor) if (!hasFocalPoint || key(x, y) !== end) taken.add(key(x, y));
  const placed = [];
  const skipped = [];
  // The ladder stands beside the corridor's far end, so it is reached by walking straight in.
  if (room.ladder !== undefined) {
    const spots = vertical ? [[far[0] - 1, far[1]], [far[0] + 1, far[1]]] : [[far[0], far[1] - 1], [far[0], far[1] + 1]];
    const spot = spots.find(([x, y]) => free(x, y));
    if (spot) {
      taken.add(key(...spot));
      // A ladder is used from one side only: its access mask leaves north open at rotation 0,
      // and each rotation turns that clockwise (east 1, south 2, west 3). Open it to the corridor.
      const face = spot[0] < far[0] ? 1 : spot[0] > far[0] ? 3 : spot[1] < far[1] ? 0 : 2;
      placed.push({ id: room.ladder, x: spot[0], y: spot[1], face, role: "ladder" });
    } else skipped.push({ id: room.ladder, role: "ladder" });
  }
  // Wall slots, walked round the room: [x, y, wall side, direction along the wall].
  const slots = [];
  for (let x = x0; x <= x1; x++) slots.push([x, y1, "north", [1, 0]]);
  for (let y = y1; y >= y0; y--) slots.push([x1, y, "east", [0, -1]]);
  for (let x = x1; x >= x0; x--) slots.push([x, y0, "south", [-1, 0]]);
  for (let y = y0; y <= y1; y++) slots.push([x0, y, "west", [0, 1]]);
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  const cellsAt = (x, y, width, height) => {
    const cells = [];
    for (let dx = 0; dx < width; dx++) for (let dy = 0; dy < height; dy++) cells.push([x + dx, y + dy]);
    return cells;
  };
  const cornerOf = (x, y) => corners.some(([cx, cy]) => cx === x && cy === y);
  for (const item of items) {
    const [w, h] = item.size ?? [1, 1];
    if (item.place === "wall" || item.place === "focal") {
      // Turned away from the wall, its footprint turns with it (a 1x2 bed against the west wall
      // lies across the room, head to the wall, as Varrock's are); it stands touching the wall.
      let done = false;
      const candidates = varied(slots);
      const preferred = item.wall ? [...candidates.filter((slot) => slot[2] === item.wall), ...candidates.filter((slot) => slot[2] !== item.wall)] : candidates;
      for (const [x, y, side] of preferred) {
        const face = item.face ?? (((random ? AWAY_FROM_WALL : LEGACY_WALL_FACING)[side] + (item.faceOffset ?? 0)) & 3);
        const { width: fw, height: fh } = footprint(10, face, w, h);
        const lowX = side === "east" ? x - fw + 1 : x;
        const lowY = side === "north" ? y - fh + 1 : y;
        const cells = cellsAt(lowX, lowY, fw, fh);
        if (!cells.every(([cx, cy]) => free(cx, cy) && !cornerOf(cx, cy))) continue;
        if (hasFocalPoint && item.place === "focal" && !cells.some(([cx, cy]) => key(cx, cy) === end)) continue;
        for (const [cx, cy] of cells) taken.add(key(cx, cy));
        placed.push({ id: item.id, x: lowX, y: lowY, face, role: "wall" });
        done = true;
        break;
      }
      if (!done) skipped.push({ id: item.id, role: "wall" });
    } else if (item.place === "corner") {
      const spots = corners.map(([x, y]) => [x === x1 ? x - w + 1 : x, y === y1 ? y - h + 1 : y]);
      const spot = varied(spots).find(([x, y]) => cellsAt(x, y, w, h).every(([cx, cy]) => free(cx, cy)));
      if (spot) {
        for (const [cx, cy] of cellsAt(...spot, w, h)) taken.add(key(cx, cy));
        placed.push({ id: item.id, x: spot[0], y: spot[1], face: 0, role: "corner" });
      } else skipped.push({ id: item.id, role: "corner" });
    } else if (item.place === "centre") {
      // The middle of the larger side of the corridor, with room for a chair either side.
      const sideA = vertical ? [x0, doorX - 1] : [y0, doorY - 1];
      const sideB = vertical ? [doorX + 1, x1] : [doorY + 1, y1];
      const [lo, hi] = sideA[1] - sideA[0] >= sideB[1] - sideB[0] ? sideA : sideB;
      // Nearer the corridor than the wall, so the table is reached and does not hug a wall.
      const mid = lo === (vertical ? x0 : y0) ? Math.ceil((lo + hi) / 2) : Math.floor((lo + hi) / 2);
      const other = vertical ? Math.floor((y0 + y1) / 2) : Math.floor((x0 + x1) / 2);
      const spots = [vertical ? [mid, other, 0] : [other, mid, 0]];
      if (random) {
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          spots.push([x, y, 0]);
          if (w !== h) spots.push([x, y, 1]);
        }
      }
      const options = (random ? varied(spots) : spots).flatMap(([x, y, face]) => {
        const { width, height } = footprint(10, face, w, h);
        const cells = cellsAt(x, y, width, height);
        if (!cells.every(([cx, cy]) => free(cx, cy) && (!random || !cornerOf(cx, cy)))) return [];
        // Chairs sit opposite each other on the long sides, facing the table.
        const sx = x + Math.floor((width - 1) / 2), sy = y + Math.floor((height - 1) / 2);
        const seats = width > height || (width === height && vertical)
          ? [[sx, y - 1, 2], [sx, y + height, 0]]
          : [[x - 1, sy, 3], [x + width, sy, 1]];
        const chairs = seats.filter(([cx, cy]) => free(cx, cy)).slice(0, item.chairs?.length ?? 0);
        const distance = Math.abs(sx - spots[0][0]) + Math.abs(sy - spots[0][1]);
        return [{ x, y, face, cells, chairs, distance }];
      });
      const spot = options.sort((a, b) => b.chairs.length - a.chairs.length || a.distance - b.distance)[0];
      if (!spot) { skipped.push({ id: item.id, role: "centre" }); continue; }
      for (const [cx, cy] of spot.cells) taken.add(key(cx, cy));
      placed.push({ id: item.id, x: spot.x, y: spot.y, face: spot.face, role: "centre" });
      for (const [index, [x, y, face]] of spot.chairs.entries()) {
        taken.add(key(x, y));
        placed.push({ id: item.chairs[index], x, y, face, role: "chair" });
      }
    }
  }
  return { placed, skipped };
}

function unique(tiles) {
  const seen = new Set();
  const out = [];
  for (const tile of tiles) {
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tile);
  }
  return out;
}

module.exports = {
  line, ring, box, tower, repeated, avenue, rotate, facingFor, unique, footprint, rotateLoc, rotateOffset, wallPath, hipRoof, levelPlan, furnishPlan,
};
