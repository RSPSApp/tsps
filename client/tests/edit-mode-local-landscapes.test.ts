import assert from "node:assert/strict";
import { createLocalLandscapeData } from "../game/plugins/editmode/generation/landscapes/LocalLandscape";
import { createRegionPack, parseRegionPack } from "../game/plugins/editmode/RegionPack";
const { planLandscape, buildPacks, overview } = require("../game/plugins/editmode/generation/landscapes/LandscapePlans");

async function main() {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("local landscape generation must not fetch server APIs"); };
    let revision = 242;
    const references = new Map<number, ReturnType<typeof parseRegionPack>>();
    const occupied = new Set<number>();
    let occupancyReads = 0;
    const local = createLocalLandscapeData({
        revision: () => revision,
        readRegion: async id => references.get(id),
        occupiedRegionIds: () => { occupancyReads++; return [...occupied]; },
        getObject: () => undefined,
    });
    try {
        assert.equal((await local()).landforms.length, 6);
        assert.equal(occupancyReads, 0, "loading the catalog does not scan the map cache for occupied regions");
        await local("/scenery?biome=forest");
        assert.equal(occupancyReads, 0, "loading a scenery palette does not scan map occupancy");
        let definitionsReady = false;
        const scenery = createLocalLandscapeData({
            revision: () => 242, readRegion: async () => undefined, occupiedRegionIds: () => [],
            settled: async () => { definitionsReady = true; },
            getObject: id => definitionsReady && [1276, 319].includes(id) ? {
                models: [[1]], name: id === 1276 ? "Oak" : "Grass", sizeX: 1, sizeY: 1,
                types: [id === 1276 ? 10 : 22], actions: [],
            } : undefined,
        });
        assert.deepEqual((await scenery("/scenery?biome=forest")).map((item: { id: number }) => item.id), [1276, 319],
            "bundled native scenery retries sparse object definitions after cache downloads settle");

        const query = "x=4096&y=4096&width=64&height=64&landform=island&biome=tropical&seed=91&scenery=false";
        const first = await local("/scene?" + query);
        const again = await local("/scene?" + query);
        assert.deepEqual(first, again, "a seed produces identical preview pixels and region bytes offline");
        assert.equal(first.packs.length, 1);
        assert.ok(first.packs[0].data instanceof Uint8Array, "local generation keeps binary packs instead of HTTP base64 encoding");
        const cloned = structuredClone(first);
        assert.ok(cloned.packs[0].data instanceof Uint8Array, "worker structured cloning retains the pack bytes");
        assert.deepEqual(cloned, first);
        const pack = parseRegionPack(first.packs[0].data);
        assert.equal(pack.regionId, 16448);
        assert.ok(pack.terrainData.length > 16384, "revision 242 keeps wide terrain opcodes");
        const reroll = await local("/preview?" + query.replace("seed=91", "seed=92"));
        assert.notEqual(reroll.preview.pixels, first.preview.pixels);
        occupied.add(16448);
        assert.deepEqual((await local("/scene?" + query)).occupied, [16448]);
        assert.deepEqual((await local("/scene?" + query)).packs, [], "occupied sites never stage generated packs");
        await assert.rejects(local("/packs?" + query), /Already used/);
        const site = await local("/site?width=64&height=64&skip=17486");
        assert.notEqual(((site.x >> 6) << 8) | (site.y >> 6), 17486);
        occupied.clear();

        // Expansion reads the neighbouring region snapshot rather than a server-side world.
        const west = 16448 - 256;
        references.set(west, parseRegionPack(createRegionPack(west, true, 48, false)));
        occupied.add(west);
        const extension = await local("/scene?x=4096&y=4096&width=64&height=64&landform=hills&biome=auto&extend=true&scenery=false");
        assert.deepEqual(extension.sourceRegions, [west]);
        assert.equal(extension.packs.length, 1);
        const captured = await local("/scene?x=4160&y=4096&width=64&height=64&landform=hills&biome=forest&extend=true&scenery=false&source=" +
            encodeURIComponent("x=4096&y=4096&width=64&height=64&landform=hills&biome=forest&seed=4&scenery=false"));
        assert.ok(captured.sourceRegions.includes(16448), "an unsaved source draft can supply expansion edges");

        // The same editor-owned planner is reused by server adapters without I/O in its algorithm.
        const core = { CachePipeline: { getActive: () => ({ revision }) }, CacheMaps: { getRegion: () => undefined },
            MapRegionReplacementManager: { getReplacementMapData: () => undefined } };
        const plan = planLandscape(core, { x: 4096, y: 4096, width: 64, height: 64, landform: "river", biome: "forest", seed: 7, scenery: false });
        assert.equal(buildPacks(core, plan)[0].pack instanceof Uint8Array, true);
        assert.equal(overview(plan).seed, 7);
        revision = 200;
        const narrow = await local("/scene?x=4096&y=4096&width=64&height=64&landform=hills&biome=forest&scenery=false");
        const narrowPack = parseRegionPack(narrow.packs[0].data);
        assert.ok(narrowPack.terrainData.length < pack.terrainData.length, "older caches retain narrow terrain encoding");
        await assert.rejects(local("/scene?x=1&y=2&width=9999"), /Width/);
        console.log("Offline landscape previews, packs, seeds, cache revisions, occupied sites and extension sources pass");
    } finally {
        globalThis.fetch = originalFetch;
    }
}
void main();
