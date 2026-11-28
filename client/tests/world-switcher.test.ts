// The World Switcher in the side panel: the cache's own interface (69) and scripts, fed the
// client's world list through the WORLDLIST_* commands, and the client answering what is pressed in it.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import type { ServerListEntry } from "../game/login/renderer/types";
import {
    LOGOUT_WORLD_SWITCHER_UID, VARBIT_WORLDSWITCHER_FAVOURITE_1, VARBIT_WORLDSWITCHER_FAVOURITE_2, VARBIT_WORLDSWITCHER_SORT,
    WorldSwitcher, type WorldSwitcherHost, worldKey,
} from "../game/worldswitcher/WorldSwitcher";
import { WorldList, WorldLocation, currentWorldNumber, isCurrentServer, sortWorlds, switcherWorlds, worldLocation, worldNumbers } from "../game/worldswitcher/worldList";
import { createScriptEvent, ExecutionState } from "../rs/cs2/Cs2Vm";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerClientOps } from "../rs/cs2/handlers/ClientOps";
import { createCacheVm } from "../scripts/cache/cs2-sweep";

const server = (name: string, id: string, playerCount: number | null, location?: string, extra: Partial<ServerListEntry> = {}): ServerListEntry => ({
    name, address: `${id}.example`, secure: true, playerCount, maxPlayers: 2047, transport: "websocket", id,
    ...(location ? { location } : {}), ...extra,
});
/** Four in the United States and one in the United Kingdom; one offline, one that did not say how many are on. */
const fiveWorlds = (): ServerListEntry[] => [
    server("Example Dallas", "dallas", 12, "Dallas 8"),
    server("Example New York", "new-york", 3, "New York 1"),
    server("Example London", "london", 40, "London 2"),
    server("Example Chicago", "chicago", null, "Chicago 1"),
    server("Example Miami", "miami", -1, "Miami 3"),
];
const onNewYork = { serverAddress: "new-york.example", serverSecure: true, serverTransport: "websocket" as const, serverName: "Example New York" };

// ---- The list itself --------------------------------------------------------------------------

{
    // A location in words is a flag: by country or city, by code only in the location itself.
    const { UNITED_STATES, UNITED_KINGDOM, AUSTRALIA, GERMANY, CANADA, NETHERLANDS, SWEDEN, FINLAND, UNKNOWN } = WorldLocation;
    for (const [location, name, expected] of [
        ["Dallas 8", "Example", UNITED_STATES], ["New York 1", "", UNITED_STATES], ["Dallas, US", "", UNITED_STATES], ["us", "", UNITED_STATES],
        ["London 2", "", UNITED_KINGDOM], ["United Kingdom", "", UNITED_KINGDOM], ["UK", "", UNITED_KINGDOM], ["lon-gb", "", UNITED_KINGDOM],
        ["Frankfurt, DE", "", GERMANY], ["Sydney", "", AUSTRALIA], ["Toronto 1", "", CANADA], ["nl-ams", "", NETHERLANDS], ["Stockholm", "", SWEDEN], ["Helsinki, FI", "", FINLAND],
        [undefined, "Example New York", UNITED_STATES], ["node 3", "Example London", UNITED_KINGDOM],
        ["node 3", "Bring us de gold", UNKNOWN], [undefined, "Example", UNKNOWN], ["", "", UNKNOWN],
        // A stated location no table knows, and the country in capitals in the name.
        ["SD", "4 - Example - US SD", UNITED_STATES], ["United Kindom", "5 - Example - UK", UNITED_KINGDOM],
    ] as [string | undefined, string, number][]) {
        assert.equal(worldLocation(location, name), expected, `${location} / ${name}`);
    }

    // Numbers: the list's own, else the first free ones in list order; never one twice, never above 900.
    assert.deepEqual(worldNumbers(fiveWorlds()), [1, 2, 3, 4, 5]);
    const stated = fiveWorlds().map((entry, index) => ({ ...entry, number: [3, undefined, 3, 7, 901][index] })) as ServerListEntry[];
    assert.deepEqual(worldNumbers(stated), [3, 1, 2, 7, 4], "a number stated twice, or out of range, is not taken");

    // The world we are on: the listed address, over the same kind of connection.
    const list = fiveWorlds();
    assert.equal(isCurrentServer(list[1], onNewYork), true);
    assert.equal(isCurrentServer(list[0], onNewYork), false);
    assert.equal(isCurrentServer({ ...list[1], secure: false }, { ...onNewYork, serverAddress: "other.example" }), false);
    const relay = { name: "Relay", address: "relay.example", secure: true, playerCount: 1, maxPlayers: 2047, transport: "webrtc" as const, signalUrl: "wss://relay.example/signal", worldId: "w1" };
    assert.equal(isCurrentServer(relay, { serverAddress: "relay.example", serverSecure: true, serverTransport: "webrtc", serverSignalUrl: "wss://relay.example/signal", serverWorldId: "w1" }), true);
    assert.equal(isCurrentServer(relay, { serverAddress: "relay.example", serverSecure: true, serverTransport: "webrtc", serverSignalUrl: "wss://relay.example/signal", serverWorldId: "w2" }), false);
    assert.equal(isCurrentServer(undefined, onNewYork), false);

    const { worlds, current } = switcherWorlds(list, onNewYork);
    assert.equal(current, 2);
    assert.deepEqual(worlds.map((world) => [world.id, world.activity, world.location, world.population]), [
        [1, "Example Dallas", UNITED_STATES, 12], [2, "Example New York", UNITED_STATES, 3], [3, "Example London", UNITED_KINGDOM, 40],
        [4, "Offline - Example Chicago", UNITED_STATES, 0], [5, "Example Miami", UNITED_STATES, 0],
    ]);
    // A world the list does not have (an unlisted one, opened by its link) is still shown, as where we are.
    const elsewhere = { serverAddress: "hidden.example", serverSecure: true, serverTransport: "websocket" as const, serverName: "Hidden" };
    const withHidden = switcherWorlds(list, elsewhere);
    assert.equal(withHidden.current, 6);
    assert.equal(currentWorldNumber(list, elsewhere), 6);
    assert.deepEqual(withHidden.worlds.map((world) => world.index), [0, 1, 2, 3, 4, -1]);
    assert.equal(withHidden.worlds[5].activity, "Hidden");

    // WORLDLIST_SORT: a column, its direction, and the column that settles ties.
    const ids = (column: number, descending: boolean, second = 0, secondDescending = false) =>
        sortWorlds(worlds, column, descending, second, secondDescending).map((world) => world.id);
    assert.deepEqual(ids(0, false), [1, 2, 3, 4, 5]);
    assert.deepEqual(ids(0, true), [5, 4, 3, 2, 1]);
    assert.deepEqual(ids(1, false), [4, 5, 2, 1, 3], "by players, ties by number");
    assert.deepEqual(ids(1, true), [3, 1, 2, 4, 5]);
    assert.deepEqual(ids(2, false), [1, 2, 4, 5, 3], "by location: the United States (0) before the United Kingdom (1)");
    assert.deepEqual(ids(2, true), [3, 1, 2, 4, 5]);
    assert.deepEqual(ids(3, false), [1, 3, 5, 2, 4], "by activity: the names, as Java compares strings");
    assert.deepEqual(ids(3, true), [4, 2, 5, 3, 1]);
    assert.deepEqual(ids(7, false), [1, 2, 3, 4, 5], "all the same type: by number");

}

// ---- The cache's own scripts, on a list ---------------------------------------------------------

const { vm } = createCacheVm();
const widgets: any = vm.context.widgetManager;
const vars: any = vm.context.varManager;
widgets.rootInterface = 161;
const scriptErrors: string[] = [];
vm.logError = (error: any) => scriptErrors.push(String(error?.message ?? error));
const quietly = <T>(run: () => T): T => {
    const log = console.log;
    console.log = () => {};
    try {
        return run();
    } finally {
        console.log = log;
    }
};
const runListener = (widget: any, listener: any[]) => {
    vm.executionState = ExecutionState.FINISHED;
    vm.intStackSize = vm.stringStackSize = vm.longStackSize = 0;
    vm.runScriptEvent(createScriptEvent({ args: listener, widget }), 2_000_000);
};
widgets.onLoadListener = (_id: number, widget: any) => runListener(widget, widget.onLoad);
widgets.onLoadInvoker = (widget: any) => vm.invokeEventHandler(widget, "onLoad");
const fire = (widget: any, event: string, context: any = {}) => quietly(() => {
    if (widget.eventHandlers?.[event]) vm.invokeEventHandler(widget, event, context);
    else if (Array.isArray(widget[event])) runListener(widget, widget[event]);
    else assert.fail(`no ${event} on the component`);
});

let listed = fiveWorlds();
let ready = true;
vm.context.worldList = new WorldList({
    ready: () => ready,
    worlds: () => switcherWorlds(listed, onNewYork).worlds,
    current: () => currentWorldNumber(listed, onNewYork),
});

const component = (child: number): any => widgets.getWidgetByUid((69 << 16) | child);
const open = () => quietly(() => {
    widgets.getGroup(69);
    for (const root of widgets.getAllGroupRoots(69) ?? []) widgets.triggerOnLoad(root);
});
const shown = (list: any[] | null | undefined) => (list ?? []).filter((child) => child && !child.hidden && !child.isHidden);
// A row is six components at one height: its background, star, number, flag, players and activity.
const SPRITE_STAR_MEMBERS = 1131;
const FLAG_US = 1133;
const FLAG_UK = 1135;
const CURRENT_WORLD_GREEN = 901389;
const rows = (layer = component(19)) => {
    const byY = new Map<number, any[]>();
    for (const child of shown(layer.children)) byY.set(child.rawY, [...(byY.get(child.rawY) ?? []), child]);
    return [...byY.entries()].sort(([a], [b]) => a - b).map(([, parts]) => {
        const [background, star, number, flag, players, activity] = parts.sort((a, b) => a.childIndex - b.childIndex);
        return {
            number: number.text, star: star.spriteId, flag: flag.spriteId, players: players.text, activity: activity.text,
            current: background.color === CURRENT_WORLD_GREEN, greyed: number.color === 8355711,
        };
    });
};
const numbers = () => rows().map((row) => row.number).join(" ");
/** The list (69:17, which holds the rows and their click zones) is hidden until there are worlds to show. */
const listHidden = () => component(17).hidden === true || component(17).isHidden === true;
/** The click zone of a world's row: the script-made child of 69:18 at the world's number. */
const clickZone = (world: number): any => component(18).children?.[world];

open();
assert.deepEqual(scriptErrors, []);
assert.equal(listHidden(), false);
assert.equal(component(3).text, "Current world - 2");
assert.deepEqual(rows(), [
    { number: "1", star: SPRITE_STAR_MEMBERS, flag: FLAG_US, players: "12", activity: "Example Dallas", current: false, greyed: false },
    { number: "2", star: SPRITE_STAR_MEMBERS, flag: FLAG_US, players: "3", activity: "Example New York", current: true, greyed: true },
    { number: "3", star: SPRITE_STAR_MEMBERS, flag: FLAG_UK, players: "40", activity: "Example London", current: false, greyed: false },
    { number: "4", star: SPRITE_STAR_MEMBERS, flag: FLAG_US, players: "0", activity: "Offline - Example Chicago", current: false, greyed: false },
    { number: "5", star: SPRITE_STAR_MEMBERS, flag: FLAG_US, players: "0", activity: "Example Miami", current: false, greyed: false },
]);
// Each row's click zone is the world's number, with Switch and Favourite; the row we are on has no op script.
for (const world of [1, 2, 3, 4, 5]) {
    const zone = clickZone(world);
    assert.deepEqual(zone.actions.slice(0, 2), ["Switch", "Favourite"]);
    assert.equal(zone.opBase, `<col=ff9040>${world}</col>`);
    assert.equal(!!zone.eventHandlers?.onOp, world !== 2, `world ${world}'s Switch`);
    assert.equal(zone.rawY, (world - 1) * 16, "under its row");
}
assert.equal(shown(component(18).children).length, 5, "and no click zone for a world that is not there");
// No favourites yet: the hint, and two empty slots.
assert.equal(component(22).hidden || component(22).isHidden, false);
assert.equal(shown(component(23).children).length + shown(component(24).children).length, 0);

// Sorting, as clicking each column's header asks for it (script 761 sets worldswitcher_sort and builds again).
const header = { type: 12, number: 13, location: 14, players: 15, activity: 16 };
const clickHeader = (child: number) => fire(component(child), "onOp", { opIndex: 1 });
clickHeader(header.number);
assert.equal(vars.getVarbit(VARBIT_WORLDSWITCHER_SORT), 1, "the column already sorted by turns round");
assert.equal(numbers(), "5 4 3 2 1");
clickHeader(header.number);
assert.equal(numbers(), "1 2 3 4 5");
clickHeader(header.players);
assert.equal(numbers(), "4 5 2 1 3");
clickHeader(header.players);
assert.equal(numbers(), "3 1 2 4 5");
clickHeader(header.location);
assert.equal(numbers(), "1 2 4 5 3", "the United States, then the United Kingdom");
assert.deepEqual(rows().map((row) => row.flag), [FLAG_US, FLAG_US, FLAG_US, FLAG_US, FLAG_UK]);
clickHeader(header.location);
assert.equal(numbers(), "3 1 2 4 5");
clickHeader(header.activity);
assert.equal(numbers(), "1 3 5 2 4");
clickHeader(header.activity);
assert.equal(numbers(), "4 2 5 3 1");
clickHeader(header.type);
assert.equal(numbers(), "1 2 3 4 5", "one type of world: by number");
clickHeader(header.type);
assert.equal(numbers(), "1 2 3 4 5");
assert.equal(rows().find((row) => row.current)?.number, "2", "the world we are on stays marked however the list is sorted");
vars.setVarbit(VARBIT_WORLDSWITCHER_SORT, 0);

// Favourites: the scripts draw the two worlds the varbits name below the list, each with its own Switch.
vars.setVarbit(VARBIT_WORLDSWITCHER_FAVOURITE_1, 3);
vars.setVarbit(VARBIT_WORLDSWITCHER_FAVOURITE_2, 2);
fire(component(0), "onVarTransmit");
assert.deepEqual(rows(component(23)).map((row) => [row.number, row.flag, row.activity, row.current]), [["3", FLAG_UK, "Example London", false]]);
assert.deepEqual(rows(component(24)).map((row) => [row.number, row.activity, row.current]), [["2", "Example New York", true]]);
assert.equal(!!component(23).eventHandlers?.onOp, true);
assert.equal(!!component(24).eventHandlers?.onOp, false, "no Switch to the world we are on");
assert.equal(component(22).hidden || component(22).isHidden, true, "the hint makes way");
// A favourite whose number no world has reads Unavailable.
vars.setVarbit(VARBIT_WORLDSWITCHER_FAVOURITE_1, 77);
fire(component(0), "onVarTransmit");
assert.equal(rows(component(23))[0].activity, "Unavailable");
vars.setVarbit(VARBIT_WORLDSWITCHER_FAVOURITE_1, 0);
vars.setVarbit(VARBIT_WORLDSWITCHER_FAVOURITE_2, 0);

// A refreshed list shows when the scripts next build: a count, a world back up, a sixth world.
listed = fiveWorlds();
listed[3].playerCount = 5;
listed.push(server("Example Sydney", "sydney", 1, "Sydney, AU"));
fire(component(0), "onVarTransmit");
assert.deepEqual(rows().map((row) => `${row.number}:${row.players}:${row.activity}`).slice(3), ["4:5:Example Chicago", "5:0:Example Miami", "6:1:Example Sydney"]);
assert.equal(rows()[5].flag, 1137, "Australia's flag (enum 1125)");

// Until the list is loaded the title says so, and the interface's own timer builds it once it is.
ready = false;
listed = fiveWorlds();
open();
assert.equal(component(3).text, "<col=9f9f9f>Loading...</col>");
assert.equal(listHidden(), true);
fire(component(0), "onTimer");
assert.equal(listHidden(), true);
ready = true;
fire(component(0), "onTimer");
assert.equal(listHidden(), false);
assert.equal(component(3).text, "Current world - 2");
assert.equal(numbers(), "1 2 3 4 5");

// One world, the one we are on.
listed = [fiveWorlds()[1]];
open();
assert.equal(component(3).text, "Current world - 1");
assert.deepEqual(rows().map((row) => [row.number, row.activity, row.current]), [["1", "Example New York", true]]);
// MAP_WORLD is the list's number in the World Switcher's scripts only. The rest of the game keeps 301,
// which the world's own plugins count on (the dwarf cannon sets mcannon_world to 301 % 128 for
// the buff bar's script to compare with it).
{
    const ops = new Map<number, any>();
    registerClientOps(ops as any);
    const mapWorld = (activeWidget: any, worldList = vm.context.worldList) => {
        const stack: number[] = [];
        ops.get(Opcodes.MAP_WORLD)({ activeWidget, worldList, pushInt: (value: number) => stack.push(value) });
        return stack[0];
    };
    assert.equal(mapWorld(component(3)), 1, "the switcher's title");
    assert.equal(mapWorld(clickZone(1)), 1, "a script-made row of the switcher");
    assert.equal(mapWorld(widgets.getWidgetByUid((429 << 16) | 3) ?? { groupId: 429 }), 301, "the friends list");
    assert.equal(mapWorld(null), 301, "a script with no component");
    assert.equal(mapWorld(component(3), null as any), 301, "no list");
    ready = false;
    assert.equal(mapWorld(component(3)), 301, "a list not loaded yet");
    ready = true;
}
// No list: no rows, and MAP_WORLD is what it was before there was one.
vm.context.worldList = undefined;
open();
assert.equal(listHidden(), true);
assert.equal(component(3).text, "<col=9f9f9f>Loading...</col>");
assert.deepEqual(scriptErrors, []);

// ---- What is pressed in it ----------------------------------------------------------------------

const PANE_EMPTY = -1;
function harness(servers = fiveWorlds(), current: any = onNewYork) {
    const calls: string[] = [];
    const varbits = new Map<number, number>();
    const storage = new Map<string, string>();
    const state = {
        servers, current, mounted: 182 as number | undefined, loaded: false, account: "Zezima",
        refresh: undefined as undefined | (() => void), kept: undefined as undefined | (() => void), question: undefined as undefined | { title: string; options: string[]; answer: (option: number) => void },
    };
    const host: WorldSwitcherHost = {
        servers: () => state.servers,
        current: () => state.current,
        listLoaded: () => state.loaded,
        refreshList: () => new Promise<void>((resolve) => {
            calls.push("refresh");
            state.refresh = () => { state.loaded = true; resolve(); };
        }),
        mountedGroup: () => state.mounted,
        mountSwitcher: (hidden) => { state.mounted = 69; calls.push(`mount 69 hiding ${hidden.map((uid) => `${uid >>> 16}:${uid & 0xffff}`)}`); },
        mountLogoutTab: () => { state.mounted = 182; calls.push("mount 182"); },
        showLogoutTab: () => calls.push("tab"),
        runOp: (widget, opIndex) => calls.push(`op ${widget.uid & 0xffff} ${opIndex}`),
        rebuild: () => calls.push("rebuild"),
        getVarbit: (id) => varbits.get(id) ?? 0,
        setVarbit: (id, value) => { varbits.set(id, value); },
        playSound: (id) => calls.push(`sound ${id}`),
        switchToServer: (index, confirmed) => calls.push(`switch ${index} ${confirmed}`),
        stopConfirming: () => new Promise<void>((resolve) => { calls.push("confirmation off"); state.kept = resolve; }),
        logout: () => calls.push("logout"),
        askInChatbox: (title, options, answer) => { state.question = { title, options, answer }; calls.push("ask"); },
        closeChatboxQuestion: () => { state.question = undefined; calls.push("close question"); },
        account: () => state.account,
        load: (key) => storage.get(key) ?? null,
        save: (key, value) => { storage.set(key, value); },
    };
    const switcher = new WorldSwitcher(host);
    const taken = () => calls.splice(0);
    const fixed = (child: number, option: string, opIndex?: number) => switcher.handleAction({ widget: { uid: (69 << 16) | child, groupId: 69, fileId: child }, option, opIndex });
    const zone = (world: number, option: string, opIndex?: number) =>
        switcher.handleAction({ widget: { uid: 0x7f000000 + world, id: (69 << 16) | 18, groupId: 69, fileId: -1, childIndex: world }, option, opIndex });
    const favourites = () => [varbits.get(VARBIT_WORLDSWITCHER_FAVOURITE_1) ?? 0, varbits.get(VARBIT_WORLDSWITCHER_FAVOURITE_2) ?? 0];
    return { switcher, host, state, calls, taken, fixed, zone, favourites, varbits, storage };
}

(async () => {
    {
        const h = harness();
        // Other interfaces' buttons are not ours.
        assert.equal(h.switcher.handleAction({ widget: { uid: (182 << 16) | 8, groupId: 182, fileId: 8 }, option: "Logout" }), false);
        assert.equal(h.switcher.handleAction({ widget: { uid: (161 << 16) | 46, groupId: 161, fileId: 46 }, option: "Logout" }), false);
        assert.equal(h.switcher.handleAction({ widget: null, option: "World Switcher" }), false);
        assert.deepEqual(h.taken(), []);

        // "World Switcher" on the logout tab: the interface goes where the logout tab is, cog hidden.
        assert.equal(h.switcher.handleAction({ widget: { uid: LOGOUT_WORLD_SWITCHER_UID, groupId: 182, fileId: 3 }, option: "World Switcher" }), true);
        assert.deepEqual(h.taken(), ["tab", "mount 69 hiding 69:4", "refresh"]);
        assert.equal(h.switcher.isOpen(), true);
        assert.equal(h.switcher.worldList.fetch(), false, "the scripts wait for the first list");
        assert.equal(h.switcher.worldList.currentWorld(), undefined, "and MAP_WORLD is not ours yet");
        h.state.refresh!();
        await Promise.resolve();
        await Promise.resolve();
        assert.deepEqual(h.taken(), ["rebuild"], "the answers are in: the rows are built again");
        assert.equal(h.switcher.worldList.fetch(), true);
        assert.equal(h.switcher.worldList.currentWorld(), 2);
        assert.deepEqual([h.switcher.worldList.start()?.id, h.switcher.worldList.next()?.id, h.switcher.worldList.specific(3)?.activity, h.switcher.worldList.specific(9)], [1, 2, "Example London", undefined]);

        // The same option on the logout tab's stone, in each layout; already open, it is not mounted twice.
        for (const stone of [(161 << 16) | 46, (164 << 16) | 34, (548 << 16) | 51]) {
            assert.equal(h.switcher.handleAction({ widget: { uid: stone, fileId: stone & 0xffff }, option: "<col=ff9040>World Switcher</col>" }), true);
            assert.deepEqual(h.taken(), ["tab", "refresh"]);
            h.state.refresh!();
            await Promise.resolve();
            await Promise.resolve();
            h.taken();
        }

        // Switch on a row: the hop is asked of the game, by the server's place in the list.
        assert.equal(h.zone(3, "Switch", 1), true);
        assert.deepEqual(h.taken(), ["sound 2266", "switch 2 false"]);
        h.zone(5, "Switch");
        assert.deepEqual(h.taken(), ["sound 2266", "switch 4 false"]);
        // The world we are on, and a number no world has: nothing.
        h.zone(2, "Switch");
        h.zone(40, "Switch");
        assert.deepEqual(h.taken(), ["sound 2266", "sound 2266"]);

        // Favourite: the first free slot, then the second, then the older makes way; never twice.
        h.zone(3, "Favourite", 2);
        assert.deepEqual(h.favourites(), [3, 0]);
        h.zone(3, "Favourite", 2);
        h.zone(1, "Favourite", 2);
        assert.deepEqual(h.favourites(), [3, 1]);
        h.zone(5, "Favourite", 2);
        assert.deepEqual(h.favourites(), [1, 5]);
        h.zone(40, "Favourite", 2);
        assert.deepEqual(h.favourites(), [1, 5]);
        assert.deepEqual(JSON.parse(h.storage.get("worldSwitcher:zezima")!), { sort: 0, favourites: ["id:dallas", "id:miami"] }, "kept by world, per account");
        h.taken();
        // The slots: Switch hops to the world in it, Clear empties it.
        h.fixed(23, "Switch", 1);
        assert.deepEqual(h.taken(), ["sound 2266", "switch 0 false"]);
        h.fixed(24, "Clear", 2);
        assert.deepEqual(h.favourites(), [1, 0]);
        assert.deepEqual(JSON.parse(h.storage.get("worldSwitcher:zezima")!).favourites, ["id:dallas", ""]);
        h.taken();

        // A column header: its own script runs here (it sorts and builds), and the choice is kept.
        h.varbits.set(VARBIT_WORLDSWITCHER_SORT, 8);
        assert.equal(h.fixed(15, "Sort", 1), true);
        assert.deepEqual(h.taken(), ["op 15 1"]);
        assert.equal(JSON.parse(h.storage.get("worldSwitcher:zezima")!).sort, 8);

        // The hidden cog is ours and does nothing. The rest of the interface (the list's scrollbar,
        // whose pieces are script-made too) is left to the interface's own scripts.
        assert.equal(h.fixed(4, "Configure", 1), true);
        assert.equal(h.fixed(19, "", undefined), false);
        assert.equal(h.fixed(18, "", undefined), false);
        assert.equal(h.switcher.handleAction({ widget: { uid: 0x7f000001, id: (69 << 16) | 20, groupId: 69, fileId: -1, childIndex: 1 }, option: "" }), false);
        assert.deepEqual(h.taken(), []);
        // A left click asks before the button's own script runs: the same answers, but not for the button that opens it.
        assert.equal(h.switcher.handleSwitcherAction({ widget: { uid: LOGOUT_WORLD_SWITCHER_UID, groupId: 182, fileId: 3 }, option: "World Switcher" }), false);
        assert.equal(h.switcher.handleSwitcherAction({ widget: { uid: 0x7f000003, id: (69 << 16) | 18, groupId: 69, fileId: -1, childIndex: 3 }, option: "Switch", opIndex: 1 }), true);
        assert.deepEqual(h.taken(), ["sound 2266", "switch 2 false"]);

        // Close: the logout tab comes back. Logout: logs out.
        assert.equal(h.fixed(5, "Close", 1), true);
        assert.deepEqual(h.taken(), ["mount 182"]);
        assert.equal(h.switcher.isOpen(), false);
        h.switcher.close();
        assert.deepEqual(h.taken(), [], "closed already");
        h.fixed(25, "Logout", 1);
        assert.deepEqual(h.taken(), ["logout"]);

        // Opened again, in a list that came in another order and without one of the favourites'
        // worlds: each favourite is its world's number now, the missing one shows as none and
        // is still remembered, and the sort column is as it was left.
        h.varbits.clear();
        h.storage.set("worldSwitcher:zezima", JSON.stringify({ sort: 8, favourites: ["id:dallas", "id:miami"] }));
        h.state.servers = [fiveWorlds()[2], fiveWorlds()[0], fiveWorlds()[1]];
        h.switcher.open();
        assert.deepEqual([h.varbits.get(VARBIT_WORLDSWITCHER_SORT), ...h.favourites()], [8, 2, 0]);
        h.fixed(13, "Sort", 1);
        assert.deepEqual(JSON.parse(h.storage.get("worldSwitcher:zezima")!).favourites, ["id:dallas", "id:miami"], "a favourite the list lacks is not forgotten");
        h.zone(1, "Favourite", 2);
        assert.deepEqual(h.favourites(), [2, 1]);
        assert.deepEqual(JSON.parse(h.storage.get("worldSwitcher:zezima")!).favourites, ["id:dallas", "id:london"], "until its slot, which shows none, is given to another world");
        // Another account in the same browser has its own.
        h.state.account = "Other";
        h.switcher.close();
        h.varbits.clear();
        h.switcher.open();
        assert.deepEqual([h.varbits.get(VARBIT_WORLDSWITCHER_SORT) ?? 0, ...h.favourites()], [0, 0, 0]);
        // What is stored is read with care.
        h.storage.set("worldSwitcher:other", "{ not json");
        h.switcher.close();
        h.switcher.open();
        h.storage.set("worldSwitcher:other", JSON.stringify({ sort: 99, favourites: [7, "id:london"] }));
        h.switcher.close();
        h.switcher.open();
        assert.deepEqual([h.varbits.get(VARBIT_WORLDSWITCHER_SORT) ?? 0, ...h.favourites()], [0, 0, 1]);
    }

    {
        // A layout with no pane for the logout tab: nothing is mounted.
        const h = harness();
        h.state.mounted = undefined;
        h.switcher.open();
        assert.deepEqual(h.taken(), ["tab"]);
        assert.equal(PANE_EMPTY, -1);
        // A world reached without an id on the list (a relay's WebRTC world) is remembered by how it is reached.
        assert.equal(worldKey({ name: "R", address: "relay.example", secure: true, playerCount: 1, maxPlayers: 2047, transport: "webrtc", signalUrl: "wss://relay.example", worldId: "w1" }), "webrtc|relay.example|w1");
        assert.equal(worldKey(fiveWorlds()[0]), "id:dallas");
    }

    {
        // The question before a hop, in the chatbox: Yes goes to the server it named, wherever the list has it by then.
        const h = harness();
        h.switcher.confirm(h.state.servers[2]);
        assert.deepEqual(h.taken(), ["ask"]);
        assert.deepEqual([h.state.question!.title, h.state.question!.options], ["Are you sure you want to switch to world 3?", ["Yes", "Yes, and don't ask again", "No"]]);
        assert.equal(h.switcher.isAsking(), true);
        h.state.question!.answer(2);
        assert.deepEqual(h.taken(), ["close question"], "No: nothing");
        assert.equal(h.switcher.isAsking(), false);

        h.switcher.confirm(h.state.servers[2]);
        h.state.servers = [{ ...fiveWorlds()[2] }, ...fiveWorlds().slice(0, 2)];
        h.state.question!.answer(0);
        assert.deepEqual(h.taken(), ["ask", "close question", "switch 0 true"]);

        // "Yes, and don't ask again": the question is turned off, and the hop waits until the
        // world has kept that.
        h.switcher.confirm(h.state.servers[1]);
        h.state.question!.answer(1);
        assert.deepEqual(h.taken(), ["ask", "close question", "confirmation off"]);
        h.state.kept!();
        await Promise.resolve();
        await Promise.resolve();
        assert.deepEqual(h.taken(), ["switch 1 true"]);

        // A world that did not answer can be chosen as before; the question says how it is.
        h.state.servers = fiveWorlds();
        h.switcher.confirm(h.state.servers[3]);
        assert.equal(h.state.question!.title, "World 4 is not answering. Switch to it anyway?");
        h.state.question!.answer(2);
        h.taken();

        // A world that left the list while it asked: nowhere to go.
        h.switcher.confirm(h.state.servers[2]);
        h.state.servers = fiveWorlds().slice(0, 2);
        h.state.question!.answer(0);
        assert.deepEqual(h.taken(), ["ask", "close question"]);

        // Unanswered: closing the switcher or walking off takes it away; another dialogue replaces it.
        h.state.mounted = 69;
        h.switcher.confirm(h.state.servers[0]);
        h.switcher.close();
        assert.deepEqual(h.taken(), ["ask", "close question", "mount 182"]);
        h.switcher.confirm(h.state.servers[0]);
        h.switcher.questionReplaced();
        h.switcher.dismissQuestion();
        assert.deepEqual(h.taken(), ["ask"], "replaced: there is nothing of ours to close");
    }

    // The game client loads shaders and images as modules: stand-ins, as tests/control-settings.test.ts has.
    (globalThis as any).self = globalThis;
    require.extensions[".glsl"] = (module, file) => { module.exports = readFileSync(file, "utf8"); };
    for (const extension of [".png", ".jpg", ".webp"]) require.extensions[extension] = (module, file) => { module.exports = file; };
    const { OsrsClient } = await import("../game/OsrsClient");

    // Choosing a world, in the game (OsrsClient.switchToServer): while "World Switcher confirmation"
    // is on (All Settings row 347, varbit 4100 at 0) it asks first, in the chatbox as OSRS does;
    // then the client logs out and connects to the world chosen.
    {
        let disableConfirmation = 0;
        const done: string[] = [];
        const here = { name: "Here", address: "here", secure: true, transport: "websocket" };
        const there = { name: "There", address: "there", secure: true, transport: "websocket" };
        let asked: { title: string; options: string[]; answer: (option: number) => void } | undefined;
        const client: any = Object.create(OsrsClient.prototype);
        client.loginRenderer = { serverList: [here, there] };
        client.loginState = { serverTransport: "websocket", serverAddress: "here", serverSecure: true, serverListOpen: false };
        client.varManager = { getVarbit: (id: number) => (id === 4100 ? disableConfirmation : 0) };
        client.performLogout = (after: () => void) => { done.push("logout"); after(); };
        client.processLoginAction = (action: any) => done.push(`${action.type}${action.index ?? ""}`);
        client.worldSwitcher = new WorldSwitcher({
            servers: () => client.loginRenderer.serverList,
            current: () => client.loginState,
            switchToServer: (index: number, confirmed: boolean) => client.switchToServer(index, confirmed),
            askInChatbox: (title: string, options: string[], answer: (option: number) => void) => { asked = { title, options, answer }; },
            closeChatboxQuestion: () => { asked = undefined; },
        } as any);

        client.switchToServer(1, false);
        assert.deepEqual([asked?.title, asked?.options], ["Are you sure you want to switch to world 2?", ["Yes", "Yes, and don't ask again", "No"]], "it asks first");
        assert.deepEqual(done, []);
        asked!.answer(2);
        assert.equal(asked, undefined, "No takes the question away");
        assert.deepEqual(done, []);

        client.switchToServer(1, false);
        // A refresh while it asks puts the server elsewhere in a new list.
        client.loginRenderer.serverList = [{ ...there }, { name: "New", address: "new", secure: true, transport: "websocket" }, { ...here }];
        asked!.answer(0);
        assert.deepEqual(done, ["logout", "select_server0"], "Yes goes to the server it named");

        done.length = 0;
        client.loginRenderer.serverList = [here, there];
        disableConfirmation = 1;
        client.switchToServer(1, false);
        assert.equal(asked, undefined, "with the confirmation off it doesn't ask");
        assert.deepEqual(done, ["logout", "select_server1"]);

        done.length = 0;
        disableConfirmation = 0;
        client.switchToServer(0, false);
        assert.deepEqual(done, ["close_server_list"], "the server we are on: no hop");
        assert.equal(asked, undefined);

        // "Yes, and don't ask again" turns varbit 4100 on in the client and sends its varp (3075)
        // whole for the world to keep, before the logout that the hop starts.
        done.length = 0;
        const varps = new Map<number, number>([[3075, 1 << 3]]);
        client.varManager = {
            getVarbit: (id: number) => (id === 4100 ? (varps.get(3075)! >>> 26) & 1 : 0),
            setVarbit: (id: number, value: number) => { if (id === 4100) varps.set(3075, (varps.get(3075)! & ~(1 << 26)) | ((value & 1) << 26)); },
            getVarp: (id: number) => varps.get(id) ?? 0,
        };
        // The game's own: the varbit is set in the client (sent too, when connected; not here).
        const game = (OsrsClient.prototype as any).createWorldSwitcher.call(Object.assign(Object.create(OsrsClient.prototype), { varManager: client.varManager }));
        await game.host.stopConfirming();
        assert.equal(client.varManager.getVarbit(4100), 1);
        // Connected, it sends varp 3075 (VARP_TRANSMIT, 191) and lets the hop go on only once three
        // ticks have come back: the world takes a transmit on the player's next turn but a logout at once.
        {
            const { state: connection } = await import("../network/serverConnection/state");
            const frames: Uint8Array[] = [];
            const socket = connection.socket;
            connection.socket = { readyState: WebSocket.OPEN, send: (frame: Uint8Array) => frames.push(frame) } as any;
            varps.set(3075, 1 << 3);
            let resolved = false;
            const waiting = game.host.stopConfirming().then(() => { resolved = true; });
            assert.deepEqual([...frames[0] ?? []], [191, 12, 3, 4, 0, 0, 8], "varp 3075 with bit 26 set and the rest as it was");
            const tick = () => { for (const listener of [...connection.tickListeners]) listener(1, 0); };
            tick();
            tick();
            await Promise.resolve();
            assert.equal(resolved, false, "two ticks: not yet");
            tick();
            await waiting;
            assert.equal(resolved, true);
            assert.equal(connection.tickListeners.size, 0, "and it stops listening");
            connection.socket = socket;
        }
        varps.set(3075, 1 << 3);
        const sent: [number, number][] = [];
        let kept: (() => void) | undefined;
        client.worldSwitcher = new WorldSwitcher({
            servers: () => client.loginRenderer.serverList,
            current: () => client.loginState,
            switchToServer: (index: number, confirmed: boolean) => client.switchToServer(index, confirmed),
            stopConfirming: () => new Promise<void>((resolve) => {
                client.varManager.setVarbit(4100, 1);
                sent.push([3075, client.varManager.getVarp(3075)]);
                done.push("confirmation off");
                kept = resolve;
            }),
            askInChatbox: (title: string, options: string[], answer: (option: number) => void) => { asked = { title, options, answer }; },
            closeChatboxQuestion: () => { asked = undefined; },
        } as any);
        client.switchToServer(1, false);
        asked!.answer(1);
        assert.deepEqual(done, ["confirmation off"], "no logout until the world has it");
        kept!();
        await Promise.resolve();
        await Promise.resolve();
        assert.deepEqual(done, ["confirmation off", "logout", "select_server1"]);
        assert.deepEqual(sent, [[3075, (1 << 3) | (1 << 26)]], "the varp's other bits as they were");
        done.length = 0;
        client.switchToServer(1, false);
        assert.equal(asked, undefined, "and it does not ask again");
        assert.deepEqual(done, ["logout", "select_server1"]);
    }

    console.log("world switcher: the cache's interface on a world list, and what is pressed in it");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
