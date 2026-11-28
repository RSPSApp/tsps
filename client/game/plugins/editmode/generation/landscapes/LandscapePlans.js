const { landscapeFootprint } = require("./LandscapeFootprint");
const { nativeTerrainHeight } = require("./TerrainHeight");
const { deflate } = require("pako");

const bytes = (values) => Uint8Array.from(values);
const concat = (parts) => { const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; };
function base64(data) { let text = ""; for (let i = 0; i < data.length; i += 8192) text += String.fromCharCode(...data.subarray(i, i + 8192)); return btoa(text); }

const REGION_SIZE = 64;
const MAX_WIDTH = 512;
const MAX_HEIGHT = 512;
const MAP_WIDTH = 256 * REGION_SIZE;
const MAP_HEIGHT = 256 * REGION_SIZE;
const CAVE_ROW = 100;
// Raw overlay values from the live cache terrain archives, including the +1 used on disk.
const WATER = 6;
const SWAMP_SHALLOWS = 7;
const KARAMJA_COAST = 442;
const KARAMJA_WATER = [445, 448, 451];
const SWAMP_REEDS = [3501, 3502, 3503, 3504, 3505, 3547, 3548, 3549, 1272, 1273];
const SWAMP_BUBBLES = [684, 735];
// Both palms were checked in the native object preview and retain their crown.
const TROPICAL_PALMS = [1311, 1312];
const JUNGLE_FLOOR = [1222, 1223, 1224, 1225, 1226, 1228, 1229, 1241, 1242, 1243, 4735, 4736, 4814];

const landforms = {
  hills: { label: "Rolling hills", about: "Gentle ridges and open building sites." },
  basin: { label: "Mountain basin", about: "A broad valley surrounded by ridges, with a pass to the south." },
  island: { label: "Volcanic island", about: "An irregular coast, beaches and a ridge through the interior." },
  river: { label: "River valley", about: "A meandering river between terraces and hills." },
  wetlands: { label: "Wetlands", about: "Shallow pools, low hummocks and winding stretches of dry ground." },
  cavern: { label: "Cave or basement", about: "A level floor enclosed by raised, blocked rock." },
};

const biomes = {
  forest: {
    label: "Temperate forest", reference: "Draynor woods", sample: [49, 50],
    fallback: 48, colors: ["#647a38", "#838761", "#ab9a6d"],
    scenery: /\b(tree|oak|willow|bush|fern|mushrooms?|flowers?)\b/i,
    density: 0.14,
  },
  desert: {
    label: "Desert", reference: "Kharidian Desert", sample: [53, 46],
    fallback: 48, colors: ["#d5af76", "#ae7d55", "#e6cc99"],
    scenery: /\b(cactus|cacti|sand|rocks?|boulder|palm|scrub)\b/i,
    density: 0.045,
  },
  swamp: {
    label: "Swamp", reference: "Mort Myre", sample: [53, 53],
    fallback: 54, colors: ["#225e45", "#35825b", "#657143"],
    waterColors: ["#193f37", "#477368"],
    scenery: /\b(swamp|dead tree|rotting|reeds?|fungus|rushes|mushrooms?|bush)\b/i,
    density: 0.17,
  },
  tropical: {
    label: "Tropical", reference: "Karamja", sample: [44, 47],
    fallback: 50, colors: ["#507738", "#6a5333", "#bba161"],
    waterColors: ["#344762", "#536b80"],
    scenery: /\b(jungle|palm|teak|mahogany|banana|fern|vines?|tropical|tree|bush)\b/i,
    density: 0.17,
  },
  alpine: {
    label: "Alpine", reference: "White Wolf Mountain", sample: [44, 54],
    fallback: 48, colors: ["#a0aaa4", "#b2b8b4", "#d7d8ca"],
    scenery: /\b(pine|evergreen|fir|rocks?|boulder|snow|tree)\b/i,
    density: 0.055,
  },
};
const sizes = {
  tiny: { label: "Tiny", width: 12, height: 10 },
  small: { label: "Small", width: 32, height: 32 },
  region: { label: "Map square", width: 64, height: 64 },
  large: { label: "Large", width: 192, height: 192 },
  massive: { label: "Massive", width: 512, height: 512 },
};

const regionId = (x, y) => ((x >> 6) << 8) | (y >> 6);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (left, right, fraction) => left + (right - left) * fraction;
function smooth(lo, hi, value) {
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}
function random(seed, x, y) {
  let n = seed ^ Math.imul(x + 17, 0x9e3779b1) ^ Math.imul(y + 53, 0x85ebca77);
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise(seed, x, y, scale) {
  const u = x / scale, v = y / scale;
  const i = Math.floor(u), j = Math.floor(v);
  const sx = smooth(0, 1, u - i), sy = smooth(0, 1, v - j);
  return lerp(lerp(random(seed, i, j), random(seed, i + 1, j), sx),
    lerp(random(seed, i, j + 1), random(seed, i + 1, j + 1), sx), sy);
}

function catalog() {
  return {
    landforms: Object.entries(landforms).map(([id, value]) => ({ id, ...value })),
    biomes: Object.entries(biomes).map(([id, { label, reference }]) => ({ id, label, reference })),
    sizes: Object.entries(sizes).map(([id, value]) => ({ id, ...value })),
    maxWidth: MAX_WIDTH,
    maxHeight: MAX_HEIGHT,
  };
}

function normalize(input) {
  const { landform = "hills", biome = "forest", size = "region" } = input;
  if (!Object.hasOwn(landforms, landform)) throw new Error("Choose a supported landform");
  if (!Object.hasOwn(biomes, biome)) throw new Error("Choose a supported biome");
  if (!Object.hasOwn(sizes, size)) throw new Error("Choose a supported size");
  const { seed = 1, relief = 100, foliage = 100, lakes = 0, scenery = true, edgeBlend = 28, extend = false, squares } = input;
  const preset = sizes[size];
  let { x, y, width, height } = input;
  if (Array.isArray(squares) && squares.length > 0 && squares.length <= 64) {
    const columns = squares.map((id) => id >> 8);
    const rows = squares.map((id) => id & 255);
    x ??= Math.min(...columns) * REGION_SIZE;
    y ??= Math.min(...rows) * REGION_SIZE;
    width ??= (Math.max(...columns) + 1) * REGION_SIZE - x;
    height ??= (Math.max(...rows) + 1) * REGION_SIZE - y;
  }
  width ??= preset.width;
  height ??= preset.height;
  for (const [label, value, min, max] of [
    ["Width", width, 6, MAX_WIDTH], ["Depth", height, 6, MAX_HEIGHT], ["Seed", seed, 0, 0xffffffff], ["Relief", relief, 0, 200], ["Foliage", foliage, 0, 200], ["Lakes", lakes, 0, 12], ["Edge blend", edgeBlend, 4, 48],
  ]) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be a whole number from ${min} to ${max}`);
  }
  if (![x, y].every(Number.isInteger) || x < 0 || y < 0 || x + width > MAP_WIDTH || y + height > MAP_HEIGHT) {
    throw new Error("Choose a south-west tile where the whole landscape fits inside the map");
  }
  if (squares !== undefined) {
    const valid = Array.isArray(squares) && squares.length > 0 && squares.length <= 64 &&
      [x, y, width, height].every((value) => value % REGION_SIZE === 0);
    if (!valid || new Set(squares).size !== squares.length) throw new Error("Choose distinct map squares on the world grid");
    const remaining = new Set(squares);
    for (const id of squares) {
      const sx = (id >> 8) * REGION_SIZE, sy = (id & 255) * REGION_SIZE;
      if (!Number.isInteger(id) || id < 0 || id > 0xffff || sx < x || sy < y || sx >= x + width || sy >= y + height || (sy >= 6400) !== (y >= 6400)) {
        throw new Error("Each map square must fit the footprint on one map layer");
      }
    }
    const queue = [squares[0]];
    remaining.delete(squares[0]);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const next of [id - 256, id + 256, id - 1, id + 1]) if (remaining.delete(next)) queue.push(next);
    }
    if (remaining.size) throw new Error("Connect the map squares along their edges");
  }
  return { x, y, width, height, seed, relief, foliage, lakes, landform, biome, scenery, squares, extend, edgeBlend };
}

function readMaterials(data, wide) {
  const counts = new Map();
  let offset = 0;
  const read = () => wide ? (data[offset++] << 8) | data[offset++] : data[offset++];
  for (let tile = 0; tile < REGION_SIZE ** 2 && offset < data.length; tile++) {
    let underlay = 0;
    let overlay = 0;
    while (offset < data.length) {
      const opcode = read();
      if (opcode <= 1) { offset += opcode; break; }
      if (opcode <= 49) overlay = read();
      else if (opcode > 81) underlay = opcode - 81;
    }
    if (underlay && overlay !== 6 && overlay !== 7 && !(overlay >= 442 && overlay <= 625)) {
      counts.set(underlay, (counts.get(underlay) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
}

function sceneryHabitat(id, name, biome) {
  if (/\bbubbles?\b/i.test(name)) return biome === biomes.swamp ? "water" : undefined;
  if (biome === biomes.swamp && SWAMP_REEDS.includes(id)) return "bank";
  if (biome === biomes.tropical && JUNGLE_FLOOR.includes(id)) return "floor";
  if (biome === biomes.tropical && TROPICAL_PALMS.includes(id)) return "canopy";
  return biome.scenery.test(name) ? "land" : undefined;
}

function readScenery(data, core, biome, inStrip = () => true, natural = false) {
  const counts = new Map();
  let offset = 0;
  const smart = () => data[offset] < 128 ? data[offset++] : ((data[offset++] << 8) | data[offset++]) - 32768;
  let id = -1;
  while (offset < data.length) {
    let delta = 0;
    let part;
    do { part = smart(); delta += part; } while (part === 32767);
    if (!delta) break;
    id += delta;
    let packed = 0;
    while (offset < data.length) {
      const step = smart();
      if (!step) break;
      packed += step - 1;
      const shape = data[offset++] >> 2;
      if (packed >> 12 || (shape !== 10 && shape !== 22) || !inStrip(packed >> 6 & 63, packed & 63)) continue;
      const existing = counts.get(id);
      if (existing) {
        existing.count++;
        continue;
      }
      const loc = core.CacheDefinitions.getObject(id);
      if (!loc?.models?.length || loc.actions?.some((action) => action && !/^chop down$/i.test(action))) continue;
      const name = loc.name ?? "";
      const habitat = sceneryHabitat(id, name, biome) ?? (natural && /\b(tree|palm|teak|mahogany|cactus|cacti|pine|willow|oak|mangrove|fern|undergrowth|bush|reeds?|rushes|rock|boulder|mushrooms?|flowers?)\b/i.test(name) ? "land" : undefined);
      const width = loc.sizeX || 1, height = loc.sizeY || 1;
      if (!habitat || width > 4 || height > 4) continue;
      counts.set(id, { id, name: loc.name === "null" ? (habitat === "bank" ? "Swamp reeds" : "Jungle undergrowth") : loc.name,
        shape, width, height, habitat, count: 1 });
    }
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count || a.id - b.id);
  return ["land", "bank", "water", "canopy", "floor"].flatMap((habitat) => [10, 22].flatMap((shape) =>
    ranked.filter((item) => item.shape === shape && item.habitat === habitat).slice(0, 8)));
}

const palettes = new WeakMap();
function sampleBiome(core, id) {
  if (!Object.hasOwn(biomes, id)) throw new Error("Choose a supported biome");
  let cache = palettes.get(core.CacheMaps);
  if (!cache) palettes.set(core.CacheMaps, cache = new Map());
  const fallback = cache.get(id) ?? sampleReferenceBiome(core, id);
  cache.set(id, fallback);
  const captured = core.loadTerrainBiome?.(id);
  if (!captured) return fallback;
  const biome = biomes[id];
  const scenery = new Map(fallback.scenery.map((loc) => [loc.id, loc]));
  for (const [ids, profiles, shape] of [
    [captured.treeIds, captured.treeProfileById, 10],
    [captured.groundDecorationIds, captured.groundDecorationProfileById, 22],
  ]) {
    for (const id of ids) {
      const loc = core.CacheDefinitions?.getObject(id);
      const placement = profiles[id];
      if (!loc?.models?.length || placement.type !== shape || (loc.types && !loc.types.includes(shape)) ||
          loc.actions?.some((action) => action && !/^chop down$/i.test(action))) continue;
      const width = loc.sizeX || 1, height = loc.sizeY || 1;
      if (width > 4 || height > 4 || /\bbubbles?\b/i.test(loc.name ?? "") && biome !== biomes.swamp) continue;
      scenery.set(id, { id, name: loc.name && loc.name !== "null" ? loc.name : (shape === 22 ? "Ground cover" : "Tree"),
        shape, width, height, habitat: sceneryHabitat(id, loc.name ?? "", biome) ?? "land" });
    }
  }
  return { materials: [...new Set([...captured.underlayIds, ...fallback.materials])], scenery: [...scenery.values()] };
}

function referenceRegionIds(id) {
  const [x, y] = biomes[id].sample;
  const samples = [[x, y], [x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]];
  if (id === "tropical") samples.push([45, 48], [45, 49], [46, 49], [46, 48]);
  return samples.map(([rx, ry]) => (rx << 8) | ry);
}

function sampleReferenceBiome(core, id) {
  const biome = biomes[id];
  const colours = [];
  const scenery = new Map();
  const wide = (core.CachePipeline.getActive()?.revision ?? 0) >= 209;
  for (const sample of referenceRegionIds(id)) {
    const rx = sample >> 8, ry = sample & 255;
    const region = core.CacheMaps.getRegion((rx << 8) | ry);
    if (!region) continue;
    if (!colours.length && region.terrainData) colours.push(...readMaterials(region.terrainData, wide));
    if (region.objectData && core.CacheDefinitions) {
      for (const loc of readScenery(region.objectData, core, biome)) {
        if (!scenery.has(loc.id)) scenery.set(loc.id, loc);
      }
    }
    if (id !== "swamp" && id !== "tropical" && colours.length && scenery.size >= 12) break;
  }
  if (id === "swamp" || id === "tropical") {
    const extraIds = id === "swamp" ? [...SWAMP_REEDS, ...SWAMP_BUBBLES] : [...JUNGLE_FLOOR, ...TROPICAL_PALMS];
    for (const id of extraIds) {
      const loc = core.CacheDefinitions?.getObject(id);
      const shape = loc?.types?.find((type) => type === 10 || type === 22) ?? (loc?.types ? undefined : 10);
      if (scenery.has(id) || !loc?.models?.length || shape === undefined) continue;
      const habitat = sceneryHabitat(id, loc.name ?? "", biome);
      scenery.set(id, { id, name: loc.name === "null" ? (habitat === "bank" ? "Swamp reeds" : "Jungle undergrowth") : loc.name,
        shape, width: loc.sizeX || 1, height: loc.sizeY || 1, habitat });
    }
  }
  return { materials: colours.length ? colours : [biome.fallback], scenery: [...scenery.values()] };
}

// Native overlay shapes fitted to the wet corners, ordered SW, SE, NE, NW.
const SHORE_SHAPES = [
  [0, 0], [7, 0], [7, 3], [6, 3], [7, 2], [7, 0], [6, 2], [8, 1],
  [7, 1], [6, 0], [7, 3], [8, 2], [6, 1], [8, 3], [8, 0], [0, 0],
];
const TILE_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** Each pocket has its own level and material. Its outer boundary uses the shore shape. */
function swampPockets(seed) {
  const span = 13;
  const pockets = new Map();
  const at = (x, y) => {
    const key = x * 2048 + y;
    const previous = pockets.get(key);
    if (previous) return previous;
    const angle = random(seed + 117, x, y) * Math.PI;
    const pond = {
      x: (x + 0.25 + random(seed + 111, x, y) * 0.5) * span,
      y: (y + 0.25 + random(seed + 113, x, y) * 0.5) * span,
      radiusX: 2.8 + random(seed + 119, x, y) * 3.1,
      radiusY: 1.9 + random(seed + 121, x, y) * 2.6,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      level: random(seed + 123, x, y) < 0.32 ? 0 : 10,
    };
    pockets.set(key, pond);
    return pond;
  };
  return (x, y) => {
    const cellX = Math.floor(x / span), cellY = Math.floor(y / span);
    const ripple = (noise(seed + 613, x, y, 3.5) - 0.5) * 0.33;
    let distance = Infinity, level = 10;
    for (let ix = cellX - 1; ix <= cellX + 1; ix++) for (let iy = cellY - 1; iy <= cellY + 1; iy++) {
      const pond = at(ix, iy);
      const dx = x - pond.x, dy = y - pond.y;
      const a = (dx * pond.cos + dy * pond.sin) / pond.radiusX;
      const b = (dy * pond.cos - dx * pond.sin) / pond.radiusY;
      const remaining = (Math.hypot(a, b) + ripple - 1) * Math.min(pond.radiusX, pond.radiusY);
      if (remaining < distance) { distance = remaining; level = pond.level; }
    }
    return { distance, level };
  };
}

function makeSurface(plan, footprint) {
  const { width, height, seed, landform, biome, relief } = plan;
  const size = Math.max(8, Math.min(width, height));
  const inland = landform === "island" || landform === "river" || landform === "wetlands";
  const swamp = landform === "wetlands" && biome === "swamp";
  const ocean = landform === "island" && biome === "tropical";
  const waterLevel = swamp ? 10 : ocean ? 0 : 30;
  const swampPocket = swamp ? swampPockets(seed) : undefined;
  const scale = (biome === "swamp" ? 0.73 : biome === "desert" ? 0.85 : 1) * relief / 100;

  const lakes = [];
  if (landform !== "cavern") {
    for (let attempt = 0; attempt < plan.lakes * 8 && lakes.length < plan.lakes; attempt++) {
      const radius = Math.max(2, Math.min(24, size * (0.036 + 0.055 * random(seed + 971, attempt, 3))));
      const margin = radius * 2.2;
      if (size < 2 * margin + 4) break;
      const x = margin + (width - 2 * margin) * random(seed + 971, attempt, 1);
      const y = margin + (height - 2 * margin) * random(seed + 971, attempt, 2);
      if (footprint?.irregular && footprint.edgeDistance(x, y) < margin + (landform === "island" ? 8 : 0)) continue;
      if (!footprint?.irregular && landform === "island" && Math.hypot(2 * x / width - 1, 2 * y / height - 1) > 0.57) continue;
      if (lakes.some((lake) => Math.hypot(x - lake.x, y - lake.y) < (radius + lake.radius) * 1.6)) continue;
      lakes.push({ x, y, radius });
    }
  }

  const vertices = new Map();
  const vertex = (x, y) => {
    // Each vertex has a single value even when shared by adjoining region packs.
    const key = x * 2048 + y;
    const cached = vertices.get(key);
    if (cached) return cached;
    const a = noise(seed, x, y, Math.max(10, size / 5));
    const b = noise(seed + 42, x, y, Math.max(5, size / 14));
    const detail = noise(seed + 119, x, y, 3);
    const u = 2 * x / width - 1, v = 2 * y / height - 1;
    const hills = 24 + 22 * a + 8 * b + 4 * detail;
    let elevation = hills;
    let distance = 1;
    let level = waterLevel;
    const innerEdge = footprint?.irregular && (landform === "island" || landform === "basin" || landform === "cavern")
      ? footprint.edgeDistance(x, y) : undefined;
    if (landform === "island") {
      const bay = noise(seed + 402, x, y, Math.max(9, size / 10));
      const coast = Math.hypot(u * 1.08, v) + (a - 0.5) * 0.4 + (bay - 0.5) * 0.20 + (b - 0.5) * 0.08;
      distance = innerEdge === undefined ? (0.94 - coast) * size / 2
        : Math.min(innerEdge, innerEdge - 7 + (bay - 0.5) * 11 + (b - 0.5) * 6);
      const ridge = 1 - Math.abs(2 * b - 1);
      const shore = Math.max(0, Math.min(distance, 10));
      // Sand rises slowly, then the jungle rises in terraces.
      elevation = waterLevel + shore * 0.9 + smooth(5, 21, distance + (bay - 0.5) * 6) * (18 + 15 * a)
        + smooth(10, size / 2, distance) * (52 + 100 * a * ridge + 10 * detail);
    } else if (landform === "basin") {
      const rim = innerEdge === undefined ? smooth(0.44, 0.93, Math.hypot(u, v) + (b - 0.5) * 0.17)
        : 1 - smooth(5, Math.min(29, size * 0.40), innerEdge + (b - 0.5) * 10);
      const pass = v < -0.45 ? smooth(0.06, 0.30, Math.abs(u + 0.08 * Math.sin(v * 6))) : 1;
      elevation += rim * pass * (54 + 110 * a * (1 - Math.abs(2 * b - 1)) + 14 * detail);
    } else if (landform === "river") {
      const meander = Math.sin(v * 4.8 + seed) * 0.2 + (a - 0.5) * 0.23;
      const channel = footprint?.river;
      const bank = channel
        ? smooth(5, 31, channel(x + (a - 0.5) * 13, y + (b - 0.5) * 13))
        : smooth(0.05, 0.4, Math.abs(u - meander));
      elevation = lerp(18 + 7 * b, hills + 43 * a, bank);
      distance = elevation - waterLevel;
    } else if (landform === "wetlands") {
      if (swampPocket) ({ distance, level } = swampPocket(x, y));
      else {
        const pond = noise(seed + 613, x + (b - 0.5) * 13, y + (a - 0.5) * 13, Math.max(6, Math.min(13, size / 9)));
        distance = (pond * 0.62 + b * 0.23 + a * 0.15 - 0.47) * 65;
      }
      elevation = lerp(level, waterLevel + 13 + 23 * a + 7 * detail, smooth(0, swamp ? 5 : 9, distance));
    } else if (landform === "cavern") {
      const edge = innerEdge ?? Math.min(x, y, width - x, height - y);
      elevation = edge >= 1 ? 28 : 72 + 15 * a;
    }
    if (inland) {
      const outside = x <= 0 || y <= 0 || x >= width || y >= height;
      if (outside && landform === "island") distance = Math.min(distance, -1);
      elevation = distance <= 0 ? level : Math.max(level + 2, level + (elevation - level) * scale);
    } else if (landform !== "cavern") elevation = 35 + (elevation - 35) * scale;
    let lakeWater = false;
    for (const lake of lakes) {
      const shore = Math.hypot(x - lake.x, (y - lake.y) * 1.14) -
        lake.radius * (0.78 + 0.44 * noise(seed + 997, x, y, Math.max(3, lake.radius / 2)));
      if (shore > 1.1 * lake.radius || (inland && distance < 3)) continue;
      const lakeLevel = biome === "swamp" ? 12 : 25;
      if (shore <= 0) {
        distance = shore;
        level = elevation = lakeLevel;
        lakeWater = true;
      } else elevation = lerp(lakeLevel + 1, elevation, smooth(0, 1.1 * lake.radius, shore));
      break;
    }
    const quantized = clamp(Math.round(elevation), 0, 255);
    const sample = { elevation: quantized === 1 ? 2 : quantized, distance, level, lakeWater };
    vertices.set(key, sample);
    return sample;
  };
  return { vertex, waterLevel, inland: inland || lakes.length > 0, swamp, ocean };
}

function readGround(data, wide, mapX, mapY) {
  let offset = 0;
  const read = () => wide ? (data[offset++] << 8) | data[offset++] : data[offset++];
  return Array.from({ length: REGION_SIZE ** 2 }, (_, tile) => {
    let underlay = 0, overlay = 0, shape = 0;
    while (offset < data.length) {
      const opcode = read();
      if (opcode <= 1) {
        const explicit = opcode === 1 ? data[offset++] : undefined;
        const elevation = explicit === undefined ? nativeTerrainHeight(mapX * 64 + (tile >> 6), mapY * 64 + (tile & 63))
          : explicit === 1 ? 0 : explicit;
        return { elevation, underlay, overlay, shape };
      }
      if (opcode <= 49) { overlay = read(); shape = (opcode - 2) >> 2; }
      else if (opcode > 81) underlay = opcode - 81;
    }
  });
}

function expansionReferences(core, plan, regions, source) {
  if (!plan.extend) return;
  const wide = (core.CachePipeline.getActive()?.revision ?? 0) >= 209;
  const selected = new Set(regions);
  const draft = source && planLandscape(core, source);
  const draftRegions = new Set(draft?.regions);
  const decoded = new Map();
  const seams = new Map();
  const assets = new Map();
  const sources = new Set();
  const traits = { tropical: 0, swamp: 0, forest: 0, desert: 0, alpine: 0 };
  const waterOverlays = new Set([WATER, SWAMP_SHALLOWS, KARAMJA_COAST, ...KARAMJA_WATER]);
  const readReference = (rx, ry) => {
    if (rx < 0 || rx >= MAP_WIDTH / 64 || ry < 0 || ry >= MAP_HEIGHT / 64) return;
    const id = (rx << 8) | ry;
    if (selected.has(id)) return;
    if (!decoded.has(id)) {
      const active = core.MapRegionReplacementManager.getReplacementMapData(id);
      const cache = !active?.terrainData || !active.objectData ? core.CacheMaps.getRegion(id) : undefined;
      const data = active?.terrainData ?? cache?.terrainData;
      if (data) decoded.set(id, { ground: readGround(data, wide, rx, ry), objects: active?.objectData ?? cache?.objectData });
      else if (draft && draftRegions.has(id)) {
        decoded.set(id, {
          ground: Array.from({ length: 4096 }, (_, i) => draft.tileAt(rx * 64 + (i >> 6), ry * 64 + (i & 63))),
          objects: encodeLocs([...(draft.locs.get(id) ?? [])]),
        });
      } else decoded.set(id, null);
    }
    return decoded.get(id);
  };
  for (const id of regions) {
    const rx = id >> 8, ry = id & 255;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = rx + dx, ny = ry + dy;
      const near = (nx << 8) | ny;
      if ((ny >= CAVE_ROW) !== (ry >= CAVE_ROW)) continue;
      const reference = readReference(nx, ny);
      if (!reference) continue;
      sources.add(near);
      const into = (x, y) => dx ? (dx < 0 ? 63 - x : x) : (dy < 0 ? 63 - y : y);
      if (reference.objects && core.CacheDefinitions) {
        for (const biome of Object.keys(biomes)) {
          for (const asset of readScenery(reference.objects, core, biomes[biome], (x, y) => into(x, y) < 24, true)) {
            if (sceneryHabitat(asset.id, asset.name, biomes[biome])) traits[biome] += asset.count;
            const existing = assets.get(asset.id);
            if (!existing || existing.habitat === "land") assets.set(asset.id, asset);
          }
        }
      }
      const wing = Math.min(16, plan.edgeBlend);
      const next = readReference(nx + (dy ? 1 : 0), ny + (dx ? 1 : 0));
      const previous = readReference(nx - (dy ? 1 : 0), ny - (dx ? 1 : 0));
      for (let across = previous ? 0 : -wing; across <= (next ? 64 : 64 + wing); across++) {
        const t = next && across === 64 ? 0 : clamp(across, 0, 63);
        const section = next && across === 64 ? next : reference;
        const sample = (depth) => section.ground[dx
          ? ((dx < 0 ? 63 - depth : depth) << 6) | t
          : (t << 6) | (dy < 0 ? 63 - depth : depth)];
        const edge = sample(0), closer = sample(1), inner = sample(4);
        if (!edge) continue;
        const wet = waterOverlays.has(edge.overlay);
        if (across >= 0 && across < 64) {
          if (edge.overlay === SWAMP_SHALLOWS) traits.swamp += 2;
          if (edge.overlay === KARAMJA_COAST || KARAMJA_WATER.includes(edge.overlay)) traits.tropical += 2;
        }
        const slope = !wet && closer && inner
          ? clamp((edge.elevation - closer.elevation) * 0.7 + (edge.elevation - inner.elevation) * 0.075, -5, 5) : 0;
        // The terrain archive owns its south-west vertices. The east and north
        // edges end one vertex early, so continue the last measured slope.
        const anchor = edge.elevation + (dx < 0 || dy < 0 ? slope : 0);
        const groundOverlay = !edge.shape && edge.overlay === inner?.overlay && edge.overlay === closer?.overlay && !wet
          ? edge.overlay : 0;
        const along = Math.max(0, -across, across - 64);
        for (let d = 0; d < plan.edgeBlend; d++) {
          const distance = Math.hypot(d, along);
          if (distance >= plan.edgeBlend) continue;
          const wx = rx * 64 + (dx ? (dx < 0 ? d : 64 - d) : across);
          const wy = ry * 64 + (dy ? (dy < 0 ? d : 64 - d) : across);
          if (wx < plan.x || wy < plan.y || wx > plan.x + plan.width || wy > plan.y + plan.height) continue;
          const key = wx * (MAP_HEIGHT + 1) + wy;
          const points = seams.get(key) ?? [];
          points.push({ distance, elevation: anchor + slope * Math.min(d, 10),
            underlay: edge.underlay, overlay: groundOverlay, water: wet ? edge.overlay : 0 });
          seams.set(key, points);
        }
      }
    }
  }
  if (!sources.size) throw new Error("Choose empty map squares next to terrain loaded by this world or a generated draft.");
  const inferred = Object.keys(traits).sort((a, b) => traits[b] - traits[a])[0];
  return { seams, assets: [...assets.values()], sources: [...sources].sort((a, b) => a - b),
    biome: draft?.biome ?? (traits[inferred] ? inferred : "forest") };
}

function planLandscape(core, input) {
  const automaticBiome = input.extend && (!input.biome || input.biome === "auto");
  const plan = normalize(automaticBiome ? { ...input, biome: "forest" } : input);
  const { x, y, width, height, seed, landform } = plan;
  const regions = plan.squares ? [...plan.squares].sort((a, b) => a - b) : [];
  if (!plan.squares) for (let rx = x >> 6; rx <= (x + width - 1) >> 6; rx++) {
    for (let ry = y >> 6; ry <= (y + height - 1) >> 6; ry++) regions.push((rx << 8) | ry);
  }
  const selected = plan.squares && new Set(regions);
  const reference = expansionReferences(core, plan, regions, input.source);
  if (automaticBiome) plan.biome = reference.biome;
  const biome = biomes[plan.biome];
  const palette = sampleBiome(core, plan.biome);
  const footprint = landscapeFootprint(plan);
  const { vertex: generateVertex, inland, swamp, ocean } = makeSurface(plan, footprint);
  const blendedVertices = new Map();
  const vertex = (tx, ty) => {
    const point = generateVertex(tx, ty);
    const key = (x + tx) * (MAP_HEIGHT + 1) + y + ty;
    const references = reference?.seams.get(key);
    if (!references) return point;
    if (blendedVertices.has(key)) return blendedVertices.get(key);
    const exact = references.filter(({ distance }) => distance === 0);
    const neighbours = exact.length ? exact : references;
    let weightSum = 0, elevationSum = 0;
    let strongest = neighbours[0], strength = 0;
    for (const sample of neighbours) {
      const weight = (1 - smooth(0, plan.edgeBlend, sample.distance)) ** 2;
      weightSum += weight;
      elevationSum += sample.elevation * weight;
      if (weight > strength) {
        strength = weight;
        strongest = sample;
      }
    }
    const influence = 1 - smooth(0, plan.edgeBlend, strongest.distance);
    const variation = noise(seed + 983, tx, ty, 13) * 0.65 + random(seed + 984, tx, ty) * 0.35;
    const keepMaterial = influence > variation;
    const waterInfluence = influence * (0.62 + variation * 0.62);
    const continuedWater = !!strongest.water && (exact.length > 0 || waterInfluence > 0.46);
    const shoreDistance = strongest.water ? -2 : 3;
    const distance = continuedWater ? -2 : lerp(point.distance, shoreDistance, influence);
    const elevation = clamp(Math.round(lerp(point.elevation, elevationSum / weightSum, influence)), 0, 255);
    const blended = { ...point, elevation: elevation === 1 ? 2 : elevation, distance,
      waterOverlay: continuedWater ? strongest.water : undefined,
      material: keepMaterial ? strongest.underlay : 0,
      groundOverlay: keepMaterial ? strongest.overlay : 0 };
    blendedVertices.set(key, blended);
    return blended;
  };
  const tiles = new Map();
  const tileAt = (wx, wy) => {
    const tx = wx - x, ty = wy - y;
    const key = tx * 2048 + ty;
    const cached = tiles.get(key);
    if (cached) return cached;
    const cave = landform === "cavern";
    const corners = TILE_CORNERS.map(([dx, dy]) => vertex(tx + dx, ty + dy));
    const elevation = corners[0].elevation;
    const edge = cave && footprint?.irregular ? footprint.edgeDistance(tx + 0.5, ty + 0.5)
      : Math.min(tx, ty, width - 1 - tx, height - 1 - ty);
    const average = corners.reduce((sum, point) => sum + point.elevation, 0) / 4;
    const distance = corners.reduce((sum, point) => sum + point.distance, 0) / 4;
    const mask = inland || reference ? corners.reduce((value, point, index) => value | (Number(point.distance <= 0) << index), 0) : 0;
    const water = mask !== 0;
    let [shape, rotation] = SHORE_SHAPES[mask];
    const lakeWater = corners.some((point) => point.lakeWater);
    const beach = landform === "island" && !lakeWater && distance < 4 + noise(seed + 332, tx, ty, 12) * 4;
    const rock = (cave && edge < 1) || (!water && average > 89);
    const blocked = (water && (swamp || mask === 15)) || (cave && edge < 1) || (rock &&
      Math.max(...corners.map((point) => Math.abs(point.elevation - elevation))) >= 10);
    const variant = noise(seed + 191, tx, ty, Math.max(5, Math.min(width, height) / 18));
    const material = rock ? 1 : beach ? 2 : variant > 0.69 ? 1 : 0;
    const swampDeep = swamp && corners.reduce((nearest, point) => point.distance < nearest.distance ? point : nearest).level === 0;
    let underlay = palette.materials[material] ?? palette.materials[0];
    if (swamp) underlay = distance < 5 ? 54 : variant > 0.61 ? 50 : 54;
    if (ocean) underlay = beach ? 68 : rock || variant > 0.66 ? 62 : variant > 0.44 ? 50 : 48;
    let overlay = 0;
    underlay = corners[0].material || underlay;
    if (water) {
      overlay = plan.biome === "swamp" && (lakeWater || (swamp && !swampDeep)) ? SWAMP_SHALLOWS : WATER;
      if (ocean && !lakeWater) overlay = distance > -3.5 || mask !== 15
        ? KARAMJA_COAST : KARAMJA_WATER[distance > -9 ? 0 : distance > -17 ? 1 : 2];
      overlay = corners.find((point) => point.waterOverlay)?.waterOverlay ?? overlay;
    } else {
      const material = corners.find((point) => point.groundOverlay)?.groundOverlay;
      if (material) {
        overlay = material;
        const materialMask = corners.reduce((value, point, index) => value | (Number(point.groundOverlay === material) << index), 0);
        [shape, rotation] = SHORE_SHAPES[materialMask];
      }
    }
    const shade = water && mask === 15 ? (overlay === SWAMP_SHALLOWS || overlay === KARAMJA_COAST ? 4 : 0)
      : rock ? 2 : beach ? 3 : 1;
    const tile = { elevation, underlay, overlay, shape, rotation, water, wetMask: mask, distance, blocked, shade };
    tiles.set(key, tile);
    return tile;
  };
  const locs = new Map();
  const reserved = new Set();
  let sceneryCount = 0;
  const nearby = reference?.assets ?? [];
  if (plan.scenery && landform !== "cavern" && (palette.scenery.length || nearby.length)) {
    const habitats = new Map(["land", "bank", "water", "canopy", "floor"].map((kind) =>
      [kind, palette.scenery.filter((asset) => asset.habitat === kind)]));
    const localHabitats = new Map(["land", "bank", "water", "canopy", "floor"].map((kind) =>
      [kind, nearby.filter((asset) => asset.habitat === kind ||
        (kind === "land" && (asset.habitat === "floor" || asset.habitat === "canopy")))]));
    for (let tx = 1; tx < width - 1; tx++) for (let ty = 1; ty < height - 1; ty++) {
      if (selected && !selected.has(regionId(x + tx, y + ty))) continue;
      const grove = noise(seed + 519, tx, ty, Math.max(4, Math.min(15, Math.min(width, height) / 11)));
      const at = tileAt(x + tx, y + ty);
      const chance = random(seed + 27, tx, ty);
      let habitat = "land", rate = biome.density * (0.18 + 1.8 * grove ** 2);
      if (swamp) {
        if (at.wetMask === 15 && at.overlay === WATER) { habitat = "water"; rate = 0.05; }
        else if (at.distance < 5 && (at.wetMask !== 15 || at.overlay === SWAMP_SHALLOWS)) {
          habitat = "bank"; rate = 0.22 + 0.64 * smooth(0.33, 0.72, grove);
        } else rate = 0.20;
      } else if (ocean) {
        if (at.distance < 4 || at.water) continue;
        if (at.distance < 20 && grove > 0.49) {
          habitat = chance < 0.15 ? "canopy" : "floor";
          rate = 0.54;
        } else {
          habitat = chance < 0.07 + 0.13 * smooth(0.37, 0.70, grove) ? "canopy" : "floor";
          rate = 0.21 + 0.42 * smooth(0.35, 0.73, grove);
        }
      }
      if (chance >= rate * plan.foliage / 100) continue;
      const local = localHabitats.get(habitat);
      const set = local.length && (random(seed + 191, tx, ty) < 0.8 || !habitats.get(habitat).length)
        ? local : habitats.get(habitat);
      const asset = set[Math.floor(random(seed + 61, tx, ty) * set.length)];
      if (!asset) continue;
      const rotation = Math.floor(random(seed + 77, tx, ty) * 4);
      const sx = rotation & 1 ? asset.height : asset.width, sy = rotation & 1 ? asset.width : asset.height;
      if (tx + sx >= width || ty + sy >= height) continue;
      const covered = [];
      // Ground cover can share a tile with a canopy model.
      const layer = Number(asset.shape === 22) * width * height;
      for (let dx = 0; dx < sx; dx++) for (let dy = 0; dy < sy; dy++) {
        if (selected && !selected.has(regionId(x + tx + dx, y + ty + dy))) continue;
        const key = layer + (tx + dx) * height + ty + dy;
        const tile = tileAt(x + tx + dx, y + ty + dy);
        const suitable = habitat === "water" ? tile.wetMask === 15 && tile.overlay === WATER
          : habitat === "bank" ? tile.distance < 10 && (tile.wetMask !== 15 || tile.overlay === SWAMP_SHALLOWS)
            : !tile.blocked && !tile.water && tile.shade !== 3;
        if (suitable && !reserved.has(key)) covered.push(key);
      }
      if (covered.length !== sx * sy) continue;
      for (const key of covered) reserved.add(key);
      const wx = x + tx, wy = y + ty;
      const id = regionId(wx, wy);
      if (!locs.has(id)) locs.set(id, []);
      locs.get(id).push([asset.id, ((wx & 63) << 6) | (wy & 63), (asset.shape << 2) | rotation]);
      sceneryCount++;
    }
  }
  const waterColors = biome.waterColors ?? ["#287488", "#6191a4"];
  return { ...plan, sourceRegions: reference?.sources, tileAt, regions, locs, sceneryCount, colours: [waterColors[0], ...biome.colors, waterColors[1]] };
}

function overview(plan) {
  const { x, y, seed, width, height, regions, landform, biome, relief, foliage, lakes, sceneryCount, colours, sourceRegions } = plan;
  const scale = Math.max(1, Math.max(width, height) / 96);
  const columns = Math.ceil(width / scale), rows = Math.ceil(height / scale);
  const pixels = [];
  let low = 255, high = 0;
  const selected = plan.squares && new Set(regions);
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const tx = x + Math.min(width - 1, Math.floor(col * scale));
    const ty = y + Math.max(0, height - 1 - Math.floor(row * scale));
    if (selected && !selected.has(regionId(tx, ty))) { pixels.push(255, 0, 0); continue; }
    const { elevation, shade } = plan.tileAt(tx, ty);
    low = Math.min(low, elevation);
    high = Math.max(high, elevation);
    const slope = 114 + (elevation - plan.tileAt(tx - 1, ty + 1).elevation) * 7;
    pixels.push(shade, clamp(slope, 44, 205), elevation);
  }
  return { x, y, seed, width, height, regions, landform, biome, relief, foliage, lakes, sceneryCount, low, high, ...(sourceRegions ? { sourceRegions } : {}),
    preview: { columns, rows, colours, pixels: base64(bytes(pixels)) } };
}

function encodeLocs(locs) {
  const bytes = [];
  const smart = (n) => n < 128 ? bytes.push(n) : bytes.push((n + 32768) >> 8, n & 255);
  let previousId = -1, previousPosition = 0;
  for (const [id, position, attributes] of locs.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (id !== previousId) {
      if (previousId !== -1) smart(0);
      let delta = id - previousId;
      while (delta >= 32767) { smart(32767); delta -= 32767; }
      smart(delta);
      previousId = id;
      previousPosition = 0;
    }
    smart(position - previousPosition + 1);
    bytes.push(attributes);
    previousPosition = position;
  }
  if (previousId !== -1) smart(0);
  smart(0);
  return Uint8Array.from(bytes);
}

function buildPacks(core, plan) {
  const wide = (core.CachePipeline.getActive()?.revision ?? 0) >= 209;
  return plan.regions.map((id) => {
    const mapX = id >> 8, mapY = id & 255;
    const bytes = [];
    const opcode = wide ? (n) => bytes.push(n >> 8, n & 255) : (n) => bytes.push(n & 255);
    for (let x = 0; x < REGION_SIZE; x++) for (let y = 0; y < REGION_SIZE; y++) {
      const tile = plan.tileAt(mapX * REGION_SIZE + x, mapY * REGION_SIZE + y);
      if (tile.underlay > 0 && (wide || tile.underlay <= 174)) opcode(81 + tile.underlay);
      if (tile.overlay) { opcode(2 + tile.shape * 4 + tile.rotation); opcode(tile.overlay); }
      if (tile.blocked) opcode(50);
      opcode(1);
      bytes.push(tile.elevation);
    }
    const terrain = concat([Uint8Array.from(bytes), new Uint8Array(3 * REGION_SIZE ** 2 * (wide ? 2 : 1))]);
    const objects = encodeLocs(plan.locs.get(id) ?? []);
    const budget = core.MapRegionReplacementManager.MAX_PACKET_PAYLOAD ?? 65533;
    if (terrain.length + objects.length + 7 > budget &&
        deflate(concat([terrain, objects])).length + 11 > budget) {
      throw new Error(`Map square ${id} exceeds the region packet budget`);
    }
    const pack = new Uint8Array(28 + terrain.length + objects.length);
    const view = new DataView(pack.buffer);
    for (const [index, number] of [1, -1, -1, mapX, mapY, objects.length].entries()) view.setInt32(index * 4, number);
    pack.set(objects, 24);
    view.setInt32(24 + objects.length, terrain.length);
    pack.set(terrain, 28 + objects.length);
    return { regionId: id, pack, terrain, objects };
  });
}

function occupiedSquareIds(core, saved = new Set()) {
  return [...new Set([...saved, ...core.CacheMaps.getRegionIds(), ...core.MapRegionReplacementManager.getRegionIds()])]
    .sort((a, b) => a - b);
}

function occupiedRegions(core, plan, saved = new Set()) {
  return plan.regions.filter((id) => saved.has(id) || core.CacheMaps.getArchiveIds(id) ||
    core.MapRegionReplacementManager.getReplacementMapData(id));
}

function findEmptySite(core, options, skip = new Set(), saved = new Set()) {
  const { width, height, landform } = normalize({ ...options, x: 0, y: 0 });
  const spanX = Math.ceil(width / REGION_SIZE);
  const spanY = Math.ceil(height / REGION_SIZE);
  const firstRow = landform === "cavern" ? CAVE_ROW : 0;
  const lastRow = (landform === "cavern" ? MAP_HEIGHT / REGION_SIZE : CAVE_ROW) - spanY;
  const preferredRow = landform === "cavern" ? 157 : 78;
  const examined = new Map();
  const used = (id) => {
    if (skip.has(id)) return true;
    if (!examined.has(id)) examined.set(id, occupiedRegions(core, { regions: [id] }, saved).length !== 0);
    return examined.get(id);
  };
  const columns = Array.from({ length: MAP_WIDTH / REGION_SIZE + 1 - spanX }, (_, x) => x);
  columns.sort((a, b) => Math.abs(a - 68) - Math.abs(b - 68));
  const rows = Array.from({ length: lastRow - firstRow + 1 }, (_, index) => firstRow + index);
  rows.sort((a, b) => Math.abs(a - preferredRow) - Math.abs(b - preferredRow));
  for (const x of columns) for (const y of rows) {
    let fits = true;
    for (let dx = 0; fits && dx < spanX; dx++) for (let dy = 0; dy < spanY; dy++) {
      if (used(((x + dx) << 8) | (y + dy))) { fits = false; break; }
    }
    if (fits) return { x: x * REGION_SIZE, y: y * REGION_SIZE };
  }
  throw new Error("No contiguous empty map squares fit this size");
}


module.exports = { catalog, normalize, sampleBiome, planLandscape, overview, buildPacks, occupiedRegions, occupiedSquareIds, findEmptySite, referenceRegionIds, extraSceneryIds: [...SWAMP_REEDS, ...SWAMP_BUBBLES, ...TROPICAL_PALMS, ...JUNGLE_FLOOR] };
