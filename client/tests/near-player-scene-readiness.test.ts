import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientState } from "../game/ClientState";
import { MapManager } from "../game/MapManager";
import { getMapSquareId } from "../rs/map/MapFileIndex";

const id = getMapSquareId;
const square = (x: number, y: number) => ({ mapX: x, mapY: y, canRender: () => true, delete() {} });
function fixture() {
    const queued: number[] = [];
    const manager = new MapManager<any>(4, (x, y) => queued.push(id(x, y)));
    const update = (frame: number, x = 3240, y = 3240, baseX: number | undefined = 3180,
        baseY: number | undefined = 3180, range = 90) => manager.update(x, y,
        { getPosX: () => x, getPosZ: () => y } as any, frame, 1, baseX, baseY, 10, range);
    const add = (x: number, y: number) => manager.addMap(x, y, square(x, y));
    const near = [id(50, 50), id(50, 51), id(51, 50), id(51, 51)];
    return { manager, queued, update, add, near };
}

test("large views publish the complete near scene without waiting for far server-scene or padding squares", () => {
    const f = fixture();
    f.update(0);
    for (const n of f.near) f.add(n >> 8, n & 255);
    f.update(1);
    assert.equal(f.manager.isViewSquareReady(1), true, "the real loading UI's player square must be published");
    assert.equal(f.manager.isSceneReady(1), true, "camera and sparse prefetch readiness must not wait on distant work");
    assert.equal(f.manager.hasPendingMapLoads(1), true, "far maps must still stream");
    assert.deepEqual(new Set(f.manager.visibleMaps.map(m => id(m.mapX, m.mapY))), new Set(f.near));
    const revision = f.manager.getGridRevision();
    f.add(49, 50); f.update(2);
    assert.ok(f.manager.visibleMaps.some(m => id(m.mapX, m.mapY) === id(49, 50)), "a far server-scene square joins when ready");
    assert.equal(f.manager.getGridRevision(), revision, "optional completion keeps the published grid");
});

test("a near square hidden by camera sorting still queues before distant foreground", () => {
    const f = fixture();
    f.manager.update(3240, 3240, { getPosX: () => 3150, getPosZ: () => 3150 } as any, 0, 1, 3180, 3180, 10, 90);
    assert.deepEqual(new Set(f.queued.slice(0,4)),new Set(f.near), "all four required near squares load before optional scenery");
});

test("a target scene arriving before player coordinates cannot publish an empty or old scene", () => {
    const f = fixture(); f.update(0);
    for (const n of f.manager.getGridMapIdsSnapshot()) f.add(n >> 8, n & 255);
    f.update(1);
    f.update(2, 3240, 3240, 2042, 3861);
    assert.equal(f.manager.isSceneReady(2), false);
    assert.equal(f.manager.isSquareReadyAt(2094,3913,2), false);
    // The next renderer update catches up with the network's new player position.
    f.update(3,2094,3913,2042,3861);
    const own = id(32,61); f.add(own >> 8,own & 255);
    f.update(4,2094,3913,2042,3861);
    assert.equal(f.manager.isSceneReady(4),false,"neighboring near squares must also be built");
});


test("near padding still gates publication at a server rebase edge", () => {
    const f = fixture();
    f.update(0, 3310, 3240, 3224, 3180, 90);
    for (const n of f.manager.getGridMapIdsSnapshot()) {
        if (n !== id(52,50) && n !== id(52,51)) f.add(n >> 8,n & 255);
    }
    f.update(1,3310,3240,3224,3180,90);
    assert.equal(f.manager.isViewSquareReady(1),false,"padding within the default near view must not leave visible holes");
    f.add(52,50); f.add(52,51);
    f.update(2,3310,3240,3224,3180,90);
    assert.equal(f.manager.isViewSquareReady(2),true);
});

test("unknown authoritative base preserves full requested-view readiness", () => {
    const f=fixture();
    const update=(frame:number)=>f.manager.update(3240,3240,{getPosX:()=>3240,getPosZ:()=>3240} as any,frame,2,undefined,undefined,0,90);
    update(0);
    for (const n of f.near) f.add(n >> 8,n & 255);
    update(1);
    assert.equal(f.manager.isSceneReady(1),false);
    for (const n of f.manager.getGridMapIdsSnapshot()) f.add(n >> 8,n & 255);
    update(2);
    assert.equal(f.manager.isSceneReady(2),true);
});


test("an optional failed square becomes required as the player walks toward it", () => {
    const oldNow=Date.now;let now=1000;Date.now=()=>now;
    try {
        const f=fixture();f.update(0);for(const n of f.near)f.add(n>>8,n&255);f.update(1);
        const far=id(49,50);f.manager.deferFailedMapLoad(49,50);
        f.update(2,3210,3240);assert.equal(f.manager.isSceneReady(2),false,"a failed square entering the near view cannot be ready");
        assert.equal(f.manager.isViewSquareReady(2),false,"the actual loading UI and frame hold must wait for a newly required neighbor");
        assert.equal(f.manager.isSquareReadyAt(3199,3240,2),false,"frame hold must reject the unbuilt optional square");
        const calls=f.queued.filter(n=>n===far).length;now=1249;f.update(3,3210,3240);
        assert.equal(f.queued.filter(n=>n===far).length,calls,"required retries retain backoff");
        now=1250;f.update(4,3210,3240);assert.equal(f.queued.filter(n=>n===far).length,calls+1);
        f.add(49,50);f.add(49,51);f.update(5,3210,3240);
        assert.equal(f.manager.isSceneReady(5),true);assert.equal(f.manager.isSquareReadyAt(3199,3240,5),true);
    } finally {Date.now=oldNow}
});

test("a second teleport supersedes an unfinished target before it can publish", () => {
    const f=fixture();f.update(0);for(const n of f.near)f.add(n>>8,n&255);f.update(1);
    f.update(2,2094,3913,2042,3861);f.add(32,61);
    f.update(3,3100,3500,3048,3448);assert.equal(f.manager.isSceneReady(3),false);
    f.add(32,60);f.add(33,60);f.add(33,61);f.update(4,3100,3500,3048,3448);
    assert.equal(f.manager.isSquareReadyAt(2094,3913,4),false,"late previous-target work is not active");
    assert.equal(f.manager.isSceneReady(4),false);
    for(const n of f.manager.getGridMapIdsSnapshot())f.add(n>>8,n&255);f.update(5,3100,3500,3048,3448);
    assert.equal(f.manager.isSquareReadyAt(3100,3500,5),true);assert.equal(f.manager.isSquareReadyAt(2094,3913,5),false);
});

test("instance readiness still requires its own scene and excludes retained world/boat maps", () => {
    const old=ClientState.inInstance;const f=fixture();
    try{f.update(0);for(const n of f.near)f.add(n>>8,n&255);f.update(1);ClientState.inInstance=true;
        assert.equal(f.manager.isSceneReady(1),false);f.manager.cleanUp();
        f.manager.worldEntityMapIds.add(id(200,200));f.add(200,200);assert.equal(f.manager.isSceneReady(2),false);
        f.add(100,100);assert.equal(f.manager.isSceneReady(3),true);
    }finally{ClientState.inInstance=old}
});


test("low-end culling and a zero range retain a required own square",()=>{
    const old=MapManager.lowEnd;MapManager.lowEnd=true;
    try{const f=fixture();f.update(0,3240,3240,3180,3180,0);assert.equal(f.manager.isViewSquareReady(0),false);
        f.add(50,50);f.update(1,3240,3240,3180,3180,0);assert.equal(f.manager.isViewSquareReady(1),true);
        assert.ok(f.manager.getGridMapIdsSnapshot().includes(id(50,50)));
    }finally{MapManager.lowEnd=old}
});

test("an unspecified view range keeps the entire target scene required",()=>{
    const f=fixture();const update=(n:number)=>f.manager.update(3240,3240,{getPosX:()=>3240,getPosZ:()=>3240} as any,n,1,3180,3180);
    update(0);for(const n of f.near)f.add(n>>8,n&255);update(1);assert.equal(f.manager.isViewSquareReady(1),false);
    for(const n of f.manager.getGridMapIdsSnapshot())if(!f.near.includes(n))f.manager.addInvalidMap(n>>8,n&255);
    update(2);assert.equal(f.manager.isViewSquareReady(2),true,"known absent cache regions do not block readiness");
});
