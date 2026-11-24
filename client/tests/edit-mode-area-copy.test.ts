import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import assert from "node:assert/strict";
import { buildAreaClipboard, buildRegionPack } from "../game/plugins/editmode/RegionPack";

for (const wide of [false, true]) {
    const value = (n: number) => wide ? [n >> 8, n & 255] : [n];
    // Overlay shape 2, rotation 3; flag 5; underlay 9; explicit height 7.
    const terrainTile = [...value(13), ...value(42), ...value(54), ...value(90), ...value(1), 7];
    const terrain = Uint8Array.from(Array.from({ length: 4 * 64 * 64 }, () => terrainTile).flat());
    const edits = [
        { kind: "place", tileX: 63, tileY: 9, plane: 3, locId: 123, shape: 10, rotation: 2 },
        { kind: "place", tileX: 62, tileY: 9, plane: 0, locId: 456, shape: 10, rotation: 0 },
        { kind: "height", tileX: 64, tileY: 10, plane: 2, locId: 11, shape: 0, rotation: 0 },
    ] as const;
    const requested: number[] = [];
    const copied = JSON.parse(buildAreaClipboard({ minX: 63, maxX: 64, minY: 9, maxY: 10 }, (x, y) => {
        const id = ((x >> 6) << 8) | (y >> 6);
        requested.push(id);
        return buildRegionPack(id, 1, 2, new Uint8Array([0]), terrain, edits, wide);
    }, wide));
    assert.deepEqual(requested, [0, 256], "read each intersecting region once");
    assert.equal(copied.tiles.length, 16, "2x2 selection includes all four planes");
    assert.deepEqual(copied.origin, { x: 63, y: 9 });
    assert.equal(copied.wideTerrain, wide);
    assert.deepEqual(copied.objects, [{ id: 123, x: 0, y: 0, plane: 3, shape: 10, rotation: 2 }]);
    for (const tile of copied.tiles) {
        const expected = [...terrainTile];
        if (tile.x === 1 && tile.y === 1 && tile.plane === 2) expected[expected.length - 1] = 11;
        assert.deepEqual(tile.terrain, expected, "retain every terrain byte and unsaved height edits");
    }
}
assert.throws(() => buildAreaClipboard({ minX: 0, maxX: 1, minY: 0, maxY: 1 }, () => {
    throw new Error("Region is not loaded");
}, false), /not loaded/);
console.info("Area clipboard preserves all planes, terrain records, objects and edits across regions");

assert.equal(typeof (EditModePlugin.prototype as any).pasteArea, "function", "copied areas need a paste action");

import { areaPasteEdits, copyAreaNpcs, parseRegionPack } from "../game/plugins/editmode/RegionPack";
import { Scene } from "../rs/scene/Scene";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import type { EditModeEdit } from "../game/plugins/editmode/types";
import { JSDOM } from "jsdom";

const source = { minX: 63, maxX: 64, minY: 63, maxY: 64 };
const destination = { tileX: 127, tileY: 127, plane: 2 };
const emptyObjects = new Uint8Array([0]);
function fixture(wide: boolean, procedural: boolean) {
    const value = (n: number) => wide ? [n >> 8, n & 255] : [n];
    const tile = [...value(13), ...value(42), ...value(54), ...value(90), ...value(procedural ? 0 : 1), ...(procedural ? [] : [7])];
    const terrain = Uint8Array.from(Array.from({ length: 4 * 64 * 64 }, () => tile).flat());
    const base = (id: number, edits: readonly EditModeEdit[] = []) => buildRegionPack(id, 1, 2, emptyObjects, terrain, edits, wide);
    const existing = [{ kind: "place", locId: 99, tileX: 128, tileY: 127, plane: 3, shape: 22, rotation: 0 }] as const;
    const getSource = (x: number, y: number) => base(((x >> 6) << 8) | (y >> 6), [
        { kind: "place", locId: 100_001, tileX: 63, tileY: 63, plane: 3, shape: 10, rotation: 2 },
        { kind: "place", locId: 0, tileX: 64, tileY: 64, plane: 0, shape: 22, rotation: 1 },
        { kind: "height", locId: 13, tileX: 65, tileY: 65, plane: 2, shape: 0, rotation: 0 },
    ]);
    const npcs = copyAreaNpcs([
        { id: 100_002, tileX: 63, tileY: 63, plane: 1, direction: 7, wanderRadius: 4 },
        { id: 3, tileX: 62, tileY: 63, plane: 0 }, // outside selection
    ], [
        { kind: "npcWander", locId: 100_002, tileX: 63, tileY: 63, plane: 1, shape: 0, rotation: 0, wanderRadius: 0 },
        { kind: "npc", locId: 4, tileX: 64, tileY: 64, plane: 3, shape: 0, rotation: 2, direction: 1, wanderRadius: 2 },
    ]);
    const contents = buildAreaClipboard(source, getSource, wide, npcs);
    const edits = areaPasteEdits(contents, destination, wide);
    const getDestination = (x: number, y: number) => base(((x >> 6) << 8) | (y >> 6), [...existing, ...edits]);
    const bounds = { minX: 127, maxX: 128, minY: 127, maxY: 128 };
    const pasted = JSON.parse(buildAreaClipboard(bounds, getDestination, wide));
    const copied = JSON.parse(contents);
    assert.deepEqual(pasted.objects, copied.objects, "objects on all levels replace destination objects, including wide/zero ids");
    assert.deepEqual(pasted.heights, copied.heights, "all four planes include explicit source border heights");
    assert.deepEqual(edits.filter(e => e.kind === "npc").map(e => [e.locId, e.tileX, e.tileY, e.plane, e.direction, e.wanderRadius]),
        [[100_002,127,127,1,7,0], [4,128,128,3,1,2]], "NPC types, settings and relative positions survive");
    // Use the production terrain decoder to compare geometry, flags and all floor fields after moving noise coordinates.
    const decode = (originX: number, originY: number, get: (x: number, y: number) => Uint8Array) => {
        const scene = new Scene(4, 3, 3);
        const builder = new SceneBuilder({ game: "oldschool", revision: wide ? 242 : 200 } as any,
            {} as any, {} as any, {} as any, {} as any, {} as any, new Map());
        for (let x = originX >> 6; x <= (originX + 2) >> 6; x++) for (let y = originY >> 6; y <= (originY + 2) >> 6; y++) {
            builder.decodeTerrain(scene, new Int8Array(parseRegionPack(get(x*64,y*64)).terrainData),
                x*64-originX, y*64-originY, originX, originY, x, y);
        }
        return scene;
    };
    const originalScene = decode(63, 63, getSource);
    const pastedScene = decode(127, 127, getDestination);
    assert.deepEqual(pastedScene.tileHeights, originalScene.tileHeights, "native terrain decode preserves complete moved geometry");
    for (const field of ["tileUnderlays", "tileOverlays", "tileShapes", "tileRotations", "tileRenderFlags"] as const) {
        for (let p = 0; p < 4; p++) for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) {
            assert.equal(pastedScene[field][p][x][y], originalScene[field][p][x][y], field);
        }
    }
    // Clipboard order is not authoritative: a shuffled set must not clear an already-pasted upper plane.
    const shuffled = { ...copied, tiles: [...copied.tiles].reverse() };
    const alternate = areaPasteEdits(JSON.stringify(shuffled), destination, wide);
    const alternateCopy = JSON.parse(buildAreaClipboard(bounds, (x,y) => base(((x>>6)<<8)|(y>>6), alternate), wide));
    assert.deepEqual(alternateCopy.tiles, pasted.tiles);
    const legacy = { ...copied }; delete legacy.heights; delete legacy.npcs;
    assert.ok(areaPasteEdits(JSON.stringify(legacy), destination, wide).length, "old v1 copies still paste without optional NPC/border data");
    return { contents, copied, base, existing, edits, wide };
}
for (const wide of [false, true]) for (const noise of [false, true]) fixture(wide, noise);
const f = fixture(true, true);
const snapshots: unknown[][] = [];
const immediateMapEdits: string[] = [];
const liveNpcs = new Set<number>();
let npcId = 0;
let failRegion: number | undefined;
const plugin = new EditModePlugin();
plugin.attach({
    getCanvas: () => undefined, getPointerTile: () => destination, getPointerLoc: () => undefined,
    isLoggedIn: () => true, cancelPendingClick() {}, hasWideTerrain: () => true,
    onLocAddChange() { immediateMapEdits.push("object"); }, onLocDel() {}, restoreLoc() {},
    setTerrainOverlay() { immediateMapEdits.push("overlay"); }, clearTerrainOverride() {},
    spawnNpc: (...args: unknown[]) => { snapshots.push(args); liveNpcs.add(++npcId); return npcId; },
    despawnNpc: (id: number) => { liveNpcs.delete(id); },
    refreshEditedRegions: (regions: number[], edits: EditModeEdit[]) => snapshots.push([regions, edits]),
    exportRegionPack: (tile: any, edits: EditModeEdit[]) => {
        const regionId = ((tile.tileX >> 6) << 8) | (tile.tileY >> 6);
        if (regionId === failRegion) throw Error("Region is not loaded");
        return { regionId, data: f.base(regionId, edits) };
    },
    copyArea: (bounds: any) => buildAreaClipboard(bounds, (x,y) => f.base(((x>>6)<<8)|(y>>6)), true),
} as any);
plugin.setConfig({ enabled: true, active: true, edits: [...f.existing] });
const before = plugin.getConfig().edits;
plugin.pasteArea(f.contents, destination);
assert.deepEqual(immediateMapEdits, [], "paste map edits use the batch region rebuild");
assert.equal(liveNpcs.size, 2);
assert.ok(plugin.getConfig().edits.some(e => e.locId === 100_001), "wide ids are not clamped by config sanitation");
assert.deepEqual(snapshots[0], [100_002, {tileX:127,tileY:127,plane:1}, 2, 7], "native facing is forwarded to the host");
assert.equal(plugin.exportModifiedRegionPacks().length, 4, "Save exports every touched region");
assert.equal(plugin.undo(), true);
assert.deepEqual(plugin.getConfig().edits, before, "one undo takes the entire paste back");
assert.equal(liveNpcs.size, 0);
assert.equal(plugin.redo(), true);
assert.equal(liveNpcs.size, 2, "redo recreates NPCs as well as rebuilding the map");
const after = plugin.getConfig().edits;
const invalid = ["not JSON", "null", "{}", JSON.stringify({...f.copied, tiles:f.copied.tiles.slice(1)}),
    JSON.stringify({...f.copied, tiles:f.copied.tiles.map((t:any,i:number)=>i===1?f.copied.tiles[0]:t)}),
    JSON.stringify({...f.copied, heights:f.copied.heights.slice(1)}),
    JSON.stringify({...f.copied, objects:[{...f.copied.objects[0], x:-1}]}),
    JSON.stringify({...f.copied, npcs:[{id:3,tileX:0,tileY:0,plane:0,wanderRadius:256}]}),
    JSON.stringify({...f.copied, tiles:f.copied.tiles.map((t:any,i:number)=>i===0?{...t,terrain:[0]}:t)})];
for (const contents of invalid) {
    assert.throws(() => plugin.pasteArea(contents, destination));
    assert.deepEqual(plugin.getConfig().edits, after);
    assert.equal(liveNpcs.size, 2);
}
assert.throws(() => plugin.pasteArea(f.contents, {tileX:16383,tileY:0,plane:0}));
failRegion = 514;
assert.throws(() => plugin.pasteArea(f.contents, destination), /not loaded/);
assert.deepEqual(plugin.getConfig().edits, after, "late target region failure changes nothing");
assert.equal(liveNpcs.size, 2);
failRegion = undefined;
assert.equal(plugin.undo(), true, "failed pastes leave undo history intact");
assert.deepEqual(plugin.getConfig().edits, before);

async function clipboardUi(): Promise<void> {
    const dom = new JSDOM('<!doctype html><html><body><div class="game-viewport"><div class="game-canvas-shell"></div></div></body></html>', {url:'http://localhost:3000/?edit',pretendToBeVisual:true});
    Object.assign(globalThis, {window:dom.window,document:dom.window.document,self:dom.window,
        Event:dom.window.Event,HTMLElement:dom.window.HTMLElement,HTMLAnchorElement:dom.window.HTMLAnchorElement,HTMLInputElement:dom.window.HTMLInputElement,
        requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)});
    const messages:any[]=[];
    Object.defineProperty(dom.window,'opener',{value:{closed:false,postMessage:(...args:any[])=>messages.push(args)}});
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{}}});
    const {mountEditorUi}=require('../game/plugins/editmode/EditorUi');
    const remove=mountEditorUi(plugin);
    const select=(x:number,y:number)=>{
        (plugin as any).selection={kind:'ground',tileX:x,tileY:y,plane:0,locId:-1,locName:''};
        plugin.setConfig({tool:'select'});
    };
    const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text) as HTMLButtonElement;
    const settle=()=>new Promise(resolve=>setImmediate(resolve));
    select(127,127);
    assert.ok(button('Copy area'), 'single tiles can copy too');
    assert.ok(button('Paste area'),'paste is discoverable on a single destination tile');
    const initial=plugin.getConfig().edits;
    button('Paste area').click(); // No readText method.
    await settle();
    assert.ok(document.body.textContent?.includes('Paste failed:'));
    assert.deepEqual(plugin.getConfig().edits,initial);
    (navigator as any).clipboard.readText=()=>Promise.reject(Error('clipboard permission denied'));
    button('Paste area').click(); await settle();
    assert.ok(document.body.textContent?.includes('clipboard permission denied'));
    assert.deepEqual(plugin.getConfig().edits,initial);
    let resolveClipboard!:(s:string)=>void;
    (navigator as any).clipboard.readText=()=>new Promise(resolve=>{resolveClipboard=resolve;});
    button('Paste area').click(); await settle();
    select(500,500); resolveClipboard(f.contents); await settle();
    assert.ok(plugin.getConfig().edits.some(e=>e.tileX===127&&e.kind==='npc'), 'async paste keeps the captured destination');
    assert.ok(!plugin.getConfig().edits.some(e=>e.tileX===500), 'later selection is not the destination');
    (document.querySelector('button[aria-label="Save world and map edits"]') as HTMLButtonElement).click();
    assert.equal(messages.filter(m=>m[0].type==='elvarg:region-pack').length,4,'host Save receives all region packs');
    const npcMessage=messages.find(m=>m[0].type==='elvarg:custom-npc-spawns')[0];
    assert.equal(npcMessage.spawns.length,2);
    assert.equal(npcMessage.spawns[0].direction,7);
    assert.equal(npcMessage.spawns[0].wanderRadius,0);
    assert.ok(messages.every(m=>m[1]==='http://localhost:3000'),'existing trusted host origin is used');
    remove(); dom.window.close();
}
clipboardUi().catch(error=>{console.error(error);process.exitCode=1;});
