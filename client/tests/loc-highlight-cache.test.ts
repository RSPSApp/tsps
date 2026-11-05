import { strict as assert } from "node:assert";
import { buildLocModelHighlightParts, buildLocModelHighlightTriangles } from "../render/render/interact/highlight2";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import type { LocHighlightTarget } from "../render/render/constants";

function fixture() {
    let modelLoads = 0, triangleBuilds = 0, missing = false, deck = 0, displacement = 16;
    let currentType: any = { id: 1, sizeX: 1, sizeY: 1, seqId: -1 };
    const sourceType: any = { ...currentType, transforms: [1, 2], transform: () => currentType };
    const model = { verticesX: [0, 128, 0], verticesY: [0, 0, -128], verticesZ: [0, 0, 128] };
    const frame = {};
    const loader: any = {
        getModelAnimated: () => { modelLoads++; return missing ? undefined : model; },
        seqTypeLoader: { load: () => ({ isSkeletalSeq: () => false, frameIds: [1, 2] }) },
        seqFrameLoader: { load: () => frame },
    };
    const makeMap = () => ({
        mapX: 50, mapY: 50, interactionPlane: -1, borderSize: 0, heightMapSize: 65,
        heightMapData: new Int16Array(4 * 65 * 65), locsAnimated: [] as any[],
        tileLocIdsByLevel: [new Int32Array([1])],
        tileLocTypeRotByLevel: [new Int32Array([10])],
    });
    let map = makeMap();
    const host: any = {
        osrsClient: {
            locTypeLoader: { load: (id: number) => id === 99 ? { decorDisplacement: displacement } : sourceType },
            varManager: {},
        },
        mapManager: { getMapForWorldTile: () => map },
        getPreferredMapForWorldTile: () => map,
        getMapLocalTile: (_map: any, x: number, y: number) => ({ x: x - 3200, y: y - 3200 }),
        getInteractLocModelLoader: () => loader,
        getWorldEntityDeckHeight: () => deck,
        getLocIdsAtTileAllLevels: () => [{ id: 99, level: 0, typeRot: LocModelType.WALL }],
        hasNoVisibleFaces: () => false,
        buildModelTrianglePoints: (m: any, place: (i: number) => { x: number; y: number; z: number }) => {
            triangleBuilds++;
            return m.verticesX.map((_: number, i: number) => { const p = place(i); return [p.x, p.y, p.z]; });
        },
    };
    const target: LocHighlightTarget = { kind: "loc", locId: 1, tileX: 3208, tileY: 3208, plane: 0,
        locModelType: LocModelType.NORMAL, locRotation: 0 };
    return { host, target, loader, makeMap,
        counts: () => ({ modelLoads, triangleBuilds }),
        map: () => map, replaceMap: () => { map = makeMap(); },
        type: () => currentType, transform: () => { currentType = { ...currentType, id: 2 }; },
        missing: (value: boolean) => { missing = value; },
        deck: (value: number) => { deck = value; },
        displacement: (value: number) => { displacement = value; },
    };
}

// Hull and outline requests share the expensive world-space geometry, including corners' flattening.
{
    const f = fixture();
    f.target.locModelType = LocModelType.WALL_CORNER;
    const parts = buildLocModelHighlightParts(f.host, f.target)!;
    const triangles = buildLocModelHighlightTriangles(f.host, { ...f.target });
    assert.equal(buildLocModelHighlightParts(f.host, { ...f.target }), parts);
    assert.equal(buildLocModelHighlightTriangles(f.host, { ...f.target }), triangles);
    assert.deepEqual(f.counts(), { modelLoads: 2, triangleBuilds: 2 }, "one build per corner model, shared across both drawing paths");
}

// Every input that changes placement or animation invalidates the reused world points.
{
    const f = fixture();
    let previous = buildLocModelHighlightParts(f.host, f.target);
    const changed = (label: string) => {
        const next = buildLocModelHighlightParts(f.host, f.target);
        assert.notEqual(next, previous, label);
        assert.equal(buildLocModelHighlightParts(f.host, { ...f.target }), next, `${label}: stable afterwards`);
        previous = next;
    };
    f.target.locRotation = 1; changed("rotation");
    f.target.tileX++; changed("tile");
    f.target.plane = 1; changed("plane");
    f.transform(); changed("multiloc transform");
    f.replaceMap(); changed("map replacement");
    f.map().heightMapData.fill(16); changed("terrain height edit in place");
    f.map().interactionPlane = 0; changed("world entity overlay");
    f.deck(128); changed("world entity deck height");
    f.type().seqId = 10;
    const anim = { id: 1, x: (f.target.tileX - 3200) * 128 + 64, y: (f.target.tileY - 3200) * 128 + 64,
        level: 1, frame: 0, seqType: { id: 10 } };
    f.map().locsAnimated.push(anim); changed("animation started");
    anim.frame = 1; changed("animation frame");
    f.map().tileLocIdsByLevel[0] = new Int32Array([2]); changed("scene loc data replaced");
    f.target.plane = 0;
    f.target.locModelType = LocModelType.WALL_DECORATION_OUTSIDE;
    changed("wall decoration");
    const before = previous!;
    f.displacement(32); changed("wall displacement");
    assert.notDeepEqual(previous, before, "displacement changes world vertices");
    f.host.osrsClient.locTypeLoader = { ...f.host.osrsClient.locTypeLoader }; changed("definition loader replacement");
    f.host.getInteractLocModelLoader = () => ({ ...f.loader });
    const next = buildLocModelHighlightParts(f.host, f.target);
    assert.notEqual(next, previous, "model loader replacement");
}

// A finished growth animation highlights its grown base pose.
{
    const f = fixture();
    f.type().seqId = 1096;
    f.map().locsAnimated.push({id: 1, x: 8 * 128 + 64, y: 8 * 128 + 64,
        level: 0, frame: 0, seqType: undefined});
    const load = f.loader.getModelAnimated;
    let selectedSequence: number | undefined;
    f.loader.getModelAnimated = (...args: any[]) => { selectedSequence = args[3]; return load(...args); };
    assert.ok(buildLocModelHighlightParts(f.host, f.target));
    assert.equal(selectedSequence, -1, "a finished growth highlight uses the grown base pose");
}

// Loading failures must be retried instead of being frozen into the cache.
{
    const f = fixture();
    f.missing(true);
    assert.equal(buildLocModelHighlightParts(f.host, f.target), undefined);
    f.missing(false);
    assert.ok(buildLocModelHighlightParts(f.host, f.target));
    assert.equal(f.counts().modelLoads, 2);
}

// An animated model's temporary base-pose fallback must be retried when its frame arrives.
{
    const f = fixture();
    f.type().seqId = 10;
    let loadedFrame: object | undefined;
    f.loader.seqFrameLoader.load = () => loadedFrame;
    const fallback = buildLocModelHighlightParts(f.host, f.target);
    loadedFrame = {};
    const animated = buildLocModelHighlightParts(f.host, f.target);
    assert.notEqual(animated, fallback, "retry the fallback when the animation asset arrives");
    assert.equal(buildLocModelHighlightParts(f.host, f.target), animated);
    assert.equal(f.counts().modelLoads, 2);
}

// Skeletal animations also retry the base-pose fallback until their assets are available.
{
    const f = fixture();
    f.type().seqId = 10;
    let skeleton: object | undefined;
    f.loader.seqTypeLoader.load = () => ({ isSkeletalSeq: () => true, skeletalId: 77 });
    f.loader.skeletalSeqLoader = { load: () => skeleton };
    const fallback = buildLocModelHighlightParts(f.host, f.target);
    skeleton = {};
    const animated = buildLocModelHighlightParts(f.host, f.target);
    assert.notEqual(animated, fallback, "retry when the skeletal animation asset arrives");
    assert.equal(buildLocModelHighlightParts(f.host, f.target), animated);
    assert.equal(f.counts().modelLoads, 2);
}

// Clearing or replacing the loader's base model invalidates previously extracted geometry.
{
    const f = fixture();
    const modelCache = new Map<number, any>();
    f.loader.modelCache = modelCache;
    const loadModel = f.loader.getModelAnimated;
    const key = f.type().id << 10;
    f.loader.getModelAnimated = () => {
        const original = loadModel();
        if (!modelCache.has(key)) modelCache.set(key, original);
        return modelCache.get(key);
    };
    const first = buildLocModelHighlightParts(f.host, f.target);
    assert.equal(buildLocModelHighlightParts(f.host, f.target), first);
    modelCache.clear();
    const reloaded = buildLocModelHighlightParts(f.host, f.target);
    assert.notEqual(reloaded, first, "retry after clearing the base-model cache");
    assert.equal(buildLocModelHighlightParts(f.host, f.target), reloaded);
    modelCache.set(key, { ...modelCache.get(key), verticesX: [0, 256, 0] });
    const replaced = buildLocModelHighlightParts(f.host, f.target);
    assert.notDeepEqual(replaced, reloaded, "replacement model vertices reach the highlight");
    assert.equal(buildLocModelHighlightParts(f.host, f.target), replaced);
    assert.deepEqual(f.counts(), { modelLoads: 3, triangleBuilds: 3 });
}

// Invisible volumes' visual proxies are re-resolved so a changed proxy never stays cached.
{
    const f = fixture();
    let proxy = { verticesX: [0, 128, 0], verticesY: [0, 0, -128], verticesZ: [0, 0, 128] };
    f.host.hasNoVisibleFaces = () => true;
    f.host.findVisualProxyModel = () => proxy;
    const firstTarget = { ...f.target };
    const first = buildLocModelHighlightParts(f.host, firstTarget);
    assert.equal(firstTarget.overworldProxy, true);
    proxy = { ...proxy, verticesX: [0, 256, 0] };
    const nextTarget = { ...f.target };
    const next = buildLocModelHighlightParts(f.host, nextTarget);
    assert.equal(nextTarget.overworldProxy, true);
    assert.notDeepEqual(next, first, "the current proxy model supplies the vertices");
    assert.deepEqual(f.counts(), { modelLoads: 2, triangleBuilds: 2 });
}

// A renderer cache has a finite lifetime for untouched placements.
{
    const f = fixture();
    const first = buildLocModelHighlightParts(f.host, f.target);
    for (let i = 1; i <= 300; i++) buildLocModelHighlightParts(f.host, { ...f.target, tileX: 3208 + i });
    assert.notEqual(buildLocModelHighlightParts(f.host, f.target), first, "old unused placements are evicted");
}

console.log("loc highlight cache tests passed");
