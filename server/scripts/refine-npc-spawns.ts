// Refines existing NPC spawns in data/definitions/npc-spawns.json from live OSRS captures: the
// sites file written by the capture index (`python3 rsprox_index.py npc-sites --out sites.json`).
//
//   yarn refine:npc-spawns --sites sites.json            # print what it would change
//   yarn refine:npc-spawns --sites sites.json --write    # change it
//
// Options:
//   --sites <file>       the capture sites (required)
//   --spawns <file>      the spawn file to refine (default data/definitions/npc-spawns.json)
//   --reach <tiles>      how far a spawn may be from its site (default 2)
//   --min-watched <n>    sightings a site needs (default 3)
//   --min-facing <share> how many standing sightings must agree on a facing (default 0.5)
//   --only still|facing|wander  make only one kind of change
//
// A spawn is paired with the capture site of the same NPC nearest to it (see
// npc-spawn-refine.cjs). When the NPC stood still in at least 90% of its sightings, the spawn
// stops wandering (wanderRadius 0), and when more than half of those sightings agree on its facing
// (NPCs that serve players turn towards them, so agreement is lower for them) and that differs
// from what it gets now, it gets that direction. An NPC that walks and can't be attacked gets the
// wanderRadius 90% of its sightings stayed within (at least 1), when that's less than it has now
// (the loader's default is 5). Sites the capture
// index labels (followers, roaming NPCs, props, instances, special worlds) change nothing, except
// that an "unnamed" multinpc parent (Aubury) still gets its wanderRadius. Nothing is added or removed.
//
// Needs the cache in server/caches - run `yarn ensure-cache` first.
import * as fs from "fs";
import path = require("path");

import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";

const { DIRECTIONS, pairSpawns, changesFor } = require("./npc-spawn-refine.cjs");

const DEFAULT_SPAWNS = path.resolve(__dirname, "../data/definitions/npc-spawns.json");
/** The cache's spawnDirection counts from north-west; a spawn's direction from south-west (as the loader converts it). */
const CACHE_TO_SPAWN_DIRECTION = [5, 6, 7, 3, 4, 0, 1, 2];

function argValue(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function format(spawns: any[]): string {
    return `[\n${spawns.map((spawn) => `  ${JSON.stringify(spawn)}`).join(",\n")}\n]\n`;
}

/** Changes a spawn's direction and wanderRadius in place, or adds them at the end as existing entries do. */
function applied(spawn: any, changes: { wanderRadius?: number; direction?: number }): any {
    const out: any = { ...spawn };
    if (changes.direction !== undefined) out.direction = changes.direction;
    if (changes.wanderRadius !== undefined) out.wanderRadius = changes.wanderRadius;
    return out;
}

/** Whether the NPC, or any form its multinpc parent shows, offers Attack. */
function isAttackable(id: number): boolean {
    const npc: any = CacheDefinitions.getNpc(id);
    const forms = [id, ...((npc?.transforms ?? []) as number[]).filter((form) => form >= 0)];
    return forms.some((form) => ((CacheDefinitions.getNpc(form) as any)?.actions ?? []).includes("Attack"));
}

async function main() {
    const sitesFile = argValue("--sites");
    if (!sitesFile) throw new Error("Give the capture sites with --sites <file> (rsprox_index.py npc-sites)");
    const spawnsFile = path.resolve(argValue("--spawns") ?? DEFAULT_SPAWNS);
    const reach = Number(argValue("--reach") ?? 2);
    const minWatched = Number(argValue("--min-watched") ?? 3);
    const minFacing = Number(argValue("--min-facing") ?? 0.5);
    const only = argValue("--only");
    const write = process.argv.includes("--write");

    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const source = fs.readFileSync(spawnsFile, "utf8");
    const spawns: any[] = JSON.parse(source);
    if (format(spawns) !== source) throw new Error(`${spawnsFile} isn't in the expected one-spawn-per-line format; not touching it`);
    const sites = JSON.parse(fs.readFileSync(sitesFile, "utf8")).sites.filter((site: any) => Number.isInteger(site.id));

    const pairs = pairSpawns(spawns.filter((spawn) => Number.isInteger(spawn.id)), sites, reach);
    const changed = new Map<any, any>();
    for (const { spawn, site } of pairs) {
        const cacheDirection = (CacheDefinitions.getNpc(spawn.id) as any)?.spawnDirection ?? 6;
        const changes = changesFor(spawn, site, {
            minWatched, facing: minFacing, defaultDirection: CACHE_TO_SPAWN_DIRECTION[cacheDirection & 7], attackable: isAttackable(spawn.id),
        });
        const wanders = (changes.wanderRadius ?? 0) > 0;
        if (only === "still") { delete changes.direction; if (wanders) delete changes.wanderRadius; }
        if (only === "facing") delete changes.wanderRadius;
        if (only === "wander") { delete changes.direction; if (!wanders) delete changes.wanderRadius; }
        if (Object.keys(changes).length) changed.set(spawn, { changes, site });
    }

    const stillCount = [...changed.values()].filter((entry) => entry.changes.wanderRadius === 0).length;
    const wanderCount = [...changed.values()].filter((entry) => (entry.changes.wanderRadius ?? 0) > 0).length;
    const facingCount = [...changed.values()].filter((entry) => entry.changes.direction !== undefined).length;
    console.log(`Spawns paired with a capture site: ${pairs.length} of ${spawns.length}; to change: ${changed.size}`
        + ` (stand still: ${stillCount}, wander range: ${wanderCount}, facing: ${facingCount})`);
    const byName = new Map<string, { still: number; wander: Map<number, number>; facing: Map<string, number> }>();
    for (const [spawn, { changes }] of changed) {
        const row = byName.get(spawn.name) ?? { still: 0, wander: new Map(), facing: new Map() };
        if (changes.wanderRadius === 0) row.still++;
        if ((changes.wanderRadius ?? 0) > 0) row.wander.set(changes.wanderRadius, (row.wander.get(changes.wanderRadius) ?? 0) + 1);
        if (changes.direction !== undefined) row.facing.set(DIRECTIONS[changes.direction], (row.facing.get(DIRECTIONS[changes.direction]) ?? 0) + 1);
        byName.set(spawn.name, row);
    }
    const size = (row: { still: number; wander: Map<number, number>; facing: Map<string, number> }) => row.still + row.wander.size + row.facing.size;
    for (const [name, row] of [...byName].sort((a, b) => size(b[1]) - size(a[1])).slice(0, 40)) {
        const parts = [
            row.still ? `stand still ${row.still}` : "",
            row.wander.size ? `wander ${[...row.wander].map(([radius, count]) => `${count}x${radius}`).join(", ")}` : "",
            row.facing.size ? `face ${[...row.facing].map(([direction, count]) => `${count} ${direction}`).join(", ")}` : "",
        ].filter(Boolean);
        console.log(`  ${name}: ${parts.join("; ")}`);
    }
    if (byName.size > 40) console.log(`  ... and ${byName.size - 40} more NPCs`);

    if (!write) { console.log(changed.size ? "Dry run: add --write to change them." : "Nothing to change."); return; }
    fs.writeFileSync(spawnsFile, format(spawns.map((spawn) => (changed.has(spawn) ? applied(spawn, changed.get(spawn).changes) : spawn))));
    console.log(`Changed ${changed.size} spawn(s) in ${path.relative(process.cwd(), spawnsFile)}.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
