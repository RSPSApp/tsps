// Native Tithe reward input with all plugins and real game objects; only transport/message output is captured.
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
const ROOT = path.resolve(__dirname, "..");
let core, Data, Patches;
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

test("a purchased reward updates the real collection log after payment", async (t) => {
    const f = shopper(t, { points: 150 });
    f.open();
    await purchase(f, 0);
    assert.equal(f.p.getInventory().getAmount(Data.itemId("Farmer's strawhat")), 1);
    assert.equal(f.score().points, 75);
    assert.equal(f.p.getAttribute("clog.items")[Data.itemId("Farmer's strawhat")], 1);
});
test("a full bag keeps points and grants no reward", async (t) => {
    const f = shopper(t, { points: 75 });
    while (f.p.getInventory().getFreeSlots())
        f.p.getInventory().add(new core.Item(Data.itemId("Spade")), false);
    const beforeLog = structuredClone(f.p.getAttribute("clog.items") ?? {});
    f.open();
    await purchase(f, 0);
    assert.deepEqual(f.p.getAttribute("clog.items") ?? {}, beforeLog);
    assert.equal(f.score().points, 75);
    assert.equal(f.p.getInventory().getAmount(Data.itemId("Farmer's strawhat")), 0);
});
test("Auto-weed unlock and toggle are virtual and do not spend points again", async (t) => {
    const f = shopper(t, { points: 50 });
    const beforeLog = structuredClone(f.p.getAttribute("clog.items") ?? {}),
        beforeItems = f.p
            .getInventory()
            .getValidItems()
            .map((i) => [i.getId(), i.getAmount()]);
    const logData = require("../plugins/achievements/collectionlog/Data.CollectionLog");
    const category = logData
        .tabs()
        .flatMap((tab) => tab.categories)
        .find((row) => row.name === "Tithe Farm");
    assert.ok(category);
    assert.equal(category.items.includes(core.ItemIdentifiers.AUTO_WEED), false);
    f.open();
    await purchase(f, 14);
    assert.equal(f.score().points, 0);
    assert.equal(Patches.farmFor(f.p).autoWeed, true);
    await purchase(f, 15);
    assert.equal(f.score().points, 0);
    assert.equal(Patches.farmFor(f.p).autoWeed, false);
    assert.deepEqual(f.p.getAttribute("clog.items") ?? {}, beforeLog);
    assert.deepEqual(
        f.p
            .getInventory()
            .getValidItems()
            .map((i) => [i.getId(), i.getAmount()]),
        beforeItems,
    );
});
