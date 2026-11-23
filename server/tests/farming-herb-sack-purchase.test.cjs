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

function prepare(t, { base = 58, current = base, points = 250, full = false } = {}) {
    const f = shopper(t, { points });
    f.p
        .getSkillManager()
        .setMaxLevels(core.Skill.HERBLORE, base, false)
        .setCurrentLevel(core.Skill.HERBLORE, current, false);
    if (full)
        while (f.p.getInventory().getFreeSlots())
            f.p.getInventory().add(new core.Item(Data.itemId("Spade")), false);
    f.open();
    return {
        ...f,
        buy: () => purchase(f, 11),
        sacks: () => f.p.getInventory().getAmount(Data.itemId("Herb sack")),
    };
}
test("boosting from base57 to58 cannot purchase a herb sack", async (t) => {
    const f = prepare(t, { base: 57, current: 58 });
    await f.buy();
    assert.equal(f.sacks(), 0);
    assert.equal(f.score().points, 250);
});
test("base58 meets the purchase gate even when the visible level is drained", async (t) => {
    const f = prepare(t, { current: 57 });
    await f.buy();
    assert.equal(f.sacks(), 1);
    assert.equal(f.score().points, 0);
});
test("an unboosted level58 purchase costs exactly250 points", async (t) => {
    const f = prepare(t, { points: 300 });
    await f.buy();
    assert.equal(f.sacks(), 1);
    assert.equal(f.score().points, 50);
});
test("insufficient points and a full bag preserve points and inventory", async (t) => {
    for (const opts of [{ points: 249 }, { full: true }]) {
        const f = prepare(t, opts),
            before = f.score().points;
        await f.buy();
        assert.equal(f.sacks(), 0);
        assert.equal(f.score().points, before);
    }
});
test("a boost after opening cannot bypass the base-level gate", async (t) => {
    const f = prepare(t, { base: 57 });
    f.p.getSkillManager().setCurrentLevel(core.Skill.HERBLORE, 62, false);
    await f.buy();
    assert.equal(f.sacks(), 0);
    assert.equal(f.score().points, 250);
});
test("walking away before a native purchase preserves points", async (t) => {
    const f = prepare(t);
    f.p.setLocation(new core.Location(3200, 3200));
    await f.buy();
    assert.equal(f.sacks(), 0);
    assert.equal(f.score().points, 250);
});
