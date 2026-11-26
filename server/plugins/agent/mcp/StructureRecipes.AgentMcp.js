const geometry = require("./EditGeometry.AgentMcp");
const sets = require("../data/edit-structure-sets.json");

const ENTRANCES = ["south", "west", "north", "east"];
const MAX_SEED = 2147483647;

const rooms = (name, label, about, defaultStyle, interior, exterior, minSize = 6) => ({
  name, label, about, defaultStyle, interior, exterior, styleRole: "building",
  minSize, maxSize: 20, defaultWidth: Math.max(minSize, 9), defaultHeight: Math.max(minSize, 8),
  seeded: true, storeys: true, entrance: true, foundation: true,
});

const RECIPES = [
  { ...rooms("furnished-house", "Furnished house", "A house with a kitchen, seating and sleeping space.", "varrock-house", "cottage", "garden", 4),
    defaultWidth: 7, defaultHeight: 8 },
  rooms("tavern", "Tavern", "An inn with a bar, tables and optional guest rooms upstairs.", "lumbridge-cottage", "tavern", "frontage"),
  rooms("shop", "Shop", "A small shop with shelving, a counter and storage.", "falador-house", "merchant", "frontage"),
  rooms("smithy", "Smithy", "A forge with a furnace, bench, anvil and storage.", "seers-timber", "smithy", "yard", 8),
  rooms("bank", "Bank", "A bank hall with booths and a waiting area.", "falador-house", "bank", "frontage", 8),
  rooms("chapel", "Chapel", "A chapel with an altar, pews and standing torches.", "draynor-cottage", "chapel", "garden", 8),
  ...[
    ["warriors-guild", "Warriors’ Guild", "A training hall and an annex across a shared courtyard.", "warriors-stone", "combat", "frontage"],
    ["crafting-guild", "Crafting Guild", "A workshop hall, supply rooms and a work yard.", "crafting-stone", "crafting", "yard"],
    ["cooks-guild", "Cooks’ Guild", "A kitchen hall with an annex and a courtyard.", "cooks-stone", "cookery", "garden"],
  ].map(([name, label, about, style, interior, exterior]) => ({
    ...rooms(name, label, about, style, interior, exterior), layout: "guild",
    minSize: 18, maxSize: 34, defaultWidth: 24, defaultHeight: 22,
  })),
  ...[
    ["settlement", "Town", "A seeded street plan with shops, houses and a public square.", "varrock-house", "frontage"],
    ["market-town", "Market town", "A wide market square with shops and houses around it.", "varrock-house", "frontage", 2],
    ["crossroads-village", "Crossroads village", "Timber buildings around a pair of through streets.", "seers-timber", "garden", 1],
    ["swamp-hamlet", "Swamp hamlet", "An overgrown lane with steep roofs and a tavern.", "canifis-timber", "overgrown", 0],
    ["desert-town", "Desert town", "Sandstone buildings and courtyards around a market square.", "al-kharid-sandstone", "yard", 2],
  ].map(([name, label, about, defaultStyle, exterior, townLayout]) => ({
    name, label, about, styleRole: "building", defaultStyle, minSize: 26, maxSize: 48,
    defaultWidth: 38, defaultHeight: 32, seeded: true, entrance: true, exterior, foundation: true,
    layout: "settlement", townLayout,
  })),
  { name: "ruins", label: "Ruins", about: "Broken walls, exposed patches of floor and scattered remains.",
    styleRole: "ruins", defaultStyle: "edgeville-ruins", minSize: 7, maxSize: 34,
    defaultWidth: 15, defaultHeight: 13, seeded: true, entrance: true, exterior: "overgrown", layout: "ruins" },
  ...[
    ["farm", "Farm", "A fenced field with rows of crops.", 5, 9],
    ["graveyard", "Graveyard", "An enclosure with a path, grave markers and dead trees.", 6, 9],
  ].map(([name, label, about, minSize, defaultWidth]) => ({
    name, label, about, minSize, defaultWidth, defaultHeight: 8, maxSize: 40, defaultStyle: "lumbridge-fence",
    styleRole: "wall", entrance: true, crop: name === "farm",
  })),
];
const BY_NAME = new Map(RECIPES.map((recipe) => [recipe.name, recipe]));
const choices = (entries, empty) => [
  { name: "auto", label: "Automatic" }, { name: empty, label: empty === "bare" ? "Bare" : "Empty" },
  ...Object.entries(entries).map(([name, { label }]) => ({ name, label })),
];
const INTERIORS = choices(sets.interiors, "empty");
const EXTERIORS = choices(sets.exteriors, "bare");

function rng(seed) {
  let value = seed | 0;
  return (count) => {
    value = (value + 0x6D2B79F5) | 0;
    let mixed = Math.imul(value ^ value >>> 15, value | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) % count;
  };
}

function styleRoles(style) {
  return ["wall", ...(style.roof ? ["building"] : []), ...(!style.roof && !style.gate ? ["ruins"] : [])];
}

function choose(name, entries, fallback) {
  if (!name || name === "auto") return fallback;
  if (!entries.some((entry) => entry.name === name)) throw new Error(`Unknown ${entries === INTERIORS ? "interior" : "exterior"} "${name}"`);
  return name;
}

function size(core, id) {
  const definition = core.ObjectDefinition.forId(id);
  return [definition?.getSizeX?.() ?? 1, definition?.getSizeY?.() ?? 1];
}

// Range and shelf models have different default facings from chairs and beds.
const FACE_OFFSETS = new Map([[7183, 2], [1016, 1], [1017, 1], [1018, 1], [835, 1]]);

function interiorItems(interior, level, storeys, random, facing, chair, rear, split) {
  const set = sets.interiors[interior];
  if (!set) return [];
  const turn = ENTRANCES.indexOf(facing);
  const walls = { left: ENTRANCES[(turn + 1) % 4], rear: ENTRANCES[(turn + 2) % 4], right: ENTRANCES[(turn + 3) % 4] };
  const groups = rear ? set.rear : level ? set.upper : [...set.ground, ...(!split && storeys === 1 ? set.single ?? [] : [])];
  if (!groups) return [];
  return groups.map(([place, ...ids]) => {
    const id = ids[random(ids.length)];
    if (place === "table") return { id, place: "centre", chairs: [chair, chair] };
    const pew = place.endsWith("-pew");
    const wall = place === "focal" ? walls.rear : walls[pew ? place.slice(0, -4) : place];
    return { id, place: wall && place !== "focal" ? "wall" : place, wall,
      face: pew ? (turn + 2) & 3 : undefined, faceOffset: FACE_OFFSETS.get(id) };
  });
}

const paint = (x, y, locId) => ({ kind: "terrain", tileX: x, tileY: y, plane: 0, locId, shape: 0, rotation: 0 });

/** Reserve the rotated footprint when setting scenery beside paths or walls. */
function scenery(core, placements, candidates, ids, random, allowed, count) {
  const occupied = new Set(placements.filter((loc) => loc.type === 10 && loc.z === 0).flatMap((loc) => {
    const { width, height } = geometry.footprint(10, loc.face, ...size(core, loc.id));
    const tiles = [];
    for (let dx = 0; dx < width; dx++) for (let dy = 0; dy < height; dy++) tiles.push(`${loc.x + dx},${loc.y + dy}`);
    return tiles;
  }));
  const spots = candidates.slice();
  while (spots.length > 0 && count > 0) {
    const [[x, y]] = spots.splice(random(spots.length), 1);
    const id = ids[random(ids.length)];
    const face = random(4);
    const dims = geometry.footprint(10, face, ...size(core, id));
    const tiles = [];
    for (let dx = 0; dx < dims.width; dx++) for (let dy = 0; dy < dims.height; dy++) tiles.push([x + dx, y + dy]);
    if (!tiles.every(([tx, ty]) => allowed(tx, ty) && !occupied.has(`${tx},${ty}`))) continue;
    for (const [tx, ty] of tiles) occupied.add(`${tx},${ty}`);
    placements.push({ id, x, y, z: 0, type: 10, face });
    count--;
  }
}

function createStructurePlanner(core, plans, { styleNamed, planWall }, terrain) {
  return function planStructure(input) {
    const recipe = BY_NAME.get(input.name);
    if (!recipe) throw new Error(`Unknown structure "${input.name}"`);
    const { x, y } = input;
    const width = input.width ?? recipe.defaultWidth;
    const height = input.height ?? recipe.defaultHeight;
    const door = input.entrance ?? "south";
    const styleName = input.style || recipe.defaultStyle;
    const style = styleNamed(styleName);
    const seed = input.seed ?? 1;
    const storeys = input.storeys ?? 1;
    if (![x, y].every((value) => Number.isInteger(value) && value >= 1 && value + 64 <= 16383)) throw new Error("Footprint is outside the world");
    for (const [name, value] of [["width", width], ["height", height]]) {
      if (!Number.isInteger(value) || value < recipe.minSize || value > recipe.maxSize) {
        throw new Error(`${name} must be between ${recipe.minSize} and ${recipe.maxSize}`);
      }
    }
    if (!ENTRANCES.includes(door)) throw new Error("Choose an entrance side");
    if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error(`seed must be between 0 and ${MAX_SEED}`);
    if (!Number.isInteger(storeys) || storeys < 1 || storeys > 2) throw new Error("storeys must be 1 or 2");
    if (!styleRoles(style).includes(recipe.styleRole)) throw new Error(`Choose a ${recipe.styleRole} style`);
    if (recipe.name === "farm" || recipe.name === "graveyard") return plans[recipe.name]({
      x, y, width, height, style: styleName, gate: door, crop: input.crop, flatten: input.flatten ?? false,
    });
    const interior = choose(input.interior, INTERIORS, recipe.interior);
    const exterior = choose(input.exterior, EXTERIORS, recipe.exterior);
    const turns = ENTRANCES.indexOf(door);
    const [w, h] = turns % 2 === 0 ? [width, height] : [height, width];
    const random = rng(seed);
    const placements = [];
    const edits = [];
    let buildings = 0;
    let rooms = 0;
    const path = style.path ?? 10;
    let layout = recipe.layout;
    const room = (rx, ry, rw, rh, facing, purpose, floors = storeys, service = false) => {
      const roomRandom = rng(random(MAX_SEED));
      const depth = facing === "south" || facing === "north" ? rh : rw;
      const rearDepth = !service && sets.interiors[purpose]?.rear && depth >= 10 ? 3 + roomRandom(Math.min(3, depth - 9)) : 0;
      const chair = sets.chairs[roomRandom(sets.chairs.length)];
      const result = plans.house({
        style: styleName, x: rx, y: ry, width: rw, height: rh, storeys: floors, door: facing,
        flatten: false, floor: style.floor ?? undefined, seed: roomRandom(MAX_SEED),
        windowEvery: 3, rearDepth,
        furnishing: (level, rear) => interiorItems(purpose, level, floors, roomRandom, facing, chair, service || rear, rearDepth > 0),
      });
      placements.push(...result.placements);
      edits.push(...result.edits);
      buildings++;
      rooms += rearDepth ? 2 : 1;
    };
    const tiles = (x0, y0, x1, y1, callback) => {
      for (let tx = x0; tx < x1; tx++) for (let ty = y0; ty < y1; ty++) callback(tx, ty);
    };
    const paving = (x0, y0, x1, y1) => tiles(x0, y0, x1, y1, (tx, ty) => edits.push(paint(tx, ty, path)));
    const decorate = (theme, x0, y0, x1, y1, allowed, count) => {
      const set = sets.exteriors[theme];
      if (!set) return;
      const candidates = [];
      tiles(x0, y0, x1, y1, (tx, ty) => { if (allowed(tx, ty)) candidates.push([tx, ty]); });
      scenery(core, placements, candidates, set.locs, random, allowed, count);
    };
    const midpoint = Math.floor(w / 2);
    if (layout === "guild") {
      const arrangement = random(3);
      const court = 4 + random(Math.min(6, h - 13));
      const walk = 3 + random(2);
      const annexWidth = 5 + random(Math.min(5, w - walk - 12));
      const hallWidth = w - annexWidth - walk - 2;
      const annexLeft = random(2) === 0;
      const hallX = annexLeft ? annexWidth + walk + 1 : 1;
      const annexX = annexLeft ? 1 : hallWidth + walk + 1;
      const walkX = 1 + (annexLeft ? annexWidth : hallWidth);
      const hallY = arrangement === 1 ? 2 : court;
      const annexY = arrangement === 0 ? 2 : court;
      const hallFacing = arrangement === 1 ? (annexLeft ? "west" : "east") : "south";
      const annexFacing = arrangement === 2 ? "south" : (annexLeft ? "east" : "west");
      const annexDepth = h - annexY - 1 - random(3);
      room(hallX, hallY, hallWidth, h - hallY - 1, hallFacing, interior);
      room(annexX, annexY, annexWidth, annexDepth, annexFacing, interior, 1, true);
      paving(walkX, 0, walkX + walk, h - 1);
      paving(hallX, 1, hallX + hallWidth, hallY);
      paving(annexX, 1, annexX + annexWidth, annexY);
      const hallEntrance = hallX + Math.floor(hallWidth / 2);
      const annexEntrance = annexX + Math.floor(annexWidth / 2);
      const courtTiles = (tx, ty) => ty >= 1 && ((tx >= hallX && tx < hallX + hallWidth && ty < hallY && Math.abs(tx - hallEntrance) > 1) ||
        (tx >= annexX && tx < annexX + annexWidth && ty < annexY && Math.abs(tx - annexEntrance) > 1));
      decorate(exterior, 1, 1, w - 1, court, courtTiles, 4 + random(3));
      layout = ["front courtyard", "side courtyard", "twin wings"][arrangement];
    } else if (layout === "settlement") {
      // Building lots face a through street. A cross street or market square changes the block arrangement.
      const crossing = recipe.townLayout ?? random(3);
      layout = ["lane", "crossroads", "market square"][crossing];
      const street = Math.max(7, midpoint - 1 + random(3));
      const travelWidth = crossing === 2 ? 6 : 3;
      const split = Math.floor(h / 2);
      paving(street, 0, street + travelWidth, h);
      if (crossing === 1) paving(0, split - 1, w, split + 2);
      if (crossing === 2) paving(street - 2, split - 3, street + travelWidth + 2, split + 4);
      const square = [];
      const squareX = crossing === 2 ? street + 2 : street;
      tiles(squareX, split, squareX + (crossing === 2 ? 2 : 1), split + 2, (tx, ty) => square.push([tx, ty]));
      scenery(core, placements, square, sets.square, random,
        (tx, ty) => tx >= squareX && tx < squareX + (crossing === 2 ? 3 : 1) && ty >= split && ty < split + 3, 1);
      const plots = crossing === 0 ? [[1, split], [split + 1, h - 1]]
        : [[1, split - 3], [split + 4, h - 1]];
      const east = street + travelWidth;
      const purposes = ["merchant", "tavern", "smithy", "cottage", "bank", "chapel", "crafting"];
      for (let side = 0; side < 2; side++) {
        const from = side === 0 ? 1 : east + 1;
        const to = side === 0 ? street - 1 : w - 1;
        const facing = side === 0 ? "east" : "west";
        for (const [fromY, toY] of plots) {
          const span = toY - fromY;
          const rows = span >= 14 ? 2 : 1;
          for (let row = 0; row < rows; row++) {
            const rowStart = fromY + Math.floor(span * row / rows);
            const rowEnd = fromY + Math.floor(span * (row + 1) / rows);
            const rw = Math.min(20, Math.max(5, to - from - random(3)));
            const rh = Math.min(20, rowEnd - rowStart - 1 - (rowEnd - rowStart >= 8 ? random(2) : 0));
            const rx = side === 0 ? to - rw : from;
            room(rx, rowStart, rw, rh, facing, purposes.length ? purposes.splice(random(purposes.length), 1)[0] : "cottage", 1 + random(2));
            const approachY = rowStart + Math.floor(rh / 2);
            paving(side === 0 ? to : east, approachY, side === 0 ? street : from, approachY + 1);
            decorate(exterior, side === 0 ? rx - 1 : rx + rw, rowStart,
              side === 0 ? rx : Math.min(w, rx + rw + 1), rowStart + rh,
              (tx, ty) => tx > 0 && tx < w - 1 && (side === 0 ? tx === rx - 1 : tx === rx + rw) &&
                ty > rowStart && ty < rowStart + rh - 1, 1);
            decorate(exterior, side === 0 ? to : east, rowStart, side === 0 ? street : from, rowStart + rh,
              (tx, ty) => tx === (side === 0 ? to : east) && ty >= rowStart && ty < rowStart + rh && Math.abs(ty - approachY) > 1, 1);
          }
        }
      }
    } else if (layout === "ruins") {
      const x0 = 1, y0 = 1, x1 = w - 1, y1 = h - 1;
      const perimeter = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const ruin = planWall({ ...style, door: null, gate: null }, perimeter, { closed: true, seed }).placements;
      const gaps = [random(w - 4) + 2, random(h - 4) + 2, random(w - 4) + 2, random(h - 4) + 2];
      placements.push(...ruin.filter(({ x: tx, y: ty, type }) => {
        if (type === 1) return random(2) === 0;
        if (ty === 0 && Math.abs(tx - midpoint) <= 1) return false;
        const horizontal = ty === 0 || ty === h - 1;
        const gap = gaps[horizontal ? Number(ty !== 0) * 2 : 1 + Number(tx === 0) * 2];
        return Math.abs((horizontal ? tx : ty) - gap) > 1;
      }));
      const broken = 1 + random(3);
      tiles(x0, y0, x1, y1, (tx, ty) => {
        if ((tx + 2 * ty + broken) % 7 < 4 && random(4) !== 0) edits.push(paint(tx, ty, style.floor ?? 14));
      });
      if (exterior !== "bare") {
        const eligible = (tx, ty) => tx > 1 && tx < x1 - 1 && ty > 1 && ty < y1 - 1 && tx !== midpoint;
        const candidates = [];
        tiles(x0, y0, x1, y1, (tx, ty) => { if (eligible(tx, ty)) candidates.push([tx, ty]); });
        scenery(core, placements, candidates, exterior === "overgrown" ? sets.ruins : sets.exteriors[exterior].locs,
          random, eligible, Math.min(15, Math.floor(w * h / 15)));
      }
    } else {
      const minRoomSize = Math.max(6, recipe.minSize);
      const sideYard = random(Math.min(2, Math.max(0, w - minRoomSize)) + 1);
      const roomX = random(2) ? sideYard : 0;
      const roomWidth = w - sideYard;
      const porch = exterior !== "bare" && h > minRoomSize + 1 ? 1 + random(Math.min(3, h - minRoomSize)) : 0;
      const setback = h - porch > minRoomSize + 1 ? random(2) : 0;
      const roomHeight = h - porch - setback;
      room(roomX, porch, roomWidth, roomHeight, "south", interior);
      const access = roomX + Math.floor(roomWidth / 2);
      if (porch) paving(access, 0, access + 1, porch + 1);
      decorate(exterior, 0, 0, w, h, (tx, ty) => tx >= 0 && tx < w && ty >= 0 && ty < h &&
        (tx < roomX || tx >= roomX + roomWidth || ty < porch || ty >= porch + roomHeight) &&
        (ty >= porch || Math.abs(tx - access) > 1), 2 + Math.floor(w / 7));
    }

    const level = terrain && (input.flatten ?? recipe.foundation) ? terrain.levelEdits(x, y, x + width - 1, y + height - 1, { blend: 2 }) : null;
    const bounds = { x1: x, y1: y, x2: x + width - 1, y2: y + height - 1 };
    const oriented = ({ x: lx, y: ly, ...loc }) => {
      const { dx, dy, ...rest } = geometry.rotateLoc({ ...loc, dx: lx, dy: ly }, turns, w, h, ...size(core, loc.id));
      return { ...rest, x: x + dx, y: y + dy };
    };
    const terrainEdits = edits.map((edit) => {
      // Height edits are on grid corners, including the far edge. Tile paint and flags rotate around tile centres.
      const span = Number(edit.kind === "height");
      const { dx, dy } = geometry.rotateOffset(edit.tileX, edit.tileY, turns, w + span, h + span);
      return { ...edit, tileX: x + dx, tileY: y + dy, rotation: edit.kind === "terrain" ? ((edit.rotation ?? 0) + turns) & 3 : 0 };
    });
    return {
      placements: placements.map(oriented), edits: [...(level?.edits ?? []), ...terrainEdits],
      summary: { label: recipe.label, style: styleName, seed, bounds, interior, exterior, layout, buildings, rooms,
        ...(level ? { flatten: { level: level.level, tilesChanged: level.moved, spread: level.spread } } : {}) },
      foundation: Boolean(recipe.foundation),
    };
  };
}

module.exports = { createStructurePlanner, RECIPES, INTERIORS, EXTERIORS, ENTRANCES, MAX_SEED, styleRoles, rng };
