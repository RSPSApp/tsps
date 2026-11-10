#!/usr/bin/env node
/**
 * Regenerate server/data/definitions/music-areas.json from the OSRS Wiki's music maps.
 *
 * Input: the Wiki's `music` and `map` buckets, which hold every music track's map polygons
 * (the data behind Template:Music track map and Module:Map polygon). One paged query returns
 * them all; the response is cached in --cache, outside the repo, and fetched again only with
 * --refresh or when the cache is missing.
 *
 * Each current (non-historic) polygon is a music area, played by every track whose map holds
 * the same polygon. The polygons are rasterised onto tiles, one grid per plane: a tile belongs to
 * the smallest polygon covering its centre. Polygons with the same tracks are one area. The file
 * lists the areas and, per plane and 64x64 region, the area of each tile, run-length encoded.
 * `UNMAPPED_AREAS` adds the few captured music areas the Wiki's maps miss, under the Wiki's own.
 * `--check` reports whether music-areas.json matches what the Wiki data gives, without writing it.
 *
 * Needs a built server (`yarn build`) for the cache's track list (DB table 44).
 *
 * Usage:
 *   node scripts/import-music-areas.mjs [--cache <dir>] [--refresh] [--check]
 *
 * Default cache: <os tmpdir>/tsps-wiki-music.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..");
const outFile = path.join(serverDir, "data", "definitions", "music-areas.json");

const WIKI_API = "https://oldschool.runescape.wiki/api.php";
const USER_AGENT = "tsps-music-import/1.0 (https://github.com/RSPSApp/tsps)";
const PAGE = 500;
const REGION_TILES = 64 * 64;

/**
 * Music areas the Wiki's maps don't draw, as captured: whole 64x64 regions on plane 0, painted
 * under the Wiki's polygons. Their tracks still need the Wiki's name for them.
 */
export const UNMAPPED_AREAS = [
  // The reworked Wilderness bosses' lairs and the Escape Caves (docs/wilderness-bosses.md).
  { tracks: ["A Dangerous Game"], regions: [6580, 7092, 7604, 13215, 13472, 13473, 13727] },
];

function parseArgs(argv) {
  const args = { cache: path.join(os.tmpdir(), "tsps-wiki-music"), refresh: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cache") args.cache = path.resolve(argv[++i]);
    else if (argv[i] === "--refresh") args.refresh = true;
    else if (argv[i] === "--check") args.check = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

async function fetchMaps(cacheDir, refresh) {
  const file = path.join(cacheDir, "music-maps.json");
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const query = "bucket('music').select('title','page_name','map.is_historic','map.features')"
      + ".join('map','map.page_name','music.page_name')"
      + `.limit(${PAGE}).offset(${offset}).run()`;
    const url = `${WIKI_API}?${new URLSearchParams({ action: "bucket", format: "json", query })}`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Wiki bucket query failed: HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.bucket)) throw new Error(`Wiki bucket query failed: ${JSON.stringify(body).slice(0, 200)}`);
    rows.push(...body.bucket);
    if (body.bucket.length < PAGE) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows));
  return rows;
}

async function cacheTracks() {
  const require = createRequire(import.meta.url);
  const dist = path.join(serverDir, "dist");
  if (!fs.existsSync(path.join(dist, "game", "Music.js"))) throw new Error("build the server first (yarn build)");
  process.chdir(serverDir);
  require(path.join(dist, "Server")).Server.installProductionPathResolver();
  await require(path.join(dist, "game", "cache", "CachePipeline")).CachePipeline.initialize(serverDir);
  const tracks = require(path.join(dist, "game", "Music")).Music.tracks();
  if (tracks.length === 0) throw new Error("the cache has no music tracks (DB table 44)");
  return tracks;
}

function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/** The area the rings fill, even-odd: a ring inside an odd number of the others is a hole. */
export function polygonSize(rings) {
  return rings.reduce((sum, ring, i) => {
    const depth = rings.filter((other, j) => j !== i && insideRing(ring[0], other)).length;
    return sum + (depth % 2 === 0 ? 1 : -1) * ringArea(ring);
  }, 0);
}

/** A track name as both the cache and the Wiki spell it: the cache writes commas as tabs. */
const nameKey = (name) => name.replace(/[\t,]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(sum) / 2;
}

/** The Wiki's current music polygons, each with every track whose map holds it. */
export function wikiPolygons(rows) {
  const byKey = new Map();
  for (const row of rows) {
    // `map.is_historic` is absent for current maps.
    if (!row["map.features"] || row["map.is_historic"] !== undefined) continue;
    for (const feature of JSON.parse(row["map.features"])) {
      const { plane = 0, mapID = -1 } = feature.properties ?? {};
      if (feature.geometry?.type !== "Polygon" || (mapID !== -1 && mapID !== 0)) continue;
      const rings = feature.geometry.coordinates;
      const key = `${plane}:${JSON.stringify(rings)}`;
      let polygon = byKey.get(key);
      if (!polygon) {
        byKey.set(key, polygon = { key, plane, rings, size: polygonSize(rings), titles: [], pages: [] });
      }
      if (!polygon.titles.includes(row.title)) {
        polygon.titles.push(row.title);
        polygon.pages.push(row.page_name);
      }
    }
  }
  return [...byKey.values()];
}

/**
 * Paints `value` on every tile whose centre is inside the polygon (even-odd over its rings, so
 * holes stay out), into `grids`: "plane:region" -> one entry per tile of the region.
 */
export function paintPolygon(grids, plane, rings, value) {
  const edges = rings.flatMap((ring) => ring.map((point, i) => [point, ring[(i + 1) % ring.length]]));
  const ys = rings.flat().map(([, y]) => y);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    const cy = y + 0.5;
    const crossings = [];
    for (const [[x1, y1], [x2, y2]] of edges) {
      if ((y1 > cy) !== (y2 > cy)) crossings.push(x1 + ((cy - y1) * (x2 - x1)) / (y2 - y1));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      // Tile x is inside when its centre x + 0.5 lies between the two crossings.
      for (let x = Math.ceil(crossings[i] - 0.5); x + 0.5 < crossings[i + 1]; x++) {
        const key = `${plane}:${((x >> 6) << 8) | (y >> 6)}`;
        let grid = grids.get(key);
        if (!grid) grids.set(key, grid = new Int32Array(REGION_TILES).fill(-1));
        grid[((y & 63) << 6) | (x & 63)] = value;
      }
    }
  }
}

/** "id*count" runs over a region's tiles, row by row from the south-west; "-" is no area. */
export function encodeRuns(grid) {
  const runs = [];
  for (let i = 0; i < grid.length;) {
    let j = i + 1;
    while (j < grid.length && grid[j] === grid[i]) j++;
    const id = grid[i] < 0 ? "-" : String(grid[i]);
    runs.push(j - i === 1 ? id : `${id}*${j - i}`);
    i = j;
  }
  return runs.join(",");
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function buildMusicAreas({ rows, tracks, unmapped = UNMAPPED_AREAS }) {
  const byName = new Map();
  for (const track of tracks) {
    const known = byName.get(nameKey(track.name));
    if (!known || track.id < known.id) byName.set(nameKey(track.name), track);
  }
  const unknown = new Set();
  const areas = new Map();
  const polygons = [];
  for (const polygon of wikiPolygons(rows)) {
    const entries = [];
    polygon.titles.forEach((title, index) => {
      const track = byName.get(nameKey(title));
      if (track) entries.push({ name: track.name, page: polygon.pages[index], id: track.id });
      else unknown.add(title);
    });
    if (entries.length === 0) continue;
    entries.sort((a, b) => byText(a.name, b.name));
    const key = entries.map(({ id }) => id).join(",");
    if (!areas.has(key)) {
      areas.set(key, {
        names: entries.map(({ name }) => name),
        wiki: `https://oldschool.runescape.wiki/w/${encodeURIComponent(entries[0].page.replace(/ /g, "_")).replace(/%2F/g, "/")}`,
        tracks: entries.map(({ id }) => id),
      });
    }
    polygons.push({ ...polygon, area: areas.get(key) });
  }
  // Each unmapped region as a square painted before every Wiki polygon, so a Wiki area on it wins.
  for (const { tracks: names, regions } of unmapped) {
    const entries = names.map((name) => ({ name, page: name, id: byName.get(nameKey(name))?.id }));
    if (entries.some(({ id }) => id === undefined)) throw new Error(`unmapped area track not in the cache: ${names.join(", ")}`);
    entries.sort((a, b) => byText(a.name, b.name));
    const key = entries.map(({ id }) => id).join(",");
    for (const region of regions) {
      const x = (region >> 8) * 64;
      const y = (region & 0xff) * 64;
      if (!areas.has(key)) areas.set(key, { names: entries.map(({ name }) => name), wiki: `https://oldschool.runescape.wiki/w/${encodeURIComponent(names[0].replace(/ /g, "_"))}`, tracks: entries.map(({ id }) => id) });
      polygons.push({ key: `unmapped:${region}`, plane: 0, size: Infinity, rings: [[[x, y], [x + 64, y], [x + 64, y + 64], [x, y + 64]]], area: areas.get(key) });
    }
  }
  const sorted = [...areas.values()].sort((a, b) => byText(a.names.join("|"), b.names.join("|")));
  // Largest first, so a smaller polygon paints over the one it sits in.
  polygons.sort((a, b) => b.size - a.size || byText(a.key, b.key));
  const grids = new Map();
  for (const polygon of polygons) paintPolygon(grids, polygon.plane, polygon.rings, sorted.indexOf(polygon.area));
  // Areas smaller polygons paint over entirely own no tile: leave them out, and number the rest.
  const painted = new Set();
  for (const grid of grids.values()) for (const id of grid) if (id >= 0) painted.add(id);
  const list = sorted.filter((_, i) => painted.has(i));
  const renumber = new Map(sorted.map((area, i) => [i, list.indexOf(area)]));
  for (const grid of grids.values()) grid.forEach((id, tile) => { if (id >= 0) grid[tile] = renumber.get(id); });
  const tiles = {};
  const order = ([a], [b]) => {
    const [pa, ra] = a.split(":").map(Number);
    const [pb, rb] = b.split(":").map(Number);
    return pa - pb || ra - rb;
  };
  for (const [key, grid] of [...grids].sort(order)) {
    const [plane, region] = key.split(":");
    (tiles[plane] ??= {})[region] = encodeRuns(grid);
  }
  return { areas: list, tiles, unknown: [...unknown].sort() };
}

function render({ areas, tiles }) {
  const areaLines = areas.map((area) => `    ${JSON.stringify(area)}`).join(",\n");
  const planeBlocks = Object.entries(tiles).map(([plane, regions]) => {
    const lines = Object.entries(regions).map(([region, runs]) => `      ${JSON.stringify(region)}: ${JSON.stringify(runs)}`);
    return `    ${JSON.stringify(plane)}: {\n${lines.join(",\n")}\n    }`;
  }).join(",\n");
  return `{\n  "source": "Generated by scripts/import-music-areas.mjs from the OSRS Wiki's music maps; do not edit.",\n`
    + `  "areas": [\n${areaLines}\n  ],\n  "tiles": {\n${planeBlocks}\n  }\n}\n`;
}

async function main() {
  const { cache, refresh, check } = parseArgs(process.argv.slice(2));
  const rows = await fetchMaps(cache, refresh);
  const tracks = await cacheTracks();
  const result = buildMusicAreas({ rows, tracks });
  const text = render(result);
  const regions = Object.values(result.tiles).reduce((sum, plane) => sum + Object.keys(plane).length, 0);
  console.log(`${result.areas.length} music areas over ${regions} region grids`);
  if (result.unknown.length) console.log(`Wiki tracks not in the cache: ${result.unknown.join(", ")}`);
  if (check) {
    // A checkout may have CRLF line endings.
    const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== text) {
      console.error("music-areas.json is out of date: run scripts/import-music-areas.mjs");
      process.exit(1);
    }
    console.log("music-areas.json is up to date");
  } else {
    fs.writeFileSync(outFile, text);
    console.log(`wrote ${path.relative(serverDir, outFile)}`);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
