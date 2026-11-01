// Adds the NPC spawns data/definitions/npc-spawns.json lacks in an area, from the OSRS Wiki.
//
//   yarn sync:npc-spawns --box 2530,2190,2640,2290 --tag Wyrmscraig          # print what it would add
//   yarn sync:npc-spawns --box ... --tag ... --write                         # add them
//   yarn sync:npc-spawns --box ... --wiki wiki.json [--save]                 # use (or write) a saved Wiki copy
//   yarn sync:npc-spawns --report gaps.json [--box ...]                      # every area's gaps (whole map by default)
//
// Options:
//   --box minX,minY,maxX,maxY[,plane]  the area (repeatable; inclusive; every plane unless given)
//   --tag <word>                       prefer Wiki versions whose label has it ("Idle (Wyrmscraig)")
//   --id <Name>=<npc id>               use this id for a Wiki page's spawns (repeatable)
//   --skip <Name>                      leave a Wiki page's spawns out (Leagues or event NPCs; repeatable)
//   --radius <tiles>                   how far an existing spawn may be from the Wiki's (default 4)
//   --report <file>                    write each map square's gaps as JSON instead (nothing is written)
//   --only <label>                     add only spawns with this label (e.g. "Sailing sea creature")
//   --repair-identities                reconcile misidentified literal IDs from Wiki/cache evidence
//   --spawns <file>                    alternate spawn input/output (default npc-spawns.json)
//
// data/definitions/npc-spawn-sync.json holds lasting decisions: cache NPC categories, NPC ids, NPC
// names (exact or by pattern), Wiki page patterns and areas to label (sea creatures, doors tsps handles as objects, Leagues and
// holiday NPCs, instance templates) and, when `skip` is set, to leave out.
//
// Where the Wiki keeps spawns:
// - monsters: {{LocLine}} rows (bucket "locline"), one coordinate per spawn, ids per page version
//   from bucket "infobox_monster";
// - single NPCs: their infobox {{Map}} (page wikitext), ids from bucket "infobox_npc".
// A LocLine row has no version, so a page's id is chosen: a version whose label has a --tag, else
// the id existing spawns of that page already use most, else the first; the report lists it.
//
// Add-only: per NPC name, a Wiki spawn with an existing one of that name within --radius is
// already there (closest pairs first), and leftover existing spawns in the same map square still
// count, so only the difference in number is added there. A tile the Wiki lists twice for one NPC
// name (another map layer, another page, another LocLine) counts once. Nothing is moved or removed, and a second run adds nothing.
// Added spawns carry "source": "wiki".
//
// Wander radius: what existing spawns of that NPC (by id, else by name) mostly use - 0 for fishing
// spots and bankers; else 0 for an NPC without a walk animation in the cache; else the loader's
// default. The Wiki map's `r` only sizes its marker (Mortimer has r=4 and stands still), so it's
// not used. Spawned NPCs with a combat level but no drop table or stats are listed:
// those come from the drop dumper in osrsreboxed-db (plugins/npcs/NpcDrops.plugin.js).
//
// Needs the cache in server/caches - run `yarn ensure-cache` first.
import * as fs from "fs";
import path = require("path");

import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";

const { versionIds, alignLayers, parsePoint, parseInfoboxMaps, parseBox, inBoxes, nameKey, planAdditions, reconcileIdentities, squareOf, parseLocLines, locationName, chooseWanderRadius } = require("./npc-spawn-matching.cjs");

const WIKI_API = "https://oldschool.runescape.wiki/api.php";
const USER_AGENT = "tsps-npc-spawns (https://github.com/RSPSApp/tsps)";
const PAGE = 5000;
const TITLES_PER_REQUEST = 50;
const DEFINITIONS = path.resolve(__dirname, "../data/definitions");
const SPAWNS_FILE = path.join(DEFINITIONS, "npc-spawns.json");

type Spawn = { level: number; name?: string; x: number; y: number; id?: number; key?: string; wanderRadius?: number; source?: string };
/** `ids`: those in the cache; `numbered`: whether the Wiki gave any real id (not "hist11249"). */
type Version = { label: string; ids: number[]; numbered: boolean };
/** `mapId`: the Wiki map layer the coordinates are on (see alignLayers). */
type WikiSpawn = { page: string; versions: Version[]; x: number; y: number; level: number; mapId: number | null; name?: string };
/** `npcMaps`: each NPC page's infobox map lines; `locLineText`: each page's {{LocLine}} templates. */
type Wiki = { loclines: any[]; monsters: any[]; npcs: any[]; npcMaps: Record<string, string>; locLineText: Record<string, string> };
type Decision = { label: string; skip: boolean; why?: string };
type Candidate = Spawn & { page: string; flags: string[]; skip: boolean };

function argValues(flag: string): string[] {
    const values: string[] = [];
    process.argv.forEach((arg, index) => { if (arg === flag && process.argv[index + 1] !== undefined) values.push(process.argv[index + 1]); });
    return values;
}

async function wikiJson(params: Record<string, string>): Promise<any> {
    const response = await fetch(`${WIKI_API}?${new URLSearchParams({ format: "json", ...params })}`, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Wiki ${response.status} for ${JSON.stringify(params)}`);
    return response.json();
}

async function allRows(select: string): Promise<any[]> {
    const rows: any[] = [];
    for (let offset = 0; ; offset += PAGE) {
        const page = (await wikiJson({ action: "bucket", query: `${select}.limit(${PAGE}).offset(${offset}).run()` })).bucket ?? [];
        rows.push(...page);
        if (page.length < PAGE) return rows;
    }
}

/** Each page's infobox {{Map}} lines and {{LocLine}} templates (only those, to keep a saved copy small). */
async function pageLines(pages: string[]): Promise<{ maps: Record<string, string>; locLines: Record<string, string> }> {
    const maps: Record<string, string> = {};
    const locLines: Record<string, string> = {};
    for (let start = 0; start < pages.length; start += TITLES_PER_REQUEST) {
        const titles = pages.slice(start, start + TITLES_PER_REQUEST).join("|");
        const result = await wikiJson({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles, redirects: "1" });
        const renamed = new Map<string, string>();
        for (const link of [...(result.query?.normalized ?? []), ...(result.query?.redirects ?? [])]) renamed.set(link.to, link.from);
        for (const page of Object.values<any>(result.query?.pages ?? {})) {
            const text: string = page.revisions?.[0]?.slots?.main?.["*"] ?? "";
            const title = renamed.get(page.title) ?? page.title;
            const lines = text.split("\n").filter((line) => /^\|\s*(map\d*|id\d*)\s*=/i.test(line));
            if (lines.length) maps[title] = lines.join("\n");
            const templates = text.match(/\{\{\s*LocLine\s*\|[\s\S]*?\}\}/gi);
            if (templates) locLines[title] = templates.join("\n");
        }
        process.stderr.write(`\r  NPC pages ${Math.min(start + TITLES_PER_REQUEST, pages.length)}/${pages.length}`);
    }
    process.stderr.write("\n");
    return { maps, locLines };
}

async function loadWiki(): Promise<Wiki> {
    const file = argValues("--wiki")[0];
    if (file && fs.existsSync(file) && !process.argv.includes("--save")) return JSON.parse(fs.readFileSync(file, "utf8"));
    const loclines = await allRows("bucket('locline').select('page_name','plane','mapid','coordinates')");
    const monsters = await allRows("bucket('infobox_monster').select('page_name','page_name_sub','id')");
    const npcs = await allRows("bucket('infobox_npc').select('page_name','page_name_sub','npc_id','location')");
    const npcPages = new Set<string>([...monsters, ...npcs].map((row) => row.page_name));
    const withLocLines = new Set(loclines.map((row) => row.page_name).filter((page) => npcPages.has(page)));
    // NPC pages for their infobox maps; pages with LocLines for the places they name.
    const infoboxNpcPages = new Set<string>(npcs.map((row) => row.page_name));
    const pages = [...npcPages].filter((page) => withLocLines.has(page) || infoboxNpcPages.has(page));
    const lines = await pageLines(pages);
    const wiki = { loclines, monsters, npcs, npcMaps: Object.fromEntries(Object.entries(lines.maps).filter(([page]) => !withLocLines.has(page))), locLineText: lines.locLines };
    if (file) fs.writeFileSync(file, JSON.stringify(wiki));
    return wiki;
}

/** Page -> its versions in Wiki order, with the cache's ids. */
function versionsByPage(rows: any[], idField: string): Map<string, Version[]> {
    const pages = new Map<string, Version[]>();
    for (const row of rows) {
        const numbers = (row[idField] ?? []).map(Number).filter((id: number) => Number.isInteger(id) && id >= 0);
        const ids = numbers.filter((id: number) => id < CacheDefinitions.getCounts().npcs);
        if (!pages.has(row.page_name)) pages.set(row.page_name, []);
        pages.get(row.page_name)!.push({ label: String(row.page_name_sub ?? row.page_name), ids, numbered: numbers.length > 0 });
    }
    return pages;
}

function wikiSpawns(wiki: Wiki): WikiSpawn[] {
    const spawns: WikiSpawn[] = [];
    const monsterVersions = versionsByPage(wiki.monsters, "id");
    const npcVersions = versionsByPage(wiki.npcs, "npc_id");
    for (const row of wiki.loclines) {
        // LocLine also places scenery and items; only NPC and monster pages count.
        const versions = monsterVersions.get(row.page_name) ?? npcVersions.get(row.page_name);
        if (!versions) continue;
        for (const coordinate of row.coordinates ?? []) {
            const point = parsePoint(coordinate);
            if (point) spawns.push({ page: row.page_name, versions, ...point, level: Number(row.plane) || 0, mapId: row.mapid ?? null });
        }
    }
    for (const [page, lines] of Object.entries(wiki.npcMaps)) {
        const versions = npcVersions.get(page) ?? [];
        const idsByVersion = versionIds(lines);
        for (const map of parseInfoboxMaps(lines)) {
            // Map N is version N's, with the infobox's id N (the data bucket lists versions in its own
            // order, so its rows can't be paired with maps by position).
            const own = map.version !== null ? idsByVersion[map.version] : undefined;
            const ofMap: Version[] = own
                ? [{ label: `${page}#${map.version}`, ids: own.filter((id) => id < CacheDefinitions.getCounts().npcs), numbered: true }]
                : versions;
            for (const point of map.points) spawns.push({ page, versions: ofMap, ...point, level: map.plane, mapId: map.mapId });
        }
    }
    return spawns;
}

function npcName(id: number): string | undefined {
    try { return CacheDefinitions.getNpc(id)?.name ?? undefined; } catch { return undefined; }
}

/** An NPC's name and, for a multinpc parent (live spawns 317 for the Leagues Tutor 316), its variants'. */
function npcNames(id: number): string[] {
    let transforms: number[] = [];
    try { transforms = CacheDefinitions.getNpc(id)?.transforms ?? []; } catch { /* no such npc */ }
    return [id, ...transforms.filter((variant) => variant >= 0)].map(npcName).filter((name): name is string => !!name);
}

/** The id for a page's spawns: --id, a --tag version, the one existing spawns use most, the first. */
function chooseId(page: string, versions: Version[], tags: string[], overrides: Map<string, number>, usage: Map<number, number>): number | null {
    const override = overrides.get(nameKey(page));
    if (override !== undefined) return override;
    const valid = (version: Version) => version.ids.filter((id) => { const name = npcName(id); return name && name !== "null"; });
    const tagged = versions.filter((version) => tags.some((tag) => version.label.toLowerCase().includes(tag)));
    const taggedIds = tagged.flatMap(valid);
    if (taggedIds.length) return taggedIds[0];
    const all = versions.flatMap(valid);
    if (all.length === 0) return null;
    return [...all].sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0))[0];
}

/** Whether the NPC, or any form its multinpc parent shows, offers Attack. */
function isAttackable(id: number): boolean {
    const npc: any = CacheDefinitions.getNpc(id);
    const forms = [id, ...((npc?.transforms ?? []) as number[]).filter((form) => form >= 0)];
    return forms.some((form) => ((CacheDefinitions.getNpc(form) as any)?.actions ?? []).includes("Attack"));
}

/**
 * The radius a new spawn inherits from the existing spawns: a non-attackable NPC's established
 * explicit radius wins over the implicit default; otherwise the effective majority. Undefined
 * means the loader's default.
 */
function wanderRadius(spawns: Spawn[], id: number, name: string): number | undefined {
    return chooseWanderRadius(
        spawns,
        { id, name },
        { walkSeqId: (CacheDefinitions.getNpc(id) as any)?.walkSeqId, attackable: isAttackable(id) },
        nameKey,
    );
}

function readJson(file: string): any {
    return JSON.parse(fs.readFileSync(path.join(DEFINITIONS, file), "utf8"));
}

/** Validate one record per line, retaining authored whitespace on untouched records. */
function spawnLines(source: string, spawns: Spawn[], eol: string): string[] {
    const lines = source.split(eol);
    const fail = () => { throw new Error("npc-spawns.json isn't in the expected one-spawn-per-line format; not touching it"); };
    if (lines[0] !== "[" || lines[lines.length - 1] !== "" || lines[lines.length - 2] !== "]") return fail();
    const rows = lines.slice(1, -2);
    if (spawns.length === 0 && rows.length === 1 && rows[0] === "") return [];
    if (rows.length !== spawns.length) return fail();
    rows.forEach((line, i) => {
        const trimmed = line.trim();
        const json = i < rows.length - 1 ? trimmed.slice(0, -1) : trimmed;
        if (!/^\s+\{/.test(line) || (i < rows.length - 1 && !trimmed.endsWith(","))) return fail();
        try { if (JSON.stringify(JSON.parse(json)) !== JSON.stringify(spawns[i])) return fail(); }
        catch { return fail(); }
    });
    return rows;
}

function renderSpawns(original: Spawn[], rows: string[], updated: Spawn[], additions: Spawn[], eol: string): string {
    const rendered = updated.map((spawn, i) => {
        if (JSON.stringify(spawn) === JSON.stringify(original[i])) return rows[i];
        const indent = rows[i].match(/^\s*/)?.[0] ?? "  ";
        const trailing = rows[i].match(/\s*$/)?.[0] ?? "";
        return `${indent}${JSON.stringify(spawn)}${i < updated.length - 1 ? "," : ""}${trailing}`;
    });
    if (additions.length && rendered.length) rendered[rendered.length - 1] = rendered[rendered.length - 1].replace(/(\s*)$/, ",$1");
    rendered.push(...additions.map((spawn, i) => `  ${JSON.stringify(spawn)}${i < additions.length - 1 ? "," : ""}`));
    return `[${eol}${rendered.join(eol)}${eol}]${eol}`;
}

/** "sx,sy,plane" of each map square -> the place names the Wiki gives spawns in it. */
function placeNames(wiki: Wiki): Map<string, Map<string, number>> {
    const places = new Map<string, Map<string, number>>();
    const note = (x: number, y: number, plane: number, name: string) => {
        if (!name) return;
        const key = `${x >> 6},${y >> 6},${plane}`;
        if (!places.has(key)) places.set(key, new Map());
        places.get(key)!.set(name, (places.get(key)!.get(name) ?? 0) + 1);
    };
    for (const text of Object.values(wiki.locLineText ?? {})) {
        for (const line of parseLocLines(text)) for (const point of line.points) note(point.x, point.y, line.plane, line.location);
    }
    const npcLocation = new Map<string, string>();
    for (const row of wiki.npcs) if (row.location && !npcLocation.has(row.page_name)) npcLocation.set(row.page_name, locationName(row.location));
    for (const [page, lines] of Object.entries(wiki.npcMaps)) {
        for (const map of parseInfoboxMaps(lines)) for (const point of map.points) note(point.x, point.y, map.plane, npcLocation.get(page) ?? "");
    }
    return places;
}

/** A square's name: its most named place, else a neighbour's (up to two squares away). */
function areaName(places: Map<string, Map<string, number>>, sx: number, sy: number, plane: number): string {
    for (let reach = 0; reach <= 2; reach++) {
        const counts = new Map<string, number>();
        for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== reach) continue;
            for (const [name, count] of places.get(`${sx + dx},${sy + dy},${plane}`) ?? []) counts.set(name, (counts.get(name) ?? 0) + count);
        }
        if (counts.size) return [...counts].sort((a, b) => b[1] - a[1])[0][0];
    }
    return "";
}

/** The labels npc-spawn-sync.json gives a spawn, and whether any of them leaves it out. */
function decide(decisions: any, id: number, name: string, page: string, at: { x: number; y: number; level: number }): { flags: string[]; skip: boolean } {
    const found: Decision[] = [];
    for (const area of decisions.boxes ?? []) if (inBoxes(at, [parseBox(area.box)])) found.push(area);
    const category = (CacheDefinitions.getNpc(id) as any)?.category;
    if (decisions.ids?.[id]) found.push(decisions.ids[id]);
    if (decisions.categories?.[category]) found.push(decisions.categories[category]);
    if (decisions.names?.[name]) found.push(decisions.names[name]);
    for (const rule of decisions.namePatterns ?? []) if (new RegExp(rule.pattern, "i").test(name)) found.push(rule);
    for (const rule of decisions.pagePatterns ?? []) if (new RegExp(rule.pattern, "i").test(page)) found.push(rule);
    return { flags: found.map((decision) => decision.label), skip: found.some((decision) => decision.skip) };
}

async function main() {
    const reportFile = argValues("--report")[0];
    const repairIdentities = process.argv.includes("--repair-identities");
    if (reportFile && repairIdentities) throw new Error("Use --repair-identities without --report; its dry run lists repairs and unresolved identities.");
    const boxes = argValues("--box").map(parseBox);
    if (boxes.length === 0 && reportFile) boxes.push(parseBox("0,0,16383,16383"));
    if (boxes.length === 0) throw new Error("Give the area with --box minX,minY,maxX,maxY[,plane]");
    const tags = argValues("--tag").map((tag) => tag.toLowerCase());
    const radius = Number(argValues("--radius")[0] ?? 4);
    const overrides = new Map(argValues("--id").map((pair) => {
        const at = pair.lastIndexOf("=");
        return [nameKey(pair.slice(0, at)), Number(pair.slice(at + 1))] as [string, number];
    }));
    const skipped = new Set(argValues("--skip").map(nameKey));
    const write = process.argv.includes("--write") && !reportFile;
    const decisions = readJson("npc-spawn-sync.json");

    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const spawnsFile = path.resolve(argValues("--spawns")[0] ?? SPAWNS_FILE);
    const source = fs.readFileSync(spawnsFile, "utf8");
    const spawns: Spawn[] = JSON.parse(source);
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const lines = spawnLines(source, spawns, eol);
    const usage = new Map<number, number>();
    for (const spawn of spawns) if (spawn.id !== undefined) usage.set(spawn.id, (usage.get(spawn.id) ?? 0) + 1);

    const wiki = await loadWiki();
    const named = spawns.map((spawn) => ({ ...spawn, name: spawn.name ?? (spawn.id !== undefined ? npcName(spawn.id) : undefined) }));
    // Bring each Wiki map layer into game coordinates (see alignLayers).
    const all = wikiSpawns(wiki).map((spawn) => ({ ...spawn, name: spawn.page }));
    const alignment = alignLayers(all, named);
    const unaligned = decisions.unalignedLayers as Decision;
    const placed: (WikiSpawn & { unaligned?: boolean })[] = all.map((spawn) => {
        const shift = alignment.shiftOf(spawn);
        if (!shift) return { ...spawn, unaligned: true };
        return { ...spawn, x: spawn.x + shift.dx, y: spawn.y + shift.dy, level: spawn.level + shift.dz };
    });
    const unresolved: WikiSpawn[] = [];
    const candidates: Candidate[] = [];
    const identityEvidence: Candidate[] = [];
    // The Wiki can list one spawn twice: on another map layer drawing the place again (Kalrag's
    // Lair "during Song of the Elves", which aligns onto the same tiles), on two pages of one NPC
    // (Sheep and Sheep (Zanaris)), or in two LocLines of one page (the Stronghold's minotaurs, once
    // per level). So a tile counts once per NPC name.
    const listed = new Set<string>();
    for (const spawn of placed) {
        if (!inBoxes(spawn, boxes) || skipped.has(nameKey(spawn.page))) continue;
        // Repairs retain raw alternatives before add-only ID selection/deduplication.
        if (repairIdentities) for (const id of new Set<number>(spawn.versions.flatMap(version => version.ids))) {
            const name = npcName(id);
            if (!name || name === "null" || skipped.has(nameKey(name))) continue;
            const entry: Candidate = { level: spawn.level, name, x: spawn.x, y: spawn.y, id,
                page: spawn.page, ...decide(decisions, id, name, spawn.page, spawn) };
            if (spawn.unaligned) {
                entry.flags.push(`${unaligned.label} (${spawn.mapId})`);
                entry.skip ||= unaligned.skip;
            }
            identityEvidence.push(entry);
        }
        const id = chooseId(spawn.page, spawn.versions, tags, overrides, usage);
        if (id === null) {
            // Historical and event pages have no real ids; only newer-than-cache NPCs are worth a line.
            if (spawn.versions.some((version) => version.numbered)) unresolved.push(spawn);
            continue;
        }
        const name = npcName(id) ?? spawn.page;
        if (skipped.has(nameKey(name))) continue;
        const tile = `${nameKey(name)}@${spawn.x},${spawn.y},${spawn.level}`;
        if (listed.has(tile)) continue;
        listed.add(tile);
        const entry: Candidate = { level: spawn.level, name, x: spawn.x, y: spawn.y, id, source: "wiki", page: spawn.page, ...decide(decisions, id, name, spawn.page, spawn) };
        if (spawn.unaligned) {
            entry.flags.push(`${unaligned.label} (${spawn.mapId})`);
            entry.skip ||= unaligned.skip;
        }
        const radiusOf = wanderRadius(spawns, id, name);
        if (radiusOf !== undefined) entry.wanderRadius = radiusOf;
        candidates.push(entry);
    }
    const only = argValues("--only");
    const eligible = (spawn: Candidate) => !spawn.skip && (only.length === 0 || only.some((label) => spawn.flags.includes(label)));
    const identities = repairIdentities
        ? reconcileIdentities(spawns, identityEvidence.filter(eligible), npcNames, radius, (spawn: Spawn) => inBoxes(spawn, boxes))
        : { spawns, repairs: [], unresolved: [] };
    const existing = identities.spawns.filter((spawn: Spawn) => inBoxes(spawn, boxes)).map((spawn: Spawn) =>
        ({ ...spawn, name: spawn.name ?? (spawn.id !== undefined ? npcName(spawn.id) : undefined) }));
    const plan = planAdditions(candidates, existing, radius);
    const add: Candidate[] = plan.add.filter(eligible);

    const drops = readJson("npc-drops.json").npcs ?? {};
    const stats = readJson("monsters-complete.json");
    const lacksLoot = (id: number) => (Number((CacheDefinitions.getNpc(id) as any)?.combatLevel) || 0) > 0 && (!drops[id] || !stats[id]);

    if (reportFile) {
        writeReport(reportFile, wiki, plan.add, unresolved, candidates, existing, lacksLoot, alignment.layers);
        return;
    }

    console.log(`Wiki spawns in the area: ${candidates.length}; existing spawns: ${existing.length}; to add: ${add.length}`);
    for (const repair of identities.repairs) console.log(`  Repair ${repair.name} at ${repair.x},${repair.y},${repair.level}: id ${repair.previousId} -> ${repair.id} (Wiki ${repair.page}, confirmed by cache)`);
    for (const row of identities.unresolved) console.log(`  Unresolved identity ${row.name} (${row.id}) at ${row.x},${row.y},${row.level}: ${row.reason}`);
    for (const row of plan.report) {
        const adding = add.filter((spawn) => nameKey(spawn.name) === nameKey(row.name) && spawn.level === row.level);
        const ids = [...new Set(adding.map((spawn) => spawn.id))];
        const left = plan.add.filter((spawn: Candidate) => spawn.skip && nameKey(spawn.name) === nameKey(row.name) && spawn.level === row.level);
        const flags = [...new Set(plan.add.filter((spawn: Candidate) => nameKey(spawn.name) === nameKey(row.name)).flatMap((spawn: Candidate) => spawn.flags))];
        console.log(`  ${row.name}${row.level ? ` (plane ${row.level})` : ""}: Wiki ${row.wiki}, existing ${row.existing}, add ${adding.length}`
            + `${ids.length ? ` (id ${ids.join(", ")})` : ""}${left.length ? `, ${left.length} left out` : ""}${flags.length ? ` [${flags.join(", ")}]` : ""}`);
    }
    if (unresolved.length) console.log(`Not in this cache (newer NPCs): ${[...new Set(unresolved.map((spawn) => spawn.page))].sort().join(", ")}`);
    for (const id of [...new Set<number>(add.map((spawn) => spawn.id!))].filter(lacksLoot)) {
        console.log(`  ${npcName(id)} (${id}) fights but has no ${!drops[id] ? "drop table" : ""}${!drops[id] && !stats[id] ? " or " : ""}${!stats[id] ? "stats" : ""}: rerun the drop dumper`);
    }

    if (!write) { console.log(add.length || identities.repairs.length ? "Dry run: add --write to apply." : "Nothing to add or repair."); return; }
    const written = add.map(({ page, flags, skip, ...spawn }) => spawn);
    if (written.length || identities.repairs.length) fs.writeFileSync(spawnsFile, renderSpawns(spawns, lines, identities.spawns, written, eol));
    console.log(`Wrote ${written.length} spawn(s) to npc-spawns.json.`);
    if (repairIdentities) console.log(`Repaired ${identities.repairs.length} spawn identity/identities; ${identities.unresolved.length} unresolved.`);
}

/**
 * Every map square with gaps: its place name, how many spawns tsps and the Wiki have, and the
 * missing ones by NPC with their labels ("Fights without drops", "Not in this cache", and the
 * decisions' labels; `skip` when the decisions leave them out).
 */
function writeReport(file: string, wiki: Wiki, missing: Candidate[], unresolved: WikiSpawn[], candidates: Candidate[], existing: Spawn[], lacksLoot: (id: number) => boolean, layers: any) {
    const places = placeNames(wiki);
    const squares = new Map<string, any>();
    const squareFor = (spawn: { x: number; y: number; level: number }) => {
        const key = `${squareOf(spawn)},${spawn.level}`;
        if (!squares.has(key)) {
            const [sx, sy] = [spawn.x >> 6, spawn.y >> 6];
            squares.set(key, { square: key, x: sx << 6, y: sy << 6, plane: spawn.level, area: areaName(places, sx, sy, spawn.level), existing: 0, wiki: 0, missing: new Map() });
        }
        return squares.get(key);
    };
    const counted = (spawn: { x: number; y: number; level: number }) => squares.get(`${squareOf(spawn)},${spawn.level}`);
    for (const spawn of missing) {
        const entry = squareFor(spawn);
        const key = `${spawn.id}`;
        const flags = [...spawn.flags, ...(lacksLoot(spawn.id!) ? ["Fights without drops"] : [])];
        const row = entry.missing.get(key) ?? { name: spawn.name, id: spawn.id, page: spawn.page, count: 0, flags, skip: spawn.skip, at: [] };
        row.count++;
        if (row.at.length < 12) row.at.push([spawn.x, spawn.y]);
        entry.missing.set(key, row);
    }
    for (const spawn of unresolved) {
        const entry = squareFor(spawn);
        const row = entry.missing.get(`page:${spawn.page}`) ?? { name: spawn.page, id: null, page: spawn.page, count: 0, flags: ["Not in this cache"], skip: true, at: [] };
        row.count++;
        if (row.at.length < 12) row.at.push([spawn.x, spawn.y]);
        entry.missing.set(`page:${spawn.page}`, row);
    }
    for (const spawn of candidates) { const entry = counted(spawn); if (entry) entry.wiki++; }
    for (const spawn of unresolved) { const entry = counted(spawn); if (entry) entry.wiki++; }
    for (const spawn of existing) { const entry = counted(spawn); if (entry) entry.existing++; }
    const rows = [...squares.values()].map((entry) => ({ ...entry, missing: [...entry.missing.values()].sort((a: any, b: any) => b.count - a.count) }));
    const report = {
        generated: new Date().toISOString().slice(0, 10),
        layers,
        squares: rows.sort((a, b) => b.missing.reduce((n: number, r: any) => n + r.count, 0) - a.missing.reduce((n: number, r: any) => n + r.count, 0)),
    };
    fs.writeFileSync(file, JSON.stringify(report));
    const total = (filter: (row: any) => boolean) => rows.reduce((n, entry) => n + entry.missing.filter(filter).reduce((m: number, row: any) => m + row.count, 0), 0);
    console.log(`Wrote ${file}: ${rows.length} map squares with gaps, ${total(() => true)} missing spawns (${total((row) => !row.skip)} not left out by the decisions).`);
}

main().catch((error) => { console.error(error); process.exit(1); });
