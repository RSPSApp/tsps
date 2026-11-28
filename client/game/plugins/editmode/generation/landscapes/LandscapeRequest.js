const planner = require("./LandscapePlans");
const { normalizeTerrainBiome } = require("./TerrainBiome");
const presets = { forest: normalizeTerrainBiome(require("./data/terrain-biomes/forest.json")) };

function landscapeOptions(query, depth = 0) {
    const options = {};
    for (const key of ["x", "y", "width", "height", "seed", "relief", "foliage", "lakes", "edgeBlend"]) {
        if (query.has(key)) options[key] = Number(query.get(key));
    }
    for (const key of ["landform", "biome", "size"]) if (query.has(key)) options[key] = query.get(key);
    for (const key of ["scenery", "extend"]) if (query.has(key)) options[key] = query.get(key) !== "false";
    if (query.has("squares")) options.squares = query.get("squares").split(",").map(Number);
    if (query.has("source")) {
        if (depth >= 2) throw new Error("Too many nested landscape sources");
        options.source = landscapeOptions(new URLSearchParams(query.get("source")), depth + 1);
    }
    return options;
}

function parseLandscapeRequest(part) {
    const url = new URL(part || "/", "https://editor.invalid");
    const operation = url.pathname.replace(/^\//, "");
    const options = landscapeOptions(url.searchParams);
    const skip = new Set((url.searchParams.get("skip") ?? "").split(",").filter(value => /^\d{1,5}$/.test(value)).map(Number));
    return { operation, options, skip };
}

function coreFor(snapshot) {
    const regions = new Map(snapshot.regions);
    const objects = new Map(snapshot.objects);
    const occupied = new Set(snapshot.occupied);
    return {
        CachePipeline: { getActive: () => ({ revision: snapshot.revision }) },
        CacheMaps: { getRegion: id => regions.get(id), getRegionIds: () => [...occupied], getArchiveIds: id => occupied.has(id) },
        CacheDefinitions: { getObject: id => objects.get(id) },
        MapRegionReplacementManager: {
            MAX_PACKET_PAYLOAD: 65533,
            getRegionIds: () => [...occupied],
            getReplacementMapData: id => regions.get(id),
        },
        loadTerrainBiome: id => presets[id],
    };
}

function runLandscapeRequest(snapshot, part) {
    const { operation, options, skip } = parseLandscapeRequest(part);
    const core = coreFor(snapshot);
    if (!operation) return planner.catalog();
    if (operation === "occupied") return [...new Set(snapshot.occupied)].sort((a, b) => a - b);
    if (operation === "scenery") return planner.sampleBiome(core, options.biome).scenery
        .filter(({ habitat }) => habitat !== "water").map(({ id, name }) => ({ id, name }));
    if (operation === "site") return planner.findEmptySite(core, options, skip);
    if (!["preview", "scene", "packs"].includes(operation)) throw new Error("Unknown landscape operation");
    const plan = planner.planLandscape(core, options);
    const occupied = planner.occupiedRegions(core, plan);
    if (operation === "preview") return { ...planner.overview(plan), occupied };
    if (operation === "packs" && occupied.length) throw new Error(`Choose empty map squares. Already used: ${occupied.join(", ")}`);
    const packs = occupied.length ? [] : planner.buildPacks(core, plan).map(({ regionId, pack }) => ({ regionId, data: pack }));
    return operation === "packs" ? packs : { ...planner.overview(plan), occupied, packs };
}

/** Cache regions needed to reproduce the reference palette and any extension seams. */
function landscapeRegionInputs(part) {
    const { operation, options } = parseLandscapeRequest(part);
    if (!["scenery", "preview", "scene", "packs"].includes(operation)) return [];
    const ids = new Set();
    const add = (id) => { if (id >= 0 && id <= 65535) ids.add(id); };
    const collect = (input) => {
        const biomes = !input.biome || input.biome === "auto" ? planner.catalog().biomes.map(({ id }) => id) : [input.biome];
        for (const biome of biomes) {
            if (!planner.catalog().biomes.some(({ id }) => id === biome)) throw new Error("Choose a supported biome");
            for (const id of planner.referenceRegionIds(biome)) add(id);
        }
        if (operation !== "scenery") {
            const plan = planner.normalize({ ...input, biome: input.biome === "auto" ? "forest" : input.biome });
            if (plan.extend) {
                const squares = plan.squares ?? Array.from({ length: ((plan.x + plan.width - 1) >> 6) - (plan.x >> 6) + 1 }, (_, ix) =>
                    Array.from({ length: ((plan.y + plan.height - 1) >> 6) - (plan.y >> 6) + 1 }, (_, iy) => ((plan.x >> 6) + ix) * 256 + (plan.y >> 6) + iy)).flat();
                for (const id of squares) {
                    const x = id >> 8, y = id & 255;
                    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && nx < 256 && ny >= 0 && ny < 256 && (ny >= 100) === (y >= 100)) add(nx * 256 + ny);
                    }
                }
            }
            if (input.source) collect(input.source);
        }
    };
    collect(options);
    return [...ids];
}

function landscapeObjectIds(regions) {
    const ids = new Set(planner.extraSceneryIds);
    for (const preset of Object.values(presets)) for (const id of [...preset.treeIds, ...preset.groundDecorationIds]) ids.add(id);
    for (const { objectData: data } of regions) {
        if (!data) continue;
        let offset = 0, id = -1;
        const smart = () => {
            if (offset >= data.length) throw new Error("Truncated landscape object data");
            const first = data[offset++];
            if (first < 128) return first;
            if (offset >= data.length) throw new Error("Truncated landscape object data");
            return (first << 8 | data[offset++]) - 32768;
        };
        while (offset < data.length) {
            let delta = 0, part;
            do { part = smart(); delta += part; } while (part === 32767);
            if (!delta) break;
            id += delta;
            ids.add(id);
            while (smart()) {
                if (offset >= data.length) throw new Error("Truncated landscape object data");
                offset++;
            }
        }
    }
    return [...ids];
}

module.exports = { runLandscapeRequest, landscapeRegionInputs, landscapeObjectIds };
