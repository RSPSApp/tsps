// Native Geomancy widget input with all plugins and real game objects; only transport/message output is captured.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const ROOT = path.resolve(__dirname, "..");
let core, spell, Data, Patches;
let actorIndex = 100;

before(async () => {
    await CachePipeline.initialize(ROOT);
    PluginManager.loadFromDirectory(path.join(ROOT, "plugins"));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
    core.RegionManager.loadMapFiles(1800, 3500);
    Data = require("../plugins/skills/farming/Data.Farming");
    Patches = require("../plugins/skills/farming/Patches.Farming");
    Data.initializeFarmingData();
    spell = core.CacheDefinitions.getSpellByName("Geomancy");
    assert.ok(spell);
});

function channel() {
    return {
        kind: "test",
        remoteAddress: "127.0.0.1",
        isOpen: () => true,
        send: () => true,
        close() {},
        onData() {},
        onError() {},
        onClose() {},
    };
}

function shopper(t, { points = 500, female = false } = {}) {
    const transport = channel(),
        p = new Player(new PlayerSession(transport));
    p.setUsername("titheqa" + actorIndex);
    p.setIndex(actorIndex++);
    p.setRegistered(true);
    p.setLocation(new core.Location(1800, 3500, 0));
    p.needsPlacement = false;
    if (female) p.getAppearance().setLook(0, 1);
    const messages = [];
    t.mock.method(p.getPacketSender(), "sendMessage", (text) => {
        messages.push(text);
        return p.getPacketSender();
    });
    Patches.farmFor(p).tithe = { points, score: 0 };
    const npc = core.NPC.create(
        core.CacheDefinitions.getNpcId("hosidius_tithe_farmer"),
        new core.Location(1801, 3500, 0),
    );
    const connection = new ClientConnection(transport);
    connection.player = p;
    return {
        p,
        npc,
        connection,
        messages,
        score: () => Patches.farmFor(p).tithe,
        open: () =>
            PluginManager.emitNpcInteraction({
                player: p,
                npc,
                definition: npc.getDefinition(),
                clickType: 3,
                handled: false,
            }),
    };
}
async function purchase(f, index, op = 2) {
    const uid = core.CacheDefinitions.getComponentId("omnishop_main:list");
    await f.connection.dispatch([
        {
            type: "widget_action",
            widgetId: uid,
            groupId: uid >>> 16,
            childId: uid & 65535,
            slot: index * 12,
            buttonNum: op,
        },
    ]);
    f.connection.processTurnPackets();
}
test("Gricoller opens the native cache-defined reward shop and points", (t) => {
    const f = shopper(t);
    f.open();
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("omnishop_main"));
    assert.equal(
        f.p.getPacketSender().getVarp(core.CacheDefinitions.getVarpId("omnishop_lastshop")),
        core.CacheDefinitions.getDbRowId("tithe_shop_data"),
    );
    assert.equal(
        f.p
            .getPacketSender()
            .getVarbit(core.CacheDefinitions.getVarbitId("hosidius_tithe_rewardpoints")),
        500,
    );
});
// #6474: Talk-to used to open the reward shop too. It plays his dialogue now, and "Have you any
// rewards?" in it opens the shop. Decoded npc_option and dialogue packets on a world NPC.
test("Talk-to plays Gricoller's dialogue; his rewards line and the Rewards option open the shop", async (t) => {
    const f = shopper(t);
    core.World.getNpcs().add(f.npc);
    t.after(() => core.World.getNpcs().remove(f.npc));
    const shop = core.CacheDefinitions.getInterfaceId("omnishop_main");
    const tick = () => {
        core.TaskManager.processWalkTo(f.p.getIndex());
        f.p.getMovementQueue().process();
        core.TaskManager.process();
        f.connection.processTurnPackets();
    };
    const send = async (packet) => {
        await f.connection.dispatch([packet]);
        for (let i = 0; i < 3; i++) tick();
    };
    const group = () => f.p.getPacketSender().getChatboxGroupId();
    async function menu() {
        for (let i = 0; i < 20; i++) {
            const current = f.p.getDialogueManager().getCurrent();
            if (typeof current?.getOptions === "function") return current.getOptions();
            const pending = MultiChatboxPrompt.getPending(f.p);
            if (pending) return pending.options;
            if (!f.p.getDialogueManager().isActive()) return null;
            await send({ type: "dialogue_continue", widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
        }
        return null;
    }
    assert.deepEqual(f.npc.getDefinition().getActions().slice(0, 3), ["Talk-to", undefined, "Rewards"]);

    await send({ type: "npc_option", index: f.npc.getIndex(), clickType: 1 });
    assert.notEqual(f.p.getInterfaceId(), shop, "Talk-to does not open the shop");
    const options = await menu();
    assert.ok(options?.includes("Have you any rewards?"), JSON.stringify(options));
    assert.notEqual(f.p.getInterfaceId(), shop);
    await send({ type: "dialogue_continue", widgetId: (219 << 16) | 1, childIndex: options.indexOf("Have you any rewards?") + 1 });
    // The player says the line, then the dialogue's action opens the shop.
    for (let i = 0; i < 5 && f.p.getInterfaceId() !== shop && f.p.getDialogueManager().isActive(); i++)
        await send({ type: "dialogue_continue", widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
    assert.equal(f.p.getInterfaceId(), shop, "his rewards line opens the shop");

    f.p.getPacketSender().sendInterfaceRemoval();
    f.p.getDialogueManager().interrupt?.();
    await send({ type: "npc_option", index: f.npc.getIndex(), clickType: 3 });
    assert.equal(f.p.getInterfaceId(), shop, "the Rewards option opens it directly");
});

test("native outfit purchases use current body type and deduct exact prices", async (t) => {
    for (const female of [false, true]) {
        const f = shopper(t, { points: 150, female });
        f.open();
        await purchase(f, 1);
        const id = core.CacheDefinitions.getObjId(
            "tithe_reward_torso_" + (female ? "female" : "male"),
        );
        assert.equal(f.p.getInventory().getAmount(id), 1);
        assert.equal(f.score().points, 0);
        await purchase(f, 1);
        assert.equal(f.p.getInventory().getAmount(id), 1);
    }
});
test("compost is sold noted and five-unit native purchase costs five points", async (t) => {
    const f = shopper(t, { points: 5 });
    f.open();
    await purchase(f, 4, 3);
    const id = core.CacheDefinitions.getItem(Data.itemId("Compost")).note;
    assert.equal(f.p.getInventory().getAmount(id), 5);
    assert.equal(f.score().points, 0);
});
test("blessings require Bologa then grant twenty per point", async (t) => {
    const f = shopper(t, { points: 2 });
    f.open();
    await purchase(f, 7);
    assert.equal(f.score().points, 2);
    const Tithe = require("../plugins/skills/farming/Tithe.Farming");
    f.p.getPacketSender().sendInterfaceRemoval();
    f.p.getSkillManager().setCurrentLevel(core.Skill.PRAYER, 50, false);
    f.p.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 75000), false);
    const worn = Data.itemId("Unholy symbol");
    f.p.getEquipment().setItem(core.CacheDefinitions.getItem(worn).wearPos, new core.Item(worn));
    const bologa = core.NPC.create(
        Array.from({ length: core.CacheDefinitions.getCounts().npcs }, (_, id) => id).find(
            (id) => core.CacheDefinitions.getNpc(id).name === "Bologa",
        ),
        f.p.getLocation().clone(),
    );
    Tithe.titheNpc({
        player: f.p,
        npc: bologa,
        definition: bologa.getDefinition(),
        handled: false,
    });
    await f.connection.dispatch([
        {
            type: "dialogue_continue",
            widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID,
            childIndex: 1,
        },
    ]);
    f.connection.processTurnPackets();
    assert.equal(f.score().bologa, true);
    f.p.getEquipment().resetItems();
    f.open();
    await purchase(f, 7);
    assert.equal(f.p.getInventory().getAmount(Data.itemId("Bologa's blessing")), 20);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
    assert.equal(f.score().points, 1);
});
test("full inventory and stack cap refuse before points are charged", async (t) => {
    const f = shopper(t, { points: 2 });
    f.score().bologa = true;
    const id = Data.itemId("Bologa's blessing");
    f.p.getInventory().add(new core.Item(id, 2147483637), false);
    while (f.p.getInventory().getFreeSlots())
        f.p.getInventory().add(new core.Item(Data.itemId("Rake")), false);
    f.open();
    await purchase(f, 7);
    assert.equal(f.p.getInventory().getAmount(id), 2147483637);
    assert.equal(f.score().points, 2);
    await purchase(f, 0);
    assert.equal(f.score().points, 2);
});
test("seed packs retain their generated tier-three Tithe contents", async (t) => {
    const f = shopper(t, { points: 30 });
    f.open();
    await purchase(f, 9);
    const pack = f.p
        .getInventory()
        .getValidItems()
        .find((i) => i.getId() === Data.itemId("Seed pack"));
    assert.ok(pack?.getMetaValue("farming:rewards")?.length);
    assert.equal(f.score().points, 0);
});
test("auto-weed unlock costs once and both free toggles work even with a full inventory", async (t) => {
    const f = shopper(t, { points: 50 });
    while (f.p.getInventory().getFreeSlots())
        f.p.getInventory().add(new core.Item(Data.itemId("Rake")), false);
    f.open();
    await purchase(f, 14);
    assert.equal(f.score().points, 0);
    assert.equal(f.score().autoWeedUnlocked, true);
    const before = Patches.farmFor(f.p).autoWeed;
    await purchase(f, 15);
    assert.equal(Patches.farmFor(f.p).autoWeed, !before);
    await purchase(f, 15);
    assert.equal(Patches.farmFor(f.p).autoWeed, before);
    await purchase(f, 14);
    assert.equal(f.score().points, 0);
});
// Issue 6474 item 6: the client builds the list on open and again when varp omnishop_redraw changes
// (client script 7140), and script 4203 swaps the unlock row for the toggle row on farming_blockweeds.
test("auto-weed purchases redraw the shop list after the varbit changes; others do not", async (t) => {
    const f = shopper(t, { points: 100 });
    const sender = () => f.p.getPacketSender();
    const redraw = () => sender().getVarp(core.CacheDefinitions.getVarpId("omnishop_redraw"));
    const blockweeds = () => sender().getVarbit(core.CacheDefinitions.getVarbitId("farming_blockweeds"));
    f.open();
    const start = redraw();
    await purchase(f, 4, 3);
    assert.equal(redraw(), start, "a compost purchase does not redraw");
    await purchase(f, 14);
    assert.deepEqual([blockweeds(), redraw()], [2, start + 1], "unlocking: on, and the list told to redraw");
    await purchase(f, 15);
    assert.deepEqual([blockweeds(), redraw()], [1, start + 2], "toggled off");
    await purchase(f, 15);
    assert.deepEqual([blockweeds(), redraw()], [2, start + 3], "toggled on");
});
test("stale, remote, mid-trade, dead and relogged native purchases cannot grant items", async (t) => {
    for (const mode of ["closed", "remote", "trade", "dead", "state"]) {
        const f = shopper(t);
        f.open();
        if (mode === "closed") f.p.getPacketSender().sendInterfaceRemoval();
        if (mode === "remote") f.p.setLocation(new core.Location(3200, 3200));
        if (mode === "trade") f.p.setStatus(PlayerStatus.TRADING);
        if (mode === "dead") f.p.setHitpoints(0);
        if (mode === "state")
            f.p.setAttribute(Patches.FARM_ATTRIBUTE, structuredClone(Patches.farmFor(f.p)));
        await purchase(f, 0);
        assert.equal(f.score().points, 500, mode);
        assert.equal(f.p.getInventory().getAmount(Data.itemId("Farmer's strawhat")), 0, mode);
    }
});
test("Herb sack base level and existing open seed boxes are checked", async (t) => {
    const f = shopper(t);
    f.open();
    await purchase(f, 11);
    assert.equal(f.score().points, 500);
    f.p.getInventory().add(new core.Item(Data.itemId("Open seed box")), false);
    await purchase(f, 10);
    assert.equal(f.score().points, 500);
});

test("a banked seed box placeholder (amount 0) does not block buying one (issue 6601)", async (t) => {
    const f = shopper(t);
    f.open();
    f.p.getBank(0).setItem(0, new core.Item(Data.itemId("Seed box"), 0));
    assert.equal(f.p.getBank(0).getValidItems().length, 1, "the bank keeps the placeholder as a valid item");
    await purchase(f, 10);
    assert.notEqual(f.score().points, 500, "the purchase went through");
    assert.equal(f.p.getInventory().getAmount(Data.itemId("Seed box")), 1);
    f.p.getBank(0).setItem(0, new core.Item(Data.itemId("Seed box"), 1));
    const points = f.score().points;
    await purchase(f, 10);
    assert.equal(f.score().points, points, "a real banked seed box still blocks a second");
});

test("both body types can return every purchased outfit piece through the native refund dialogue", async (t) => {
    for (const female of [false, true])
        for (const [index, price] of [
            [0, 75],
            [1, 150],
            [2, 125],
            [3, 50],
        ]) {
            const f = shopper(t, { points: price, female });
            f.open();
            await purchase(f, index);
            const item = f.p.getInventory().getValidItems()[0],
                slot = f.p.getInventory().getItems().indexOf(item);
            assert.ok(item);
            assert.equal(f.score().points, 0);
            f.p.getPacketSender().sendInterfaceRemoval();
            PluginManager.emitItemOnNpc({
                player: f.p,
                target: f.npc,
                definition: f.npc.getDefinition(),
                npcId: f.npc.getId(),
                targetIndex: f.npc.getIndex(),
                item,
                itemId: item.getId(),
                slot,
                interfaceId: core.CacheDefinitions.getComponentId("inventory:items"),
                handled: false,
            });
            assert.match(f.p.getDialogueManager().getCurrent()?.getOptions()[0] ?? "", /Return/);
            await f.connection.dispatch([
                {
                    type: "dialogue_continue",
                    widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID,
                    childIndex: 1,
                },
            ]);
            f.connection.processTurnPackets();
            assert.equal(f.score().points, Math.floor(price * 0.8));
            assert.equal(f.p.getInventory().getAmount(item.getId()), 0);
            await f.connection.dispatch([
                {
                    type: "dialogue_continue",
                    widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID,
                    childIndex: 1,
                },
            ]);
            f.connection.processTurnPackets();
            assert.equal(f.score().points, Math.floor(price * 0.8));
        }
});

test("can refill is free and keeps the actual can metadata", async (t) => {
    const f = shopper(t, { points: 0 }),
        item = new core.Item(Data.itemId("Gricoller's can"));
    item.setMetaValue("farming:water", 10);
    item.setMetaValue("test:marker", 42);
    f.p.getInventory().add(item, false);
    const carried = f.p.getInventory().getValidItems()[0];
    f.open();
    await purchase(f, 13);
    assert.equal(carried.getMetaValue("farming:water"), 1000);
    assert.equal(carried.getMetaValue("test:marker"), 42);
    assert.equal(f.score().points, 0);
});

test("generated Gricoller shop binding redirects to native rewards through the shared shop guard", (t) => {
    const f = shopper(t),
        ShopDefinition = core.ShopDefinition;
    const shopId = JSON.parse(
        require("node:fs").readFileSync(path.join(ROOT, "data/definitions/shops.json"), "utf8"),
    ).find((row) => row.name === "Farmer Gricoller's Rewards").id;
    const def = new ShopDefinition(
        shopId,
        "Farmer Gricoller's Rewards",
        "TITHE",
        [],
        100,
        100,
        100,
        "test-cache-data",
    );
    const old = ShopDefinition.all();
    ShopDefinition.replace([...old.filter((d) => d.getId() !== shopId), def]);
    t.after(() => ShopDefinition.replace([...old]));
    core.World.getNpcs().add(f.npc);
    t.after(() => core.World.getNpcs().remove(f.npc));
    assert.equal(PluginManager.emitCanShop(f.p, shopId), false);
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("omnishop_main"));
    f.p.getPacketSender().sendInterfaceRemoval();
    f.p.setLocation(new core.Location(3200, 3200));
    assert.equal(PluginManager.emitCanShop(f.p, shopId), false);
    assert.notEqual(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("omnishop_main"));
});
