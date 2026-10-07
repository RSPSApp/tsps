// Lists where locs (objects) are placed in the active OSRS cache's map.
//
//   yarn dump:loc 16510                 # every placement of loc 16510
//   yarn dump:loc 16510,16511 "Rocks"   # several ids, and every loc with that exact name
//   yarn dump:loc --json 16510          # one JSON object per line instead of text
//
// Needs the cache in server/caches - run `yarn ensure-cache` first. Reads every map square,
// so a run takes a minute.
//
// OUTPUT
// One line per placement, as the server places it (the same decoding and bridge-plane rule
// as RegionManager.loadMapFiles):
//
//   loc 16510 "Stepping stone" 3150,3363,0 shape=10 rotation=0 size=1x1 ops=Jump-onto
//
//   shape     The loc's shape (0-3 walls, 4-8 wall decorations, 9 diagonal wall, 10-11
//             scenery, 12-21 roofs, 22 ground decoration).
//   rotation  0-3, quarter turns clockwise from west-facing.
//   size      Its footprint in tiles, before rotation.
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
import { RegionManager } from "../src/main/typescript/elvarg/game/collision/RegionManager";

type Placement = { id: number; x: number; y: number; z: number; shape: number; rotation: number };

function locName(id: number): string {
    return (CacheDefinitions.getObject(id)?.name ?? "").replace(/<[^>]+>/g, "");
}

function targetIds(args: string[]): Set<number> {
    const ids = new Set<number>();
    const names = new Set<string>();
    for (const arg of args.flatMap((value) => value.split(","))) {
        if (/^\d+$/.test(arg.trim())) ids.add(Number(arg));
        else if (arg.trim()) names.add(arg.trim().toLowerCase());
    }
    if (names.size > 0) {
        const count = CacheDefinitions.getCounts().objects;
        for (let id = 0; id < count; id++) {
            if (names.has(locName(id).toLowerCase())) ids.add(id);
        }
    }
    return ids;
}

async function main() {
    const args = process.argv.slice(2);
    const json = args.includes("--json");
    const filters = args.filter((arg) => arg !== "--json");
    if (filters.length === 0) {
        console.error("usage: yarn dump:loc [--json] <id|name>[,<id|name>...]");
        process.exit(1);
    }
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    RegionManager.init();
    const ids = targetIds(filters);
    if (ids.size === 0) {
        console.error("no loc matches");
        process.exit(1);
    }

    const found: Placement[] = [];
    const addObject = RegionManager.addObject;
    RegionManager.addObject = (id: number, x: number, y: number, z: number, shape: number, rotation: number) => {
        if (ids.has(id)) found.push({ id, x, y, z, shape, rotation });
    };
    try {
        for (const regionId of RegionManager.regions.keys()) {
            RegionManager.loadMapFiles(((regionId >> 8) & 0xff) * 64, (regionId & 0xff) * 64, false);
        }
    } finally {
        RegionManager.addObject = addObject;
    }

    found.sort((a, b) => a.id - b.id || a.z - b.z || a.x - b.x || a.y - b.y);
    for (const placement of found) {
        const definition = CacheDefinitions.getObject(placement.id);
        const ops = (definition?.actions ?? []).filter(Boolean);
        if (json) {
            console.log(JSON.stringify({ ...placement, name: locName(placement.id), sizeX: definition?.sizeX ?? 1, sizeY: definition?.sizeY ?? 1, ops }));
            continue;
        }
        console.log(
            `loc ${placement.id} "${locName(placement.id)}" ${placement.x},${placement.y},${placement.z}` +
            ` shape=${placement.shape} rotation=${placement.rotation} size=${definition?.sizeX ?? 1}x${definition?.sizeY ?? 1}` +
            ` ops=${ops.join("|") || "-"}`,
        );
    }
    console.error(`${found.length} placements of ${ids.size} loc(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
