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
 * `MAP_PAGES` adds the maps of music map pages whose tracks the buckets hold no map for (one more
 * request, cached too), and `UNMAPPED_AREAS` the few music areas the Wiki's maps don't draw.
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
 * Music areas the Wiki's maps don't draw: whole 64x64 regions or tile rectangles
 * ([minX, minY, maxX, maxY], inclusive) on plane 0, painted under the Wiki's polygons, or over
 * them with `over`. Their tracks still need the Wiki's name for them.
 */
export const UNMAPPED_AREAS = [
  // The reworked Wilderness bosses' lairs and the Escape Caves (docs/wilderness-bosses.md).
  { tracks: ["A Dangerous Game"], regions: [6580, 7092, 7604, 13215, 13472, 13473, 13727] },
  // The Tombs of Amascut: each path's puzzle room plays its own test (the rooms' bounds in
  // plugins/minigames/toa/Shared.TombsOfAmascut.js).
  { tracks: ["Test of Strength"], rects: [[3670, 5267, 3690, 5293]] }, // Path of Het
  { tracks: ["Test of Companionship"], rects: [[3797, 5267, 3819, 5293]] }, // Path of Apmeken
  { tracks: ["Test of Isolation"], rects: [[3533, 5268, 3574, 5292]] }, // Path of Scabaras
  { tracks: ["Test of Resourcefulness"], rects: [[3923, 5250, 3949, 5311]] }, // Path of Crondis
  // The Sorceress's Garden: its centre, with the fountain, between the four seasonal gardens.
  { tracks: ["Sorceress's Garden"], rects: [[2903, 5463, 2920, 5481]] },
  // Impulses plays beside an active crop circle; the server has only Zanaris' fixed one.
  // Ours: within 3 tiles of its centre.
  { tracks: ["Impulses"], rects: [[2424, 4443, 2430, 4449]], over: true },
];

/** Music map pages whose tracks' own maps the buckets don't hold (the tracks embed the page). */
export const MAP_PAGES = ["Map:Ardent Ocean music"];

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

/** MAP_PAGES' wikitext, one request, cached beside the bucket rows. */
async function fetchMapPages(cacheDir, refresh) {
  const file = path.join(cacheDir, "music-map-pages.json");
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const query = { action: "query", prop: "revisions", rvprop: "content", rvslots: "main", format: "json", formatversion: "2", titles: MAP_PAGES.join("|") };
  const response = await fetch(`${WIKI_API}?${new URLSearchParams(query)}`, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Wiki page query failed: HTTP ${response.status}`);
  const pages = Object.fromEntries((await response.json()).query.pages
    .filter((page) => page.revisions)
    .map((page) => [page.title, page.revisions[0].slots.main.content]));
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(pages));
  return pages;
}

/** The top-level arguments of the first `{{name|...}}` in `text`: positional, and named. */
function templateArgs(text, name) {
  const start = text.indexOf(`{{${name}`);
  if (start < 0) return null;
  const parts = [];
  let depth = 0;
  let from = start + 2 + name.length;
  for (let i = from; i < text.length; i++) {
    if (text.startsWith("{{", i)) { depth++; i++; continue; }
    if (text.startsWith("}}", i)) {
      if (depth === 0) { parts.push(text.slice(from, i)); break; }
      depth--; i++; continue;
    }
    if (text[i] === "|" && depth === 0) { parts.push(text.slice(from, i)); from = i + 1; }
  }
  const positional = [];
  const named = {};
  for (const part of parts.slice(1)) {
    const match = /^\s*([A-Za-z_][\w ]*?)\s*=([\s\S]*)$/.exec(part);
    if (match && !part.trim().startsWith("[")) named[match[1]] = match[2].trim();
    else positional.push(part.trim());
  }
  return { positional, named };
}

/**
 * A music map page's polygon, as Template:Music track map draws it. A `{{Map polygon|Title|i,j}}`
 * in it stands for that track's current polygons (Module:Map polygon), outer rings only unless
 * `fillholes=no`; as further rings of the page's polygon they cut its islands out.
 */
export function mapPagePolygon(text, rows) {
  const args = templateArgs(text.replace(/<noinclude>[\s\S]*?<\/noinclude>/g, ""), "Music track map");
  if (!args) return null;
  const json = args.positional.find((arg) => arg.startsWith("["));
  if (!json) return null;
  const resolved = json.replace(/<!--[\s\S]*?-->/g, "").replace(/\{\{\s*Map polygon\s*\|([^{}]*)\}\}/g, (_, inner) => {
    const [title, indices = "1", ...rest] = inner.split("|").map((part) => part.trim());
    const fillHoles = !rest.some((part) => /^fillholes\s*=\s*no$/i.test(part));
    const current = rows.filter((row) => row.title === title && row["map.features"] && row["map.is_historic"] === undefined);
    return indices.split(",").map(Number).flatMap((index) => {
      const coordinates = current[index - 1] ? JSON.parse(current[index - 1]["map.features"])[0].geometry.coordinates : [];
      return (fillHoles ? coordinates.slice(0, 1) : coordinates).map((ring) => JSON.stringify(ring));
    }).join(",");
  });
  const rings = JSON.parse(resolved.replace(/,\s*(?=[\],])/g, "").replace(/\[\s*,/g, "["));
  const songs = (args.named.songs ?? "").split(",").map((song) => song.trim()).filter(Boolean);
  return { plane: Number(args.named.plane ?? 0), rings, songs };
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

export function buildMusicAreas({ rows, tracks, unmapped = UNMAPPED_AREAS, mapPages = {} }) {
  const byName = new Map();
  for (const track of tracks) {
    const known = byName.get(nameKey(track.name));
    if (!known || track.id < known.id) byName.set(nameKey(track.name), track);
  }
  const unknown = new Set();
  const areas = new Map();
  const polygons = [];
  const wiki = wikiPolygons(rows);
  // A map page's polygon, for the songs on it that have no map of their own in the buckets.
  const mapped = new Set(wiki.flatMap(({ titles }) => titles));
  for (const text of Object.values(mapPages)) {
    const page = mapPagePolygon(text, rows);
    const songs = page?.songs.filter((song) => !mapped.has(song)) ?? [];
    if (songs.length === 0) continue;
    wiki.push({ key: `page:${songs.join("|")}`, plane: page.plane, rings: page.rings, size: polygonSize(page.rings), titles: songs, pages: songs });
  }
  for (const polygon of wiki) {
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
  // Each unmapped region or rectangle as a square painted before every Wiki polygon, so a Wiki
  // area on it wins, or after them all when it is `over` them.
  for (const { tracks: names, regions = [], rects = [], over = false } of unmapped) {
    const entries = names.map((name) => ({ name, page: name, id: byName.get(nameKey(name))?.id }));
    if (entries.some(({ id }) => id === undefined)) throw new Error(`unmapped area track not in the cache: ${names.join(", ")}`);
    entries.sort((a, b) => byText(a.name, b.name));
    const key = entries.map(({ id }) => id).join(",");
    if (!areas.has(key)) areas.set(key, { names: entries.map(({ name }) => name), wiki: `https://oldschool.runescape.wiki/w/${encodeURIComponent(names[0].replace(/ /g, "_"))}`, tracks: entries.map(({ id }) => id) });
    const squares = [
      ...regions.map((region) => [(region >> 8) * 64, (region & 0xff) * 64, (region >> 8) * 64 + 63, (region & 0xff) * 64 + 63]),
      ...rects,
    ];
    for (const [minX, minY, maxX, maxY] of squares) {
      polygons.push({
        key: `unmapped:${minX},${minY}`, plane: 0, size: over ? -Infinity : Infinity,
        rings: [[[minX, minY], [maxX + 1, minY], [maxX + 1, maxY + 1], [minX, maxY + 1]]], area: areas.get(key),
      });
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
  const mapPages = await fetchMapPages(cache, refresh);
  const tracks = await cacheTracks();
  const result = buildMusicAreas({ rows, tracks, mapPages });
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
