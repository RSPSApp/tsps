import assert from "node:assert/strict";
import { test } from "node:test";

import { Camera } from "../game/Camera";
import { DRAW_NAMES_CLANMATES, DRAW_NAMES_FRIENDS, DRAW_NAMES_OTHERS, DRAW_NAMES_SELF, clientDisplayState, resetClientDisplayState } from "../rs/cs2/ClientDisplayState";
import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";
import { UNSUPPORTED_OPCODES } from "../rs/cs2/handlers/UnsupportedOps";
import { WorldMapState, packWorldMapCoord } from "../rs/map/WorldMapArea";

const handlers = createHandlerMap();
function run(opcode: number, ints: number[] = [], strings: string[] = [], extra: object = {}): any[] {
    const out: any[] = [];
    const ctx: any = { intStack: [...ints], intStackSize: ints.length, stringStack: [...strings], stringStackSize: strings.length,
        pushInt: (v: number) => out.push(v), pushString: (v: string) => out.push(v), ...extra };
    handlers.get(opcode)!(ctx, 0, null as any);
    assert.equal(ctx.intStackSize, 0, `opcode ${opcode} pops its ints`);
    assert.equal(ctx.stringStackSize, 0, `opcode ${opcode} pops its strings`);
    return out;
}

test("reading the camera pitch and writing it back leaves it unchanged", () => {
    const camera = new Camera(0, 0, 0, 0, 0);
    const widgetManager = { osrsClient: { camera } };
    for (let start = 0; start <= 512; start++) {
        camera.snapToPitch(start);
        camera.snapToYaw(700);
        for (let i = 0; i < 3; i++) {
            const [angle] = run(Opcodes.CAM_GETANGLE_XA, [], [], { widgetManager });
            run(Opcodes.CAM_FORCEANGLE, [angle, 0], [], { widgetManager });
            assert.equal(camera.pitch, start, `pitch ${start} survives round trip ${i + 1}`);
        }
        assert.equal(camera.yaw, 0, "the yaw is still turned");
    }
    // An angle the camera does not already report becomes a pitch that reads back as that angle.
    for (let angle = 128; angle <= 383; angle++) {
        camera.snapToPitch(angle === 128 ? 512 : 0);
        run(Opcodes.CAM_FORCEANGLE, [angle, 0], [], { widgetManager });
        assert.deepEqual(run(Opcodes.CAM_GETANGLE_XA, [], [], { widgetManager }), [angle]);
    }
});

test("client_version reports the loaded cache's revision and minor 1", () => {
    const widgetManager = { osrsClient: { loadedCache: { info: { revision: 242 } } } };
    assert.deepEqual(run(Opcodes.CLIENT_VERSION, [], [], { widgetManager, clientRevision: 235 }), [242, 1]);
    assert.deepEqual(run(Opcodes.CLIENT_VERSION, [], [], { widgetManager: {}, clientRevision: 235 }), [235, 1], "before a cache is loaded");
});

test("resume_countdialog takes a whole int with an optional sign, else 0", () => {
    const count = (text: string) => {
        let sent: any;
        const cs2Vm: any = { onInputDialogComplete: (_kind: string, value: number) => (sent = value) };
        run(Opcodes.RESUME_COUNTDIALOG, [], [text], { cs2Vm });
        assert.equal(cs2Vm.inputDialogType, 0);
        return sent;
    };
    assert.equal(count("42"), 42);
    assert.equal(count("+42"), 42, "a leading plus is accepted");
    assert.equal(count("-7"), -7);
    assert.equal(count("2147483647"), 2147483647);
    assert.equal(count("-2147483648"), -2147483648);
    assert.equal(count("2147483648"), 0, "past the int range is 0, not the limit");
    assert.equal(count("99999999999"), 0);
    assert.equal(count(" 42"), 0, "spaces are not trimmed");
    assert.equal(count("42 "), 0);
    assert.equal(count("+"), 0);
    assert.equal(count("-"), 0);
    assert.equal(count("4k"), 0);
    assert.equal(count("+-4"), 0);
    assert.equal(count(""), 0);
});

test("coord is -1 while there is no local player", () => {
    const getters = { getPlayerPlane: () => 1, getPlayerLocalX: () => 3200, getPlayerLocalY: () => 3201 };
    const withPlayer = { osrsClient: { controlledPlayerServerId: 5, playerEcs: { getIndexForServerId: (id: number) => (id === 5 ? 0 : undefined) } } };
    const noPlayer = { osrsClient: { controlledPlayerServerId: -1, playerEcs: { getIndexForServerId: () => undefined } } };
    assert.deepEqual(run(Opcodes.COORD, [], [], { ...getters, widgetManager: withPlayer }), [(1 << 28) | (3200 << 14) | 3201]);
    assert.deepEqual(run(Opcodes.COORD, [], [], { ...getters, widgetManager: noPlayer }), [-1]);
});

test("the world map lists and finds icons whose element or category is turned off", () => {
    const state: any = WorldMapState.empty();
    state.currentArea = { id: 1, containsCoord: () => true, containsPosition: () => true, position: () => undefined };
    const at = (x: number, y: number) => packWorldMapCoord({ plane: 0, x, y });
    state.addStaticIcons(1, [
        { element: 10, category: 3, coord: at(3200, 3200) },
        { element: 11, category: 4, coord: at(3210, 3200) },
        { element: 10, category: 3, coord: at(3300, 3200) },
    ]);
    const list = () => {
        const icons: number[][] = [];
        for (let [element, coord] = run(Opcodes.WORLDMAP_LISTELEMENT_START, [], [], { worldMapState: state }); element !== -1;
            [element, coord] = run(Opcodes.WORLDMAP_LISTELEMENT_NEXT, [], [], { worldMapState: state })) {
            icons.push([element, coord]);
        }
        return icons.sort((a, b) => a[1] - b[1]);
    };
    const all = [[10, at(3200, 3200)], [11, at(3210, 3200)], [10, at(3300, 3200)]];
    assert.deepEqual(list(), all);
    state.setCategoryEnabled(3, false);
    state.setElementEnabled(11, false);
    assert.equal(state.isIconVisible({ element: 10, category: 3 }), false, "the icons are not drawn");
    assert.deepEqual(list(), all, "but they are still listed");
    assert.equal(state.getNearestIconCoord(10, at(3290, 3200)), at(3300, 3200), "and still found");
    state.elementsEnabled = false;
    assert.deepEqual(list(), all);
});

test("setdrawplayernames, setfreecamspeed and platformtype have real handlers", () => {
    for (const opcode of [3120, 3121, 3122, 3123, 3124, 3129, 6527, 3648, 3652]) {
        assert.ok(handlers.has(opcode), `opcode ${opcode} is handled`);
        assert.ok(!UNSUPPORTED_OPCODES.includes(opcode), `opcode ${opcode} is not a neutral stub`);
    }
    resetClientDisplayState();
    run(3120, [1]);
    assert.equal(clientDisplayState.drawPlayerNames, DRAW_NAMES_FRIENDS);
    run(3122, [1]);
    run(3123, [1]);
    assert.equal(clientDisplayState.drawPlayerNames, DRAW_NAMES_FRIENDS | DRAW_NAMES_OTHERS | DRAW_NAMES_SELF);
    run(3121, [1]);
    run(3120, [0]);
    assert.equal(clientDisplayState.drawPlayerNames, DRAW_NAMES_CLANMATES | DRAW_NAMES_OTHERS | DRAW_NAMES_SELF);
    run(3122, [2]);
    assert.equal(clientDisplayState.drawPlayerNames, DRAW_NAMES_CLANMATES | DRAW_NAMES_SELF, "only 1 turns a group on");
    run(3124);
    assert.equal(clientDisplayState.drawPlayerNames, 0);

    run(3129, [20, 5]);
    assert.equal(clientDisplayState.freeCamSpeed, 20);
    assert.equal(clientDisplayState.freeCamSlowSpeed, 5);

    assert.deepEqual(run(6527), [0]);
});
