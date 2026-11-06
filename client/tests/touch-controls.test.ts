import { strict as assert } from "node:assert";

import type { Camera } from "../game/Camera";
import type { ContinuousMovementRefusal } from "../game/movement/ContinuousMovement";
import type { SceneLoc } from "../game/scene/SceneGeometry";
import {
    TouchControlsPlugin,
    type TouchControlsClient,
} from "../game/plugins/touchcontrols/TouchControlsPlugin";
import { findBlockingTarget, type TouchTargetWorld } from "../game/plugins/touchcontrols/TouchTargets";
import { GameState } from "../game/login/GameState";
import { MenuOpcode } from "../ui/menu/MenuState";
import { setMenuTransform } from "../ui/menu/menuTransforms";
import { applyMenuSwaps } from "../game/plugins/menuswapper/menuSwaps";
import { npcOpsVisibility } from "../game/NpcOpsVisibility";
import { groundObjOpsVisibility } from "../game/GroundObjOpsVisibility";

type Move = { dx: number; dy: number; running: boolean; rotation: number };

function makeClient(overrides: Partial<TouchControlsClient> = {}): {
    client: TouchControlsClient;
    moves: Move[];
    stops: number[];
} {
    const moves: Move[] = [];
    const stops: number[] = [];
    const client: TouchControlsClient = {
        // Camera yaw 0 looks north; actor rotation is camera yaw + 1024.
        camera: { yaw: 0, getYaw: () => 0 } as unknown as Camera,
        gameState: GameState.LOGGED_IN,
        runMode: false,
        isLoggedIn: () => true,
        setKeyboardMovement: (dx, dy, running, rotation) => moves.push({ dx, dy, running, rotation }),
        stopKeyboardMovement: () => stops.push(1),
        widgetManager: { interfaceParents: new Map(), isEffectivelyHidden: () => false },
        ...overrides,
    };
    return { client, moves, stops };
}

const near = (actual: number, expected: number, message: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-6, `${message} (expected ${expected}, got ${actual})`);

// Stick forward walks away from the camera, facing north.
{
    const { client, moves } = makeClient();
    new TouchControlsPlugin(client).steer(1, 0);
    assert.equal(moves.length, 1, "steering sends one movement input");
    near(moves[0].dx, 0, "forward has no sideways component");
    near(moves[0].dy, 1, "forward walks north at yaw 0");
    assert.equal(moves[0].rotation, 1024, "the player faces north");
}

// The stick is analog and the player faces the way they walk.
{
    const { client, moves } = makeClient();
    const plugin = new TouchControlsPlugin(client);
    plugin.steer(0, 1);
    near(moves[0].dx, 1, "stick right walks east at yaw 0");
    assert.equal(moves[0].rotation, 1536, "the player faces east");
    plugin.steer(0.5, -0.5);
    near(Math.atan2(moves[1].dx, moves[1].dy), -Math.PI / 4, "a diagonal stick walks north-west");
    assert.equal(moves[1].rotation, 768, "the player faces north-west");
}

// Centring or releasing the stick stops walking.
{
    const { client, stops } = makeClient();
    const plugin = new TouchControlsPlugin(client);
    plugin.steer(1, 0);
    plugin.steer(0, 0);
    assert.equal(stops.length, 1, "a centred stick stands still");
    plugin.release();
    assert.equal(stops.length, 2, "releasing the stick stops walking");
    plugin.release();
    assert.equal(stops.length, 2, "a second release does nothing");
}

// The run orb decides walk or run; the joystick has no toggle of its own.
{
    const { client, moves } = makeClient({ runMode: true });
    new TouchControlsPlugin(client).steer(1, 0);
    assert.equal(moves[0].running, true, "movement follows the run orb");
}

// An open interface keeps the joystick inert: server-side movement closes interfaces.
{
    const { client, moves, stops } = makeClient({
        widgetManager: {
            interfaceParents: new Map([[1, { type: 0 }]]),
            isEffectivelyHidden: () => false,
        },
    });
    const plugin = new TouchControlsPlugin(client);
    plugin.steer(1, 0);
    plugin.release();
    assert.equal(moves.length, 0, "no movement input while a bank-style interface is open");
    assert.equal(stops.length, 0, "nothing to stop when movement never started");
}

// Logging out mid-walk releases the stick instead of leaving a phantom walk.
{
    const { client, stops } = makeClient();
    let loggedIn = true;
    client.isLoggedIn = () => loggedIn;
    const plugin = new TouchControlsPlugin(client);
    plugin.steer(1, 0);
    loggedIn = false;
    plugin.onClientTick();
    assert.equal(stops.length, 1, "logout stops walking");
}

// Camera yaw turns the walk direction: at yaw 512 (east) forward walks east.
{
    const { client, moves } = makeClient();
    client.camera = { yaw: 512, getYaw: () => 512 } as unknown as Camera;
    new TouchControlsPlugin(client).steer(1, 0);
    near(moves[0].dx, 1, "forward follows the camera east");
    near(moves[0].dy, 0, "no northward drift at 90 degrees");
}

// The controls show only on touch screens; ?touch=1 forces them on, as on a desktop browser.
(globalThis as any).window = { location: { search: "?touch=1" } };

// A small scene: a door on the north side of (10, 10), a 2x2 tree at (20, 20), a bare fence,
// and a booth whose second option the server has hidden.
const LOCS: SceneLoc[] = [
    { id: 1, tileX: 10, tileY: 10, plane: 0, shape: 0, rotation: 1 },
    { id: 2, tileX: 20, tileY: 20, plane: 0, shape: 10, rotation: 0 },
    { id: 3, tileX: 30, tileY: 30, plane: 0, shape: 0, rotation: 1 },
    { id: 4, tileX: 40, tileY: 41, plane: 0, shape: 10, rotation: 0 },
];
const TYPES: Record<number, { name: string; actions: (string | null)[]; sizeX: number; sizeY: number }> = {
    1: { name: "Door", actions: ["Open", null, null, null, null], sizeX: 1, sizeY: 1 },
    2: { name: "Oak tree", actions: ["Chop down", null, null, null, null], sizeX: 2, sizeY: 2 },
    3: { name: "Fence", actions: [null, null, null, null, null], sizeX: 1, sizeY: 1 },
    4: { name: "Bank booth", actions: [null, "Bank", "Collect", null, null], sizeX: 1, sizeY: 1 },
};
const world: TouchTargetWorld = {
    locsAtTile: (x, y, plane) => LOCS.filter((l) => l.tileX === x && l.tileY === y && l.plane === plane),
    size: (id) => TYPES[id],
    current: (id) => TYPES[id],
    opFlags: (_x, _y, id) => (id === 4 ? 0b100 : undefined),
};
const refusal = (fromX: number, fromY: number, toX: number, toY: number): ContinuousMovementRefusal =>
    ({ fromX, fromY, toX, toY, level: 0, at: performance.now() });

// Walls count on the refused edge only, from either side; locs count over their whole footprint.
{
    assert.equal(findBlockingTarget(refusal(10, 10, 10, 11), world)?.name, "Door", "walking north into the door");
    assert.equal(findBlockingTarget(refusal(10, 11, 10, 10), world)?.name, "Door", "walking south into it from outside");
    assert.equal(findBlockingTarget(refusal(10, 10, 11, 10), world), undefined, "the door is not on the east edge");
    assert.equal(findBlockingTarget(refusal(22, 21, 21, 21), world)?.name, "Oak tree", "the tree's far tile is still the tree");
    assert.equal(findBlockingTarget(refusal(30, 30, 30, 31), world), undefined, "a fence without options is ignored");
    const booth = findBlockingTarget(refusal(40, 40, 40, 41), world);
    assert.deepEqual(booth?.options, [{ option: "Collect", actionIndex: 2 }], "options the server hid stay hidden");
}

// Walking into the tree focuses it; the button sends its option as a click would, and the
// held stick stays inert until the thumb lifts so it cannot cancel the action.
{
    const sent: unknown[][] = [];
    let blocked: ContinuousMovementRefusal | undefined;
    const players = { getIndexForServerId: () => 0, getX: () => 21 * 128 + 64, getY: () => 19 * 128 + 64, getLevel: () => 0 };
    const { client, moves, stops } = makeClient({
        playerEcs: players,
        sceneGeometry: { locsAtTile: world.locsAtTile },
        locTypeLoader: { load: (id: number) => TYPES[id] as never },
        getKeyboardMovementRefusal: () => blocked,
        menuAction: (...args) => sent.push(args),
    });
    const plugin = new TouchControlsPlugin(client);
    plugin.steer(1, 0);
    blocked = refusal(21, 19, 21, 20);
    plugin.onClientTick();
    assert.deepEqual(plugin.getUiState().action, { kind: "loc", options: [{ option: "Chop down", target: "Oak tree", id: 0 }] });
    plugin.interact(0);
    assert.deepEqual(sent[0].slice(2), [MenuOpcode.GameObjectFirstOption, 2, "Chop down", "Oak tree"]);
    const walked = moves.length;
    plugin.steer(1, 0);
    plugin.onClientTick();
    assert.equal(moves.length, walked, "the stick waits for the thumb to lift");
    assert.ok(stops.length > 0, "the walk stops for the action");
    plugin.release();
    plugin.steer(1, 0);
    assert.equal(moves.length, walked + 1, "a fresh press walks again");
}

// Sliding along a wall is not walking into it.
{
    let blocked: ContinuousMovementRefusal | undefined;
    const { client } = makeClient({
        playerEcs: { getIndexForServerId: () => 0, getX: () => 10 * 128 + 64, getY: () => 10 * 128 + 64, getLevel: () => 0 },
        sceneGeometry: { locsAtTile: world.locsAtTile },
        locTypeLoader: { load: (id: number) => TYPES[id] as never },
        getKeyboardMovementRefusal: () => blocked,
    });
    const plugin = new TouchControlsPlugin(client);
    plugin.steer(0.5, 0.5); // north-east, along the door's wall
    blocked = refusal(10, 10, 10, 11);
    plugin.onClientTick();
    assert.equal(plugin.getUiState().action, undefined, "a glancing blow focuses nothing");
}

// Standing on an NPC's tile focuses it; a 2x2 NPC covers four tiles; its option goes by server index.
{
    const sent: unknown[][] = [];
    let at = { x: 50, y: 50 };
    // ecs 1: a cow at (50, 50); ecs 2: a 2x2 giant whose south-west tile is (60, 60); ecs 3: no options.
    const npcs = [
        { ecsId: 1, serverId: 11, typeId: 81, size: 1, x: 50, y: 50 },
        { ecsId: 2, serverId: 12, typeId: 82, size: 2, x: 60, y: 60 },
        { ecsId: 3, serverId: 13, typeId: 83, size: 1, x: 70, y: 70 },
    ];
    const npcTypes: Record<number, { id: number; name: string; actions: (string | null)[] }> = {
        81: { id: 81, name: "Cow", actions: [null, "Attack", null, null, null] },
        82: { id: 82, name: "<col=ffff00>Giant</col>", actions: ["Talk-to", null, null, null, null] },
        83: { id: 83, name: "Guard", actions: [null, null, null, null, null] },
    };
    const byEcs = (id: number) => npcs.find((n) => n.ecsId === id)!;
    const { client } = makeClient({
        playerEcs: { getIndexForServerId: () => 0, getX: () => at.x * 128 + 64, getY: () => at.y * 128 + 64, getLevel: () => 0 },
        sceneGeometry: { locsAtTile: () => [] },
        locTypeLoader: { load: () => undefined },
        npcEcs: {
            forEachActive: (fn) => npcs.forEach((n) => fn(n.ecsId)),
            getServerId: (id) => byEcs(id).serverId,
            getNpcTypeId: (id) => byEcs(id).typeId,
            getSize: (id) => byEcs(id).size,
            // Centres: a size-n NPC's centre is n/2 tiles past its south-west corner.
            getWorldX: (id) => byEcs(id).x * 128 + byEcs(id).size * 64,
            getWorldY: (id) => byEcs(id).y * 128 + byEcs(id).size * 64,
            getLevel: () => 0,
        },
        npcTypeLoader: { load: (id: number) => npcTypes[id] as never },
        menuAction: (...args) => sent.push(args),
    });
    const plugin = new TouchControlsPlugin(client);
    plugin.onClientTick();
    assert.deepEqual(plugin.getUiState().action, { kind: "npc", options: [{ option: "Attack", target: "Cow", id: 0 }] });
    plugin.interact(0);
    assert.deepEqual(sent[0].slice(2), [MenuOpcode.NpcSecondOption, 11, "Attack", "Cow"]);
    // hidenpcops takes the NPC's button away; it comes back with the next scan once shown again.
    npcOpsVisibility.set(true);
    plugin.onClientTick();
    assert.equal(plugin.getUiState().action, undefined, "hidden NPC actions offer no button");
    npcOpsVisibility.clear();
    plugin.onGameTick();
    plugin.onClientTick();
    assert.equal(plugin.getUiState().action?.options[0].target, "Cow", "shown again, the cow's button returns");
    // Held, the cow stays the target after the player steps off it.
    plugin.pin(true);
    at = { x: 61, y: 61 };
    plugin.onClientTick();
    assert.equal(plugin.getUiState().action?.options[0].target, "Cow", "a held button keeps its target");
    plugin.pin(false);
    plugin.onClientTick();
    assert.equal(plugin.getUiState().action?.options[0].target, "Giant", "the giant's far tile, with its colour tags stripped");
    // Stepping off, the giant lingers a moment, then goes; an NPC without options never shows.
    const realNow = performance.now.bind(performance);
    let now = realNow();
    Object.defineProperty(performance, "now", { configurable: true, value: () => now });
    try {
        at = { x: 70, y: 70 };
        plugin.onClientTick();
        assert.equal(plugin.getUiState().action?.options[0].target, "Giant", "a wandering NPC keeps the button a moment");
        now += 1600;
        plugin.onClientTick();
        assert.equal(plugin.getUiState().action, undefined, "then it goes, and the Guard has no options");
    } finally {
        Object.defineProperty(performance, "now", { configurable: true, value: realNow });
    }
}

// While the scene loads, nothing is focused even where an NPC seems to share the player's tile.
{
    const { client } = makeClient({
        gameState: GameState.LOADING_GAME,
        playerEcs: { getIndexForServerId: () => 0, getX: () => 64, getY: () => 64, getLevel: () => 0 },
        sceneGeometry: { locsAtTile: () => [] },
        locTypeLoader: { load: () => undefined },
        npcEcs: {
            forEachActive: (fn) => fn(1), getServerId: () => 5, getNpcTypeId: () => 81, getSize: () => 2,
            getWorldX: () => 128, getWorldY: () => 128, getLevel: () => 0,
        },
        npcTypeLoader: { load: () => ({ id: 81, name: "Cow", actions: [null, "Attack"] }) as never },
    });
    const plugin = new TouchControlsPlugin(client);
    plugin.onClientTick();
    assert.equal(plugin.getUiState().action, undefined, "no focus before LOGGED_IN");
    client.gameState = GameState.LOGGED_IN;
    plugin.onClientTick();
    assert.equal(plugin.getUiState().action?.options[0].target, "Cow", "the same NPC focuses once the scene is up");
}

// The button follows Menu Entry Swapper: a saved left-click swap is the tap, first in the list.
{
    const swaps = { "npc:90": { option: "Bank", name: "Banker" } };
    setMenuTransform((entries, context) => applyMenuSwaps(entries, { ...context, isShiftHeld: false },
        { enabled: true, presets: { bank: false, trade: false, pickpocket: false, shiftDrop: false }, swaps, shiftSwaps: {} },
        () => {}));
    const { client } = makeClient({
        playerEcs: { getIndexForServerId: () => 0, getX: () => 64, getY: () => 64, getLevel: () => 0 },
        sceneGeometry: { locsAtTile: () => [] },
        locTypeLoader: { load: () => undefined },
        npcEcs: {
            forEachActive: (fn) => fn(1), getServerId: () => 5, getNpcTypeId: () => 90, getSize: () => 1,
            getWorldX: () => 64, getWorldY: () => 64, getLevel: () => 0,
        },
        npcTypeLoader: { load: () => ({ id: 90, name: "Banker", actions: ["Talk-to", null, "Bank", "Collect", null] }) as never },
    });
    const plugin = new TouchControlsPlugin(client);
    plugin.onClientTick();
    assert.deepEqual(plugin.getUiState().action?.options.map((o) => o.option), ["Bank", "Talk-to", "Collect"]);
    setMenuTransform(undefined);
}

// Standing on ground items lists every stack's options, the last to land first; Take goes by stack.
{
    const stacks = [
        { id: 1, itemId: 526, quantity: 1, tile: { x: 40, y: 40, level: 0 } },
        { id: 2, itemId: 995, quantity: 250, tile: { x: 40, y: 40, level: 0 } },
    ];
    const objTypes: Record<number, { name: string; groundActions: (string | null)[] }> = {
        526: { name: "Bones", groundActions: [null, null, "Take", null, null] },
        995: { name: "Coins", groundActions: [null, null, null, null, null] },
    };
    let at = { x: 40, y: 40 };
    let version = 1;
    const taken: number[] = [];
    const { client } = makeClient({
        playerEcs: { getIndexForServerId: () => 0, getX: () => at.x * 128 + 64, getY: () => at.y * 128 + 64, getLevel: () => 0 },
        sceneGeometry: { locsAtTile: () => [] },
        locTypeLoader: { load: () => undefined },
        groundItems: { getStacksAt: (x, y) => (x === 40 && y === 40 ? stacks.slice() : []) as never, getVersion: () => version },
        objTypeLoader: { load: (id) => objTypes[id] },
        takeGroundItem: (stack) => taken.push(stack.id),
        clientPlugins: {
            interactHighlightConfig: () => undefined,
            groundItemMenuName: (stack, name) => (stack.quantity > 1 ? `${name} (${stack.quantity})` : name),
            deprioritizeGroundItem: (stack) => stack.itemId === 526,
        },
    });
    const plugin = new TouchControlsPlugin(client);
    plugin.onClientTick();
    const options = plugin.getUiState().action?.options ?? [];
    assert.deepEqual(options.map((o) => `${o.option} ${o.target}`), ["Take Coins (250)", "Take Bones"],
        "the newest stack first, a hidden item's Take last");
    plugin.interact(options[1].id);
    assert.deepEqual(taken, [1], "Take sends that stack");
    // hideobjops takes the pile's button away; it comes back with the next scan once shown again.
    groundObjOpsVisibility.set(true);
    plugin.onClientTick();
    assert.equal(plugin.getUiState().action, undefined, "hidden ground-item actions offer no button");
    groundObjOpsVisibility.clear();
    version++;
    plugin.onClientTick();
    assert.equal(plugin.getUiState().action?.options.length, 2, "shown again, the pile's button returns");
    stacks.splice(1, 1);
    version++;
    plugin.onClientTick();
    assert.deepEqual(plugin.getUiState().action?.options.map((o) => o.target), ["Bones"], "a taken stack goes from the list");
    at = { x: 41, y: 40 };
    plugin.onClientTick();
    assert.equal(plugin.getUiState().action, undefined, "stepping off drops the pile");
}

// Switched off in the plugin hub (enabled state, then stop), the joystick and button go and a
// held stick stops; ticks don't arrive while stopped.
void (async () => {
    const { client, stops } = makeClient();
    const plugin = new TouchControlsPlugin(client);
    await plugin.start();
    plugin.steer(1, 0);
    plugin.onClientTick();
    assert.equal(plugin.getUiState().visible, true);
    plugin.setEnabledState(false);
    await plugin.stop();
    assert.equal(plugin.getUiState().visible, false, "hidden when disabled");
    assert.equal(stops.length, 1, "the walk stops");
    plugin.setEnabledState(true);
    await plugin.start();
    plugin.onClientTick();
    assert.equal(plugin.getUiState().visible, true, "back when enabled again");
    console.log("touch controls plugin test passed");
})();

// Portrait Mode layout: the stick comes back smaller and above the minimap (hudInset is the
// distance from the bottom to the minimap's top), and steps aside while a bank or shop is open.
void (async () => {
    const { setMobilePortraitLayoutActive } = await import("../game/plugins/portraitmode/PortraitLayout");
    const parents = new Map<number, { type: number }>();
    const widgets = new Map<number, { x?: number; y?: number; parentUid?: number }>([
        [(601 << 16) | 20, { x: 0, y: 0, parentUid: -1 }],
        [(601 << 16) | 22, { x: 2, y: 1600, parentUid: (601 << 16) | 20 }],
    ]);
    const { client } = makeClient({
        renderer: { canvas: { width: 1000, height: 2000, clientWidth: 500, clientHeight: 1000 } },
        widgetManager: {
            rootInterface: 601,
            canvasWidth: 625,
            interfaceParents: parents,
            isEffectivelyHidden: () => false,
            getWidgetByUid: (uid: number) => widgets.get(uid),
        },
    } as Partial<TouchControlsClient>);
    setMobilePortraitLayoutActive(true);
    try {
        const plugin = new TouchControlsPlugin(client);
        await plugin.start();
        plugin.onClientTick();
        const state = plugin.getUiState();
        assert.equal(state.visible, true, "the stick shows in portrait");
        assert.equal(state.portrait, true, "drawn as the portrait stick");
        assert.equal(state.hudInset, 200, "lifted above the minimap");
        assert.equal(state.stonesInset, 0, "the stones are along the bottom, not on the right");
        assert.equal(state.scale, 1, "phone-sized controls stay compact");
        client.renderer!.canvas!.clientWidth = 1000;
        plugin.onClientTick();
        assert.equal(plugin.getUiState().scale, 2, "joystick and action controls follow a larger mobile viewport without reload");
        client.renderer!.canvas!.clientWidth = 500;
        plugin.onClientTick();
        assert.equal(plugin.getUiState().scale, 1, "shrinking restores the compact size");

        parents.set((601 << 16) | 27, { type: 0 });
        plugin.onClientTick();
        assert.equal(plugin.getUiState().visible, false, "a bank or shop hides it in portrait");
        parents.clear();
        plugin.onClientTick();
        assert.equal(plugin.getUiState().visible, true, "back once it closes");
    } finally {
        setMobilePortraitLayoutActive(false);
    }
    console.log("touch controls portrait test passed");
})();
