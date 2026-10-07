import * as assert from "node:assert/strict";

const { buildMcpServer } = require("../plugins/agent/AgentMcp.plugin.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");

const location = (x: number, y: number, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
const item = (id: number, amount = 1) => ({
    getId: () => id,
    getAmount: () => amount,
    getDefinition: () => ({ getName: () => `item ${id}` }),
});
const skill = { getName: () => "Woodcutting" };

const clientMessages: string[] = [];
const varbits = new Map<number, number>();
const packetSender = {
    getChatboxGroupId: () => 231,
    sendMessage: (message: string) => clientMessages.push(message),
    sendVarbit: (id: number, value: number) => { varbits.set(id, value); return packetSender; },
    getVarbit: (id: number) => varbits.get(id) ?? 0,
    getVarp: () => 0,
    sendInterfaceDisplayState: () => packetSender,
};
class NpcDialogue {
    constructor(private npcId: number, private text: string) {}
    getNpcId() { return this.npcId; }
    getText() { return this.text; }
}
class OptionDialogue {
    constructor(private options: string[]) {}
    getTitle() { return ""; }
    getOptions() { return this.options; }
}
const dialogueManager = {
    index: -1,
    dialogues: new Map<number, unknown>([
        [0, new NpcDialogue(3106, "Hello there.")],
        [1, new OptionDialogue(["Yes please.", "No thanks."])],
    ]),
    isActive() { return this.dialogues.has(this.index); },
    getCurrent() { return this.dialogues.get(this.index); },
};
let bankOpen = false;
let prompt: { title: string; options: string[] } | null = null;
let movingTicks = 0;
let rights = "NONE";
const player = {
    getUsername: () => "Agent1",
    getIndex: () => 1,
    getRights: () => rights,
    setRights: (next: string) => { rights = next; },
    getArea: () => ({ getName: () => "Wilderness", pluginName: "Wilderness" }),
    getPrivateArea: () => null,
    getMovementQueue: () => ({ hasPendingWork: () => movingTicks-- > 0 }),
    getDialogueManager: () => dialogueManager,
    getInterfaceId: () => -1,
    performAnimation: (_animation: unknown) => {},
    getLocation: () => location(3222, 3218),
    getHitpoints: () => 10,
    getRunEnergy: () => 100,
    getPacketSender: () => packetSender,
    getSkillManager: () => ({ getCurrentLevel: () => 1, getMaxLevel: () => 1, getExperience: () => 0 }),
    getInventory: () => ({ getItems: () => [item(1351), null, item(-1), item(590)] }),
    getEquipment: () => ({ getItems: () => [] }),
};
const npc = {
    getIndex: () => 7,
    getId: () => 3106,
    getLocation: () => location(3225, 3220),
    getCurrentDefinition: () => ({ getName: () => "Man", getActions: () => ["Talk-to", null, "Attack", "Pickpocket"] }),
};
const rival = { getUsername: () => "Agent2", getIndex: () => 2, getLocation: () => location(3223, 3218), getPacketSender: () => ({ sendMessage: () => {} }) };
const tree = { getId: () => 1276, getLocation: () => location(3220, 3216) };
const dispatched: any[] = [];

let pluginProfiling = false;
// Headless load players: online until requestLogout.
const loadOnline = new Map<string, any>();
const connectHeadlessClient = async (username: string) => {
    const loadPlayer = {
        attributes: new Map<string, unknown>(),
        location: null as any,
        setAttribute(key: string, value: unknown) { this.attributes.set(key, value); },
        moveTo(tile: any) { this.location = tile; },
        requestLogout: () => loadOnline.delete(username),
    };
    loadOnline.set(username, loadPlayer);
    return { player: loadPlayer };
};

const advanced: any[] = [];
const commandRights: string[] = [];
const core = {
    connectHeadlessClient,
    PlayerRights: { DEVELOPER: "DEVELOPER" },
    CanAttackResponse: { CAN_ATTACK: 0, CANT_ATTACK_IN_AREA: 1, 0: "CAN_ATTACK", 1: "CANT_ATTACK_IN_AREA" },
    CombatFactory: {
        canAttackPermission: (attacker: any, target: any) => {
            attacker.getPacketSender().sendMessage("You can't attack your own team in Castle Wars.");
            return target === rival ? 1 : 0;
        },
    },
    TeleportHandler: { checkReqs: (_p: unknown, destination: any) => destination.getY() < 3520 },
    CacheDefinitions: {
        getSpellByName: (name: string) => (name.toLowerCase() === "varrock teleport" ? { widgetId: (218 << 16) | 23, itemId: 20 } : undefined),
    },
    PluginManager: {
        emitCustomEvent: (name: string, event: any) => {
            advanced.push([name, event.ms]);
            if (name === "agent:advance-time") event.handledBy.push("Farming");
        },
    },
    Location: class { constructor(private x: number, private y: number, private z: number) {} getX() { return this.x; } getY() { return this.y; } getZ() { return this.z; } },
    RegionManager: { blocked: () => false },
    ServerPerf: {
        getSummary: (ticks: number) => ({
            ticks, avgTickMs: 12.34567, maxTickMs: 40, avgDriftMs: 0, maxDriftMs: 1, lastTickNumber: 9,
            lastPlayers: 1, lastNpcs: 2, lastTasks: 3, topPhases: [{ name: "area", totalMs: 6, avgMs: 0.1, maxMs: 0.5 }],
        }),
    },
    PluginPerf: {
        snapshot: () => [{
            pluginName: "Wilderness", calls: 4, errors: 0, totalMs: 1.23456, avgMs: 0.3, maxMs: 0.5,
            topEventName: "area:process", topEventCalls: 4, topEventTotalMs: 1.2, topEventAvgMs: 0.3, topEventP95Ms: 0.5,
        }],
        reset: () => {},
        setEnabled: (enabled: boolean) => { pluginProfiling = enabled; },
        isEnabled: () => pluginProfiling,
    },
    World: {
        // One tick per millisecond, matching GAME_ENGINE_PROCESSING_CYCLE_RATE below.
        getProcessCycle: () => Date.now(),
        getPlayerByName: (name: string) => (name.toLowerCase() === "agent1" ? player : name.toLowerCase() === "agent2" ? rival : loadOnline.get(name)),
        getPlayers: () => ({ stream: () => [player, ...loadOnline.values()] }),
        getNpcs: () => ({ stream: () => [npc, null], get: (index: number) => (index === 7 ? npc : undefined) }),
        getItems: () => [{ getItem: () => item(526), getPosition: () => location(3223, 3218) }],
    },
    MapObjects: {
        mapObjects: new Map([["3220,3216,0", [tree]]]),
        getHash: (x: number, y: number, z: number) => `${x},${y},${z}`,
    },
    ObjectDefinition: { forPlayer: () => ({ getName: () => "Tree", getInteractions: () => ["Chop down", null] }) },
    ItemDefinition: { forId: (id: number) => ({ getName: () => `item ${id}` }) },
    NpcDefinition: { forId: () => ({ getName: () => "Man" }) },
    MultiChatboxPrompt: { OPTIONS_WIDGET_ID: (219 << 16) | 1, getPending: () => prompt },
    NpcDialogue,
    OptionDialogue,
    PlayerDialogue: class {},
    StatementDialogue: class {},
    ItemStatementDialogue: class {},
    Bank: {
        MAIN_INTERFACE_ID: 12,
        SIDE_INTERFACE_ID: 15,
        isOpen: () => bankOpen,
        layout: () => [{ tab: 0, slot: 0, item: item(995, 23) }],
        displayItemId: (bankItem: any) => bankItem.getId(),
    },
    ShopManager: {
        MAIN_INTERFACE_ID: 300,
        SIDE_INTERFACE_ID: 301,
        getOpenShop: () => ({ name: "General Store", currency: "Coins", stock: [{ itemId: 1931, amount: 5, price: 1 }] }),
    },
    Skill: { values: () => [skill] },
    GameConstants: { GAME_ENGINE_PROCESSING_CYCLE_RATE: 1 },
    dispatchClientMessages: (target: unknown, messages: unknown[]) => {
        assert.equal(target, player);
        for (const message of messages as any[]) if (message.type === "chat" && message.text.startsWith("::")) commandRights.push(rights);
        dispatched.push(...messages);
        // Stand in for the server: continue advances the dialogue, an option click ends it.
        for (const message of messages as any[]) {
            if (message.type === "dialogue_continue") dialogueManager.index++;
            if (message.type === "widget_action" && message.groupId === 231) dialogueManager.index = -1;
        }
        return true;
    },
};

const call = async (client: any, name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content[0].text;
    return { error: !!result.isError, text, value: result.isError ? null : JSON.parse(text) };
};

(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(core).connect(serverTransport);
    const client = new Client({ name: "smoke", version: "1.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    assert.ok(tools.some((tool: any) => tool.name === "observe"));

    // Game messages are recorded once an agent has touched the player, and still reach the client.
    let { value: snapshot } = await call(client, "observe", { player: "agent1" });
    player.getPacketSender().sendMessage("You swing your axe at the tree.");
    assert.deepEqual(clientMessages, ["You swing your axe at the tree."]);

    const observed = await call(client, "observe", { player: "agent1" });
    if (observed.error) throw new Error(observed.text);
    snapshot = observed.value;
    assert.equal(snapshot.x, 3222);
    assert.deepEqual(snapshot.skills.Woodcutting, { level: 1, max: 1, xp: 0 });
    assert.deepEqual(snapshot.inventory[0], { slot: 0, id: 1351, name: "item 1351", amount: 1 });
    assert.deepEqual(snapshot.npcs[0].options, ["Talk-to", "Attack", "Pickpocket"]);
    assert.deepEqual(snapshot.objects, [{ id: 1276, name: "Tree", options: ["Chop down"], x: 3220, y: 3216 }]);
    assert.equal(snapshot.groundItems[0].id, 526);
    assert.deepEqual(snapshot.messages, ["You swing your axe at the tree."]);
    assert.deepEqual((await call(client, "observe", { player: "agent1" })).value.messages, []);

    // The mock player never moves, so a walk elsewhere reports stuck and a walk to its own tile arrives.
    assert.equal((await call(client, "walk_to", { player: "agent1", x: 3230, y: 3230, run: true })).value.result, "stuck");
    assert.equal((await call(client, "walk_to", { player: "agent1", x: 3222, y: 3218 })).value.result, "arrived");
    await call(client, "npc_option", { player: "agent1", index: 7, option: "pickpocket" });
    await call(client, "object_option", { player: "agent1", id: 1276, x: 3220, y: 3216, option: "Chop down" });
    await call(client, "inventory_option", { player: "agent1", slot: 0, option: "Wield" });
    await call(client, "inventory_option", { player: "agent1", item: "ITEM 1351", option: "Drop" });
    await call(client, "chat", { player: "agent1", text: "::tele 3222 3218" });
    const interacted = (await call(client, "interact", { player: "agent1", target: "man", option: "Attack" })).value;
    assert.deepEqual(interacted.clicked, { kind: "npc", name: "Man", x: 3225, y: 3220 });
    assert.equal(interacted.result, "idle");
    await call(client, "interact", { player: "agent1", target: "Tree", option: "chop down" });
    await call(client, "interact", { player: "agent1", target: "item 526", option: "Take" });
    assert.deepEqual(dispatched, [
        { type: "move", worldX: 3230, worldY: 3230, modifierFlags: 2 },
        { type: "move", worldX: 3222, worldY: 3218, modifierFlags: 0 },
        { type: "npc_option", index: 7, clickType: 4 },
        { type: "object_option", id: 1276, x: 3220, y: 3216, action: "Chop down" },
        { type: "inventory_action", slot: 0, itemId: 1351, widgetId: 3214, option: "Wield" },
        { type: "inventory_action", slot: 0, itemId: 1351, widgetId: 3214, option: "Drop" },
        { type: "chat", text: "::tele 3222 3218", messageType: "public" },
        { type: "npc_option", index: 7, clickType: 3 },
        { type: "object_option", id: 1276, x: 3220, y: 3216, action: "Chop down" },
        { type: "ground_item_action", itemId: 526, x: 3223, y: 3218, option: "Take" },
    ]);

    const wrongOption = await call(client, "interact", { player: "agent1", target: "Man", option: "Trade" });
    assert.ok(wrongOption.error && wrongOption.text.includes("Talk-to, Attack, Pickpocket"));
    const unknown = await call(client, "interact", { player: "agent1", target: "Goblin", option: "Attack" });
    assert.ok(unknown.error && unknown.text.includes("Man, Tree"));
    assert.ok((await call(client, "inventory_option", { player: "agent1", item: "Shrimps", option: "Eat" })).error);

    const missingOption = await call(client, "npc_option", { player: "agent1", index: 7, option: "Trade" });
    assert.ok(missingOption.error && missingOption.text.includes("Talk-to, Attack, Pickpocket"));
    assert.ok((await call(client, "observe", { player: "nobody" })).error);
    assert.ok((await call(client, "inventory_option", { player: "agent1", slot: 1, option: "Eat" })).error);

    const waited = (await call(client, "wait_ticks", { player: "agent1", ticks: 2 })).value;
    assert.equal(waited.x, 3222);
    assert.deepEqual(waited.busy, []);

    // Busy keeps an interact waiting: 3 ticks of movement, then an animation, then idle.
    movingTicks = 3;
    (player as any).performAnimation({});
    const busyWait = (await call(client, "interact", { player: "agent1", target: "Tree", option: "Chop down" })).value;
    assert.equal(busyWait.result, "idle");
    assert.ok(busyWait.ticks > 3, `waited ${busyWait.ticks} ticks`);
    (player as any).performAnimation({});
    assert.deepEqual((await call(client, "wait_ticks", { player: "agent1", ticks: 1 })).value.busy, ["animating"]);

    // An open dialogue ends the wait so the agent can answer it.
    dialogueManager.index = 0;
    const talked = (await call(client, "interact", { player: "agent1", target: "Man", option: "Talk-to" })).value;
    assert.equal(talked.result, "dialogue");
    assert.deepEqual((await call(client, "dialogue", { player: "agent1" })).value,
        { kind: "npc", speaker: "Man", text: "Hello there." });
    assert.ok((await call(client, "dialogue_choose", { player: "agent1", option: "Yes" })).error);
    const next = (await call(client, "dialogue_continue", { player: "agent1" })).value;
    assert.deepEqual(next.dialogue.options, ["Yes please.", "No thanks."]);
    assert.ok((await call(client, "dialogue_continue", { player: "agent1" })).error);
    const chose = (await call(client, "dialogue_choose", { player: "agent1", option: "no" })).value;
    assert.equal(chose.chose, "No thanks.");
    assert.equal(chose.dialogue, null);

    // Plugin menus (sendMultiChatboxPrompt) are answered with a resume on the options widget.
    prompt = { title: "Select an Option", options: ["Who are you?", "Nothing."] };
    assert.deepEqual((await call(client, "dialogue", { player: "agent1" })).value,
        { kind: "options", title: "Select an Option", options: ["Who are you?", "Nothing."] });
    dispatched.length = 0;
    await call(client, "dialogue_choose", { player: "agent1", option: 2 });
    assert.deepEqual(dispatched, [{ type: "dialogue_continue", widgetId: (219 << 16) | 1, childIndex: 2 }]);
    prompt = null;

    // Use items, bank and shop by name.
    dispatched.length = 0;
    await call(client, "use_item", { player: "agent1", item: "item 590", targetItem: "item 1351" });
    await call(client, "use_item", { player: "agent1", item: "item 590", target: "Tree" });
    assert.ok((await call(client, "bank", { player: "agent1" })).error);
    bankOpen = true;
    assert.deepEqual((await call(client, "bank", { player: "agent1" })).value, [{ name: "item 995", amount: 23 }]);
    await call(client, "bank_withdraw", { player: "agent1", item: "item 995", amount: 13 });
    await call(client, "bank_deposit", { player: "agent1", item: "item 590", amount: "all" });
    assert.equal((await call(client, "shop", { player: "agent1" })).value.items[0].name, "item 1931");
    await call(client, "shop_buy", { player: "agent1", item: "item 1931", amount: 6 });
    await call(client, "shop_sell", { player: "agent1", item: "item 1351", amount: "all" });
    const bank = { type: "widget_action", widgetId: (12 << 16) | 12, groupId: 12, childId: 12, slot: 0, itemId: 995, buttonNum: 1 };
    const buy = { type: "widget_action", widgetId: (300 << 16) | 16, groupId: 300, childId: 16, slot: 1, itemId: 1931, buttonNum: 1 };
    assert.deepEqual(dispatched, [
        { type: "inventory_use_on", slot: 3, itemId: 590, target: { kind: "inventory", slot: 0, itemId: 1351 } },
        { type: "inventory_use_on", slot: 3, itemId: 590, target: { kind: "loc", id: 1276, x: 3220, y: 3216, level: 0 } },
        { type: "dialogue_amount", amount: 13 },
        { ...bank, option: "Withdraw-X" },
        { type: "widget_action", widgetId: (15 << 16) | 3, groupId: 15, childId: 3, slot: 3, itemId: 590, buttonNum: 1, option: "Deposit-All" },
        { ...buy, option: "Buy 5" },
        { ...buy, option: "Buy 1" },
        { type: "widget_action", widgetId: 301 << 16, groupId: 301, childId: 0, slot: 0, itemId: 1351, buttonNum: 1, option: "Sell 1" },
    ]);
    assert.ok((await call(client, "bank_withdraw", { player: "agent1", item: "Shrimps" })).error);

    // Admin commands run as a developer for that call only.
    dispatched.length = 0;
    await call(client, "command", { player: "agent1", text: "tele 3093 3493", ticks: 1 });
    assert.deepEqual(dispatched, [{ type: "chat", text: "::tele 3093 3493", messageType: "public" }]);
    assert.equal(commandRights.at(-1), "DEVELOPER", "the command runs as a developer");
    assert.equal(rights, "NONE", "the player's own rank is restored");

    // Rule probes report the real verdict and what it told the player.
    let verdict = (await call(client, "can_attack", { attacker: "agent1", target: { player: "agent2" } })).value;
    assert.deepEqual(verdict, { response: "CANT_ATTACK_IN_AREA", allowed: false, messages: ["You can't attack your own team in Castle Wars."] });
    verdict = (await call(client, "can_attack", { attacker: "agent1", target: { npc: 7 } })).value;
    assert.equal(verdict.allowed, true);
    assert.ok((await call(client, "can_attack", { attacker: "agent1", target: { npc: 99 } })).error);
    assert.equal((await call(client, "can_teleport", { player: "agent1", x: 3093, y: 3493 })).value.allowed, true);
    assert.equal((await call(client, "can_teleport", { player: "agent1", x: 3093, y: 3700 })).value.allowed, false);

    // Player options and spells go out as the packets a client sends.
    dispatched.length = 0;
    await call(client, "player_option", { player: "agent1", target: "agent2", option: "Attack", ticks: 0 });
    await call(client, "cast_spell", { player: "agent1", spell: "Varrock Teleport", ticks: 0 });
    await call(client, "cast_spell", { player: "agent1", spell: "varrock teleport", target: { npc: 7 }, ticks: 0 });
    assert.deepEqual(dispatched, [
        { type: "player_option", index: 2, option: 1 },
        { type: "widget_action", widgetId: (218 << 16) | 23, groupId: 218, childId: 23, buttonNum: 1, option: "Cast", itemId: 20 },
        { type: "spell_on_npc", targetIndex: 7, spellWidget: (218 << 16) | 23, spellChild: -1, spellItemId: 20 },
    ]);
    assert.ok((await call(client, "cast_spell", { player: "agent1", spell: "Not A Spell" })).error);

    // Time skips go to the plugins that keep timed state.
    const skipped = (await call(client, "advance_time", { player: "agent1", minutes: 80, ticks: 0 })).value;
    assert.deepEqual([skipped.handledBy, advanced.at(-1)], [["Farming"], ["agent:advance-time", 80 * 60_000]]);

    // What the client was told comes back once, alongside the player's area.
    player.getPacketSender().sendVarbit(5963, 1);
    player.getPacketSender().sendInterfaceDisplayState((90 << 16) | 43, true);
    const seen = (await call(client, "observe", { player: "agent1", varbits: [5963] })).value;
    assert.deepEqual(seen.area, { name: "Wilderness", plugin: "Wilderness", private: false });
    assert.deepEqual(seen.client, { varbits: { 5963: 1 }, interfaces: ["hide 90:43"] });
    assert.deepEqual(seen.varbitValues, { 5963: 1 });
    assert.equal((await call(client, "observe", { player: "agent1" })).value.client.varbits, undefined, "reported once");

    // Perf numbers come back as data, rounded to the microsecond.
    const serverPerf = (await call(client, "server_perf", { ticks: 30 })).value;
    assert.equal(serverPerf.ticks, 30);
    assert.equal(serverPerf.avgTickMs, 12.346);
    assert.equal(serverPerf.topPhases[0].name, "area");
    const pluginPerf = (await call(client, "plugin_perf", { profiling: "on" })).value;
    assert.equal(pluginPerf.profiling, true);
    assert.deepEqual([pluginPerf.plugins[0].pluginName, pluginPerf.plugins[0].totalMs], ["Wilderness", 1.235]);
    assert.equal((await call(client, "plugin_perf", { profiling: "off" })).value.profiling, false);

    // Load players log in scattered around the spot, are never saved, and number on from the
    // last one with that prefix.
    let spawned = (await call(client, "load_spawn", { count: 3, x: 3200, y: 3200, radius: 2, wanderChance: 0 })).value;
    assert.deepEqual([spawned.spawned, spawned.loadPlayers, spawned.playersOnline], [3, 3, 4]);
    spawned = (await call(client, "load_spawn", { count: 2, x: 3100, y: 3500, radius: 0, wanderChance: 0 })).value;
    assert.ok(loadOnline.has("load5"));
    assert.equal(loadOnline.get("load1").attributes.get("bot-skip-persistence"), true);
    assert.equal(loadOnline.get("load5").location.getY(), 3500);
    assert.ok(Math.abs(loadOnline.get("load1").location.getX() - 3200) <= 2);
    const statusValue = (await call(client, "load_status", {})).value;
    assert.equal(statusValue.loadPlayers, 5);
    assert.equal(Object.keys(statusValue.spots).length, 2);
    const sampled = await call(client, "perf_sample", { seconds: 5 });
    if (sampled.error) throw new Error(sampled.text);
    const sample = sampled.value;
    assert.deepEqual([sample.loadPlayers, sample.playersOnline, sample.server.ticks], [5, 6, 5000]);
    assert.equal(pluginProfiling, false, "perf_sample restores the profiling state it found");
    assert.deepEqual((await call(client, "load_despawn", {})).value, { removed: 5, loadPlayers: 0 });
    assert.equal(loadOnline.size, 0);

    await client.close();
    console.log("agent-mcp smoke passed");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
