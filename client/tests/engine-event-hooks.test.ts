import assert from "node:assert/strict";
import { VarManager } from "../rs/config/vartype/VarManager";
import { GroundItemStore } from "../game/data/ground/GroundItemStore";
import { NpcEcs } from "../game/ecs/NpcEcs";
import { PlayerEcs } from "../game/ecs/PlayerEcs";
import { subscribeActorGraphics } from "../game/ActorEventHooks";
import { GfxManager } from "../render/gfx/GfxManager";
import { MapManager } from "../game/MapManager";
import { Cs2Vm } from "../rs/cs2/Cs2Vm";
import { Script } from "../rs/cs2/Script";
import { GLRenderer } from "../widgets/gl/renderer";
import { InputManager } from "../game/InputManager";
import { ClientState } from "../game/ClientState";
import { handleInboundWorld } from "../network/serverConnection/handlers/inboundWorld";
import { dispatchMenuAction, setMenuEventHooks } from "../ui/menu/menuEvents";
import { processWidgetKeyboardInput } from "../game/widgets/input/widgetKeyboardInput";
import { Opcodes } from "../rs/cs2/Opcodes";

const vars = new VarManager({ load: () => ({ baseVar: 12, startBit: 0, endBit: 1 }) } as any);
const changes: number[][] = [];
const listener = (id: number, before: number, after: number) => changes.push([id, before, after]);
vars.varpChangeListeners.add(listener);
vars.setServerVarp(12, 9); vars.setVarp(12, 2); vars.setServerVarbit(0, 3);
assert.equal(vars.serverValues[12], 11);
assert.equal(vars.getVarp(12), 3, "packet bit updates retain normal client write behavior");
assert.deepEqual(changes, [[12, 0, 9], [12, 9, 2], [12, 2, 3]]);
vars.varpChangeListeners.delete(listener);
vars.setVarp(12, 4); assert.equal(changes.length, 3);
assert.equal(vars.setServerVarp(-1, 10), false);
assert.equal(vars.setServerVarp(8000, 10), false);
vars.resetForLogout(); assert.equal(vars.serverValues[12], 0);

const ground = new GroundItemStore(), groundChanges: string[] = [];
ground.mutationListeners.add(event => groundChanges.push(`${event.kind}:${event.stack.quantity}`));
const stack = { id: 1, itemId: 1944, quantity: 1, tile: { x: 3200, y: 3200, level: 0 } };
ground.update({ kind: "snapshot", stacks: [stack] });
ground.update({ kind: "delta", upserts: [{ ...stack, quantity: 3 }], removes: [] });
ground.clear(); assert.deepEqual(groundChanges, ["spawn:1", "quantity:3", "despawn:3"]);

const npcs = new NpcEcs(4), players = new PlayerEcs(4), mutations: string[] = [];
npcs.mutationListeners.add(event => mutations.push(`${event.kind}:${npcs.getServerId(event.index)}`));
const n = npcs.createNpc(50, 50, 1, 1, 64, 64, 0, 0, 0, 0);
assert.deepEqual(mutations, [], "cached visual NPCs are not server spawns");
npcs.setServerMapping(n, 7); npcs.setServerMapping(n, 7); npcs.setNpcTypeId(n, 2); npcs.destroyNpc(n);
assert.deepEqual(mutations, ["spawn:7", "composition:7", "despawn:7"]);
const playerChanges: string[] = [];
players.mutationListeners.add(event => playerChanges.push(event.kind));
players.allocatePlayer(9); players.deallocatePlayer(9);
assert.deepEqual(playerChanges, ["spawn", "despawn"]);

const maps = new MapManager<any>(8, () => {}), map = { mapX: 50, mapY: 50, delete() {}, canRender: () => true };
const mapChanges: string[] = [];
maps.preMapLoadListeners.add(() => { assert.equal(maps.getMap(50, 50), undefined); mapChanges.push("pre"); });
maps.mapAddedListeners.add(() => { assert.equal(maps.getMap(50, 50), map); mapChanges.push("added"); });
maps.mapRemovedListeners.add(() => mapChanges.push("removed"));
maps.addMap(50, 50, map); maps.removeMap(50, 50);
assert.deepEqual(mapChanges, ["pre", "added", "removed"]);

const graphics = new GfxManager({} as any);
const firstGraphic = graphics.spawnAttachedToNpc(42, 7);
const secondGraphic = graphics.spawnAttachedToNpc(43, 7);
const playerGraphic = graphics.spawnAttachedToPlayer(44, 7);
graphics.spawnAtTile(45, { x: 3200, y: 3200 });
const [firstInstance, secondInstance] = [...graphics.getActorInstances("npc", 7)];
assert.equal(graphics.getActorGraphic("npc", 7), 42);
assert.equal(graphics.getActorGraphic("player", 7), 44, "NPC and player IDs use separate indices");
firstInstance.slot = 1;
assert.equal(graphics.getActorGraphic("npc", 7), 43, "slot changes retain native first-match lookup");
secondInstance.spotId = 46;
assert.equal(graphics.getActorGraphic("npc", 7), 46, "mutable graphic IDs are read from the live instance");
firstInstance.slot = 0;
const graphicChanges: number[] = [];
const removeGraphicListener = subscribeActorGraphics(event => {
    if (event.type === "npc") graphicChanges.push(event.graphic);
});
// Actor lookup must not scan unrelated world or actor instances, even with a subscriber.
const allInstances = (graphics as any).instances as Map<number, unknown>;
allInstances.values = () => { throw new Error("Actor graphic lookups must not scan the global map"); };
graphics.kill(firstGraphic); graphics.kill(secondGraphic); graphics.kill(secondGraphic);
assert.deepEqual(graphicChanges, [46, -1], "subscribed removals report the remaining default-slot graphic");
assert.deepEqual([...graphics.getActorInstances("npc", 7)], [], "removed instances leave the actor index");
assert.equal((graphics as any).actorInstances.npc.size, 0, "empty actor buckets are released");
removeGraphicListener(); graphics.removeActorInstances("player", 7);
assert.equal(graphics.getActorGraphic("player", 7), -1);
assert.equal((graphics as any).actorInstances.player.size, 0);
graphics.kill(playerGraphic);
const expiringNpc = graphics.spawnAttachedToNpc(47, 8, "ground", undefined, false, undefined, 2);
const expiringPlayer = graphics.spawnAttachedToPlayer(48, 9, "ground", undefined, false, undefined, 3);
for (const kind of ["npc", "player"] as const) {
    for (const instance of graphics.getActorInstances(kind, kind === "npc" ? 8 : 9)) {
        instance.startTimeMs = 1; instance.endTimeMs = 0;
    }
}
graphics.update();
assert.equal((graphics as any).actorInstances.npc.size, 0, "expiration releases NPC buckets");
assert.equal((graphics as any).actorInstances.player.size, 0, "expiration releases player buckets");
assert.equal(allInstances.has(expiringNpc), false); assert.equal(allInstances.has(expiringPlayer), false);
for (const kind of ["npc", "player"] as const) {
    const spawn = kind === "npc" ? graphics.spawnAttachedToNpc.bind(graphics) : graphics.spawnAttachedToPlayer.bind(graphics);
    const first = spawn(50, 10, "ground", undefined, false, undefined, 0);
    const replaced = spawn(51, 10, "ground", undefined, false, undefined, 0);
    spawn(52, 11, "ground", undefined, false, undefined, 0);
    assert.equal(allInstances.has(first), false, "slot replacement removes the old global instance");
    assert.equal([...graphics.getActorInstances(kind, 10)].length, 1);
    assert.equal(graphics.getActorGraphic(kind, 10), 51);
    if (kind === "npc") graphics.clearAttachedSlotNpc(10); else graphics.clearAttachedSlotPlayer(10);
    assert.equal(allInstances.has(replaced), false);
    assert.equal(graphics.getActorGraphic(kind, 10), -1);
    assert.equal(graphics.getActorGraphic(kind, 11), 52, "slot clear retains other actors");
    graphics.removeActorInstances(kind, 11);
    assert.equal((graphics as any).actorInstances[kind].size, 0);
}

const visiblePlayers = [6, 2];
const mapGraphics = new GfxManager({
    osrsClient: { playerEcs: { getServerIdForIndex: (pid: number) => ({ 6: 41, 2: 84 })[pid] } },
    playerRenderer: { getRenderPlayersForMap: () => visiblePlayers },
} as any);
mapGraphics.spawnAttachedToPlayer(54, 84);
mapGraphics.spawnAttachedToNpc(55, 41);
mapGraphics.spawnAttachedToPlayer(56, 41);
mapGraphics.spawnAttachedToPlayer(57, 41);
(mapGraphics as any).instances.values = (mapGraphics as any).instances[Symbol.iterator] = () => { throw new Error("Player map query must use actor indices"); };
assert.equal((mapGraphics as any).findAttachedInstanceKey(54, 84), 1, "attached graphic lookup uses the actor index");
assert.deepEqual(mapGraphics.getAttachedPlayersForMap({} as any).map(({ inst, pid, slot }) => [inst.spotId, pid, slot]),
    [[56, 6, 0], [57, 6, 0], [54, 2, 1]], "map queries preserve visible-player and graphic insertion order");
visiblePlayers.length = 0;
assert.deepEqual(mapGraphics.getAttachedPlayersForMap({} as any), []);

const scripts = new Map<number, Script>(), root = new Script(), child = new Script();
root.id = 100; root.instructions = Int32Array.from([40, 21]); root.intOperands = Int32Array.from([101, 0]); root.stringOperands = [null, null];
child.id = 101; child.instructions = Int32Array.from([21]); child.intOperands = Int32Array.from([0]); child.stringOperands = [null];
scripts.set(101, child);
const vm = new Cs2Vm({ widgetManager: { beginBatch() {}, endBatch() {} }, loadScript: (id: number) => scripts.get(id) } as any);
const fired: string[] = [];
vm.scriptPreListeners.add(id => fired.push(`pre:${id}`)); vm.scriptPostListeners.add(id => fired.push(`post:${id}`));
vm.run(root); assert.deepEqual(fired, ["pre:100", "pre:101", "post:101", "post:100"]);

const input = new InputManager();
const removeFilter = input.addInputFilter(() => true);
const key = { code: "KeyW", key: "w", preventDefault() {} } as KeyboardEvent;
input.onKeyDown(key); assert.equal(input.isKeyDown("KeyW"), false);
removeFilter(); input.onKeyDown(key); assert.equal(input.isKeyDown("KeyW"), true);

for (const consumer of ["none", "filter", "handler"] as const) {
    for (const [code, key, keyCode, osrsCode] of [
        ["ShiftLeft", "Shift", 16, 81], ["ControlLeft", "Control", 17, 82],
        ["KeyW", "w", 87, 33], ["ArrowLeft", "ArrowLeft", 37, 96],
    ] as const) {
        const releaseInput = new InputManager();
        const press = { code, key, keyCode, shiftKey: keyCode === 16, preventDefault() {} } as KeyboardEvent;
        releaseInput.onKeyDown(press);
        assert.equal(releaseInput.isKeyDown(code), true);
        assert.equal(releaseInput.isKeyHeld(osrsCode), true);
        let consumed = 0;
        if (consumer === "filter") releaseInput.addInputFilter(type => {
            if (type !== "keyReleased") return false;
            consumed++; return true;
        });
        if (consumer === "handler") releaseInput.addKeyHandler({ onKeyUp: () => { consumed++; return true; } });
        (releaseInput as any).onKeyUp({ ...press, shiftKey: false });
        assert.equal(consumed, consumer === "none" ? 0 : 1);
        assert.equal(releaseInput.isKeyDown(code), false, `${consumer}: camera key released`);
        assert.equal(releaseInput.isKeyHeld(osrsCode), false, `${consumer}: CS2 key released`);
        assert.equal(releaseInput.keyArray[osrsCode], 0);
        assert.equal(releaseInput.shiftDown, false);
        if (keyCode === 16 || keyCode === 17) assert.equal(ClientState.isKeybindPressed(osrsCode), false);
    }
}

// A held modifier's auto-repeated keydown is not queued again as an onKey press (#845).
{
    const held = new InputManager();
    const ctrl = { code: "ControlLeft", key: "Control", keyCode: 17, ctrlKey: true, preventDefault() {} } as KeyboardEvent;
    held.onKeyDown(ctrl);
    assert.equal(held.keyEvents.length, 1);
    held.keyEvents.length = 0;
    held.osrsKeyPressedThisFrame.clear();
    for (let i = 0; i < 30; i++) held.onKeyDown({ ...ctrl, repeat: true } as KeyboardEvent);
    assert.equal(held.keyEvents.length, 0, "repeats queue no key presses");
    assert.equal(held.isKeyHeld(82), true);
    assert.equal(ClientState.isCtrlPressed(), true, "Ctrl stays held for Ctrl-click running");
    held.onKeyDown({ code: "KeyW", key: "w", keyCode: 87, repeat: true, preventDefault() {} } as KeyboardEvent);
    assert.equal(held.keyEvents.length, 1, "other keys still repeat");
    (held as any).onKeyUp(ctrl);
}

// Camera keys still reach native scripts; unchanged widgets must retain their cached drawing.
{
    const held = new InputManager();
    const label = { uid: 123, text: "Inventory" };
    const keyWidget = { uid: 124, eventHandlers: { onKey: { scriptId: 101, intArgs: [] } } };
    let fullRepaints = 0, keyCalls = 0;
    const dirtyWidgets: number[] = [];
    const manager: any = {
        rootInterface: 161, interfaceParents: new Map(), beginBatch() {}, endBatch() {},
        getWidgetByUid: () => label,
        isServerOwnedWidget: () => false,
        invalidateAll: () => fullRepaints++,
        invalidateWidgetRender: (widget: any) => dirtyWidgets.push(widget.uid),
    };
    const keyboardVm = new Cs2Vm({ widgetManager: manager, loadScript: (id: number) => scripts.get(id) } as any);
    keyboardVm.scriptPreListeners.add(() => keyCalls++);
    const deps: any = {
        getCs2Vm: () => keyboardVm, getVarManager: () => vars,
        getPendingInputDialogAction: () => null, getPendingTradeQuantityAction: () => null,
        getCustomInterfaces: () => ({ handleSearchKeyEvents: () => false }),
    };
    const frame: any = {
        input: held, mx: 0, my: 0, allRoots: [keyWidget], visibleMap: new Map(), getStaticChildren: () => [],
    };
    for (const [code, keyCode] of [["ArrowLeft", 37], ["ArrowRight", 39]] as const) {
        const press = { code, key: code, keyCode, preventDefault() {} } as KeyboardEvent;
        for (let i = 0; i < 31; i++) {
            held.onKeyDown({ ...press, repeat: i > 0 } as KeyboardEvent);
            processWidgetKeyboardInput(deps, frame, manager);
            held.keyEvents.length = 0;
            assert.equal(held.isKeyDown(code), true, "camera rotation stays held");
        }
        (held as any).onKeyUp(press);
    }
    assert.equal(keyCalls, 62, "initial and repeated arrows still reach native key listeners");
    assert.equal(fullRepaints, 0, "camera keys must not force a full UI repaint on every repeat");

    const changeLabel = new Script();
    changeLabel.id = 102;
    changeLabel.instructions = Int32Array.from([Opcodes.SCONST, Opcodes.ICONST, Opcodes.IF_SETTEXT, Opcodes.RETURN]);
    changeLabel.intOperands = Int32Array.from([0, label.uid, 0, 0]);
    changeLabel.stringOperands = ["Settings", null, null, null];
    scripts.set(changeLabel.id, changeLabel);
    keyWidget.eventHandlers.onKey.scriptId = changeLabel.id;
    held.onKeyDown({ code: "F1", key: "F1", keyCode: 112, preventDefault() {} } as KeyboardEvent);
    processWidgetKeyboardInput(deps, frame, manager);
    assert.equal(label.text, "Settings", "native key scripts still change widgets");
    assert.deepEqual(dirtyWidgets, [label.uid], "the changed widget is redrawn by its setter");
    assert.equal(fullRepaints, 0, "a widget change does not repaint unrelated panels");
}

const action = { param0: 0, param1: 0, opcode: 57, identifier: 1, itemId: -1, option: "Click", target: "", screenX: 0, screenY: 0 };
let clicks = 0, native = 0;
const dispose = setMenuEventHooks({ build: entries => entries, opened: entries => entries, shouldOpen: open => open,
    click: () => { clicks++; return false; } });
dispatchMenuAction(action, data => dispatchMenuAction(data, () => native++));
assert.equal(clicks, 1); assert.equal(native, 1);
dispose(); dispatchMenuAction(action, () => native++);
assert.equal(clicks, 1); assert.equal(native, 2, "unregistered hooks preserve native actions");

// Canvas updates retain texture storage and upload only clipped damage on later frames.
{
    const uploads: { kind: string; args: unknown[]; unpack: number[] }[] = [];
    const unpack = new Map<number, number>();
    let failUpload = false;
    const gl: any = { TEXTURE0: 1, TEXTURE_2D: 2, RGBA: 3, UNSIGNED_BYTE: 4,
        UNPACK_PREMULTIPLY_ALPHA_WEBGL: 5, UNPACK_SKIP_PIXELS: 6, UNPACK_SKIP_ROWS: 7,
        TEXTURE_MIN_FILTER: 8, TEXTURE_MAG_FILTER: 9, LINEAR: 10, TEXTURE_WRAP_S: 11,
        TEXTURE_WRAP_T: 12, CLAMP_TO_EDGE: 13, activeTexture() {}, bindTexture() {},
        createTexture: () => ({}), texParameteri() {}, pixelStorei: (key: number, value: number) => unpack.set(key, value),
        texImage2D(...args: unknown[]) { uploads.push({ kind: "allocate", args, unpack: [] }); },
        texSubImage2D(...args: unknown[]) {
            uploads.push({ kind: "update", args, unpack: [unpack.get(6)!, unpack.get(7)!, unpack.get(5)!] });
            if (failUpload) throw new Error("upload failed");
        },
    };
    const renderer = Object.assign(Object.create(GLRenderer.prototype), { gl, textures: new Map(), textureBatchTextures: [] });
    const source = { width: 800, height: 600 } as HTMLCanvasElement;
    const first = renderer.updateTextureFromCanvas("damage", source, { x: 10, y: 20, w: 30, h: 40 });
    assert.equal(uploads.at(-1)!.kind, "allocate", "first upload initializes the entire transparent canvas");
    assert.equal(renderer.updateTextureFromCanvas("damage", source, { x: 10, y: 20, w: 30, h: 40 }), first);
    assert.deepEqual(uploads.at(-1)!.args.slice(2, 6), [10, 20, 30, 40]);
    assert.deepEqual(uploads.at(-1)!.unpack, [10, 20, 1]);
    renderer.updateTextureFromCanvas("damage", source, { x: -5.5, y: 599.5, w: 15, h: 10 });
    assert.deepEqual(uploads.at(-1)!.args.slice(2, 6), [0, 599, 10, 1], "clip and round damage outward at canvas edges");
    const calls = uploads.length;
    renderer.updateTextureFromCanvas("damage", source, { x: 900, y: 0, w: 10, h: 10 });
    assert.equal(uploads.length, calls, "empty damage performs no upload");
    renderer.updateTextureFromCanvas("damage", source);
    assert.deepEqual(uploads.at(-1)!.args.slice(2, 6), [0, 0, 800, 600], "callers without damage still upload every pixel");
    failUpload = true;
    assert.throws(() => renderer.updateTextureFromCanvas("damage", source, { x: 10, y: 20, w: 30, h: 40 }), /upload failed/);
    assert.deepEqual([unpack.get(6), unpack.get(7), unpack.get(5)], [0, 0, 0], "failed upload cannot leak pixel-store state");
    failUpload = false;
    source.width = 900;
    renderer.updateTextureFromCanvas("damage", source, { x: 10, y: 20, w: 30, h: 40 });
    assert.equal(uploads.at(-1)!.kind, "allocate", "resize reallocates every pixel rather than leaving undefined areas");
    assert.equal(first.w, 900);
}
console.log("Engine hooks: packet mirrors, actor/map lifecycle, nested scripts, input and menu cleanup passed");

const followerHost = (typeof window !== "undefined" ? window : globalThis) as any;
const previousFollowerClient = followerHost.__osrsClient;
try {
    followerHost.__osrsClient = { varManager: vars };
    for (const [value, index] of [[(16433 << 16) | 123, 123], [-1, -1], [65535, -1]]) {
        handleInboundWorld({ type: "varp", payload: { varpId: 447, value } });
        assert.equal(ClientState.followerIndex, index, "native packed followers and both absent sentinels retain the menu contract");
    }
} finally { followerHost.__osrsClient = previousFollowerClient; }
