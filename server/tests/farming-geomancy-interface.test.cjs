// Native Geomancy widget input with all plugins and real game objects; only transport/message output is captured.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
const previousDisableBots = process.env.DISABLE_PLAYER_BOTS;
process.env.DISABLE_PLAYER_BOTS = "1";
const originalConsoleError = console.error, caughtErrors = [];
let hunterStartupAttempted = false;
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
const ROOT = path.resolve(__dirname, "..");
let core, spell, Data, Patches;
let actorIndex = 100;

before(async () => {
    console.error = (...args) => {
        caughtErrors.push(args.map(String).join(" "));
        originalConsoleError.apply(console, args);
    };
    await CachePipeline.initialize(ROOT);
    PluginManager.loadFromDirectory(path.join(ROOT, "plugins"));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
    core.RegionManager.loadMapFiles(3200, 3200);
    const hunterHooks = PluginManager.serverStartupHooks.filter(hook => hook.pluginName === "Hunter");
    assert.ok(hunterHooks.length, "real Hunter startup is registered");
    for (const hook of hunterHooks) {
        hunterStartupAttempted = true;
        hook.handler({});
    }
    Data = require("../plugins/skills/farming/Data.Farming");
    Patches = require("../plugins/skills/farming/Patches.Farming");
    Data.initializeFarmingData();
    spell = core.CacheDefinitions.getSpellByName("Geomancy");
    assert.ok(spell);
});

after(() => {
    try {
        if (hunterStartupAttempted) {
            for (const hook of PluginManager.serverShutdownHooks)
                if (hook.pluginName === "Hunter") hook.handler({});
        }
        assert.deepEqual(caughtErrors, [], "no caught engine or plugin errors");
    } finally {
        console.error = originalConsoleError;
        if (previousDisableBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
        else process.env.DISABLE_PLAYER_BOTS = previousDisableBots;
    }
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

function caster(t, { level = 99, casts = 1, book, full = false } = {}) {
    const transport = channel();
    const p = new Player(new PlayerSession(transport));
    t.after(() => {
        try {
            require("../plugins/skills/farming/Geomancy.Farming").logout({ player: p });
            core.GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(p);
            // Death uses a shared default key; stop only this actor's unkeyed death task.
            const deaths = [...core.TaskManager.pendingTasks.toArray(), ...core.TaskManager.activeTasks]
                .filter(task => task instanceof PlayerDeathTask && task.player === p);
            for (const task of deaths) task.stop();
            core.TaskManager.cancelTasks(p);
            if (p.getIndex() >= 0) core.TaskManager.cancelTasks(p.getIndex());
            p.getMovementQueue().reset();
            assert.ok(deaths.every(task => task.isStopped()), "actor death tasks are stopped");
        } finally {
            p.setRegistered(false);
        }
    });
    p.setUsername(`geoin${actorIndex}`);
    p.setIndex(actorIndex++);
    p.setRegistered(true);
    p.setLocation(new core.Location(3200, 3200, 0));
    p.setSpellbook(book === "normal" ? core.MagicSpellbook.NORMAL : core.MagicSpellbook.LUNAR);
    p.getSkillManager()
        .setMaxLevels(core.Skill.MAGIC, level, false)
        .setCurrentLevels(core.Skill.MAGIC, level, false)
        .setExperiences(core.Skill.MAGIC, SkillManager.getExperienceForLevel(level), false);
    const messages = [];
    t.mock.method(p.getPacketSender(), "sendMessage", (text) => {
        messages.push(text);
        return p.getPacketSender();
    });
    for (const [name, amount] of [
        ["Astral rune", 3],
        ["Nature rune", 3],
        ["Earth rune", 8],
    ]) {
        if (casts) p.getInventory().add(new core.Item(Data.itemId(name), amount * casts), false);
    }
    if (full)
        while (p.getInventory().getFreeSlots())
            p.getInventory().add(new core.Item(Data.itemId("Rake"), 1), false);
    const connection = new ClientConnection(transport);
    connection.player = p;
    const xp = () => p.getSkillManager().getExperience(core.Skill.MAGIC);
    const runes = () =>
        ["Astral rune", "Nature rune", "Earth rune"].map((n) =>
            p.getInventory().getAmount(Data.itemId(n)),
        );
    return { p, connection, messages, xp, runes, startXp: xp() };
}

async function click(f, { action = 1, widget = spell, copies = 1 } = {}) {
    await f.connection.dispatch(
        Array.from({ length: copies }, () => ({
            type: "widget_action",
            widgetId: widget.widgetId,
            groupId: widget.widgetId >>> 16,
            childId: widget.widgetId & 65535,
            itemId: widget.itemId,
            buttonNum: action,
        })),
    );
    f.connection.processTurnPackets();
}

const VIEW = "farming_view";
function renderOutput(t, f) {
    const scripts = [],
        models = [];
    const ps = f.p.getPacketSender();
    t.mock.method(ps, "sendClientScript", (id, ...args) => {
        scripts.push({ id, args });
        return ps;
    });
    t.mock.method(ps, "sendInterfaceModel", (uid, id, zoom) => {
        models.push({ uid, id, zoom });
        return ps;
    });
    return { scripts, models };
}
async function tab(f, slot, action = 1) {
    const uid = core.CacheDefinitions.getComponentId("farming_view:tabs");
    await f.connection.dispatch([
        {
            type: "widget_action",
            widgetId: uid,
            groupId: uid >>> 16,
            childId: uid & 65535,
            itemId: slot,
            slot,
            buttonNum: action,
        },
    ]);
    f.connection.processTurnPackets();
}
function seeded(f, type, crop, fields = {}) {
    const patch = Data.CACHE.patches.find((p) => p.type === type && p.x === 3050 && p.y === 3307);
    assert.ok(patch);
    Object.assign(
        Patches.stateFor(f.p, patch),
        {
            crop,
            stage: 2,
            weeds: 0,
            nextAt: Date.now() + 86400000,
            plantedAt: Date.now(),
            status: "growing",
        },
        fields,
    );
    return patch;
}
test("native Cast opens all cache rows on a new empty farm instead of a dialogue", async (t) => {
    const f = caster(t),
        out = renderOutput(t, f);
    await click(f);
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId(VIEW));
    assert.equal(out.scripts.filter((x) => x.id === 1119).length, 107);
    assert.equal(out.models.length, 107);
    assert.deepEqual(f.runes(), [0, 0, 0]);
    assert.equal(f.xp() - f.startXp, 60);
    assert.ok(!f.messages.includes("You have no crops growing."));
    const rows = out.scripts.filter((x) => x.id === 1119);
    assert.equal(new Set(rows.map((x) => x.args[0])).size, 107);
    for (const row of rows) assert.equal(row.args.length, 5);
});
test("native panel encodes crop progress, watered, ultracompost and gardener protection", async (t) => {
    const f = caster(t),
        out = renderOutput(t, f);
    seeded(f, "ALLOTMENT", "POTATO", { watered: true, compost: 3, protected: true });
    await click(f);
    const r = out.scripts.find((x) => x.id === 1119 && x.args[0] === 8);
    assert.ok(r);
    assert.equal(r.args[1], Data.itemId("Potato"));
    assert.equal((r.args[2] >>> 14) & 63, 2);
    assert.equal(r.args[2] & 63, 4);
    assert.equal(r.args[2] >>> 28, 1);
    assert.ok(r.args[3] & 4);
    assert.ok(r.args[3] & 128);
});
test("disease and death are shown without changing crop state", async (t) => {
    for (const [status, flag] of [
        ["diseased", 1],
        ["dead", 2],
    ]) {
        const f = caster(t),
            out = renderOutput(t, f),
            patch = seeded(f, "ALLOTMENT", "POTATO", { status });
        const before = structuredClone(Patches.stateFor(f.p, patch));
        await click(f);
        assert.ok(out.scripts.find((x) => x.id === 1119 && x.args[0] === 8).args[3] & flag);
        assert.deepEqual(Patches.stateFor(f.p, patch), before);
    }
});
test("native tabs validate action, modal and bounds; keep selected tab in saved farm state", async (t) => {
    const f = caster(t);
    await tab(f, 3);
    const bit = core.CacheDefinitions.getVarbitId("farming_view_tab");
    assert.equal(f.p.getPacketSender().getVarbit(bit), 0);
    await click(f);
    for (const slot of [-1, 6, 65535]) await tab(f, slot);
    await tab(f, 2, 2);
    assert.equal(f.p.getPacketSender().getVarbit(bit), 0);
    for (let slot = 0; slot < 6; slot++) {
        await tab(f, slot);
        assert.equal(f.p.getPacketSender().getVarbit(bit), slot);
    }
    assert.equal(Patches.farmFor(f.p).geomancyTab, 5);
    f.p.getPacketSender().sendInterfaceRemoval();
    await tab(f, 1);
    assert.equal(f.p.getPacketSender().getVarbit(bit), 5);
});
test("an open browser sends changed panels without charging another spell, then stops on close", async (t) => {
    const f = caster(t),
        out = renderOutput(t, f),
        patch = seeded(f, "ALLOTMENT", "POTATO");
    await click(f);
    out.scripts.length = 0;
    out.models.length = 0;
    Patches.tick();
    assert.equal(out.scripts.length, 0);
    Patches.stateFor(f.p, patch).status = "dead";
    Patches.tick();
    assert.equal(out.scripts.filter((x) => x.id === 1119).length, 1);
    assert.deepEqual(f.runes(), [0, 0, 0]);
    assert.equal(f.xp() - f.startXp, 60);
    f.p.getPacketSender().sendInterfaceRemoval();
    out.scripts.length = 0;
    Patches.stateFor(f.p, patch).status = "diseased";
    Patches.tick();
    assert.equal(out.scripts.length, 0);
});
test("browser refresh releases dead/logout players", async (t) => {
    const f = caster(t),
        out = renderOutput(t, f);
    seeded(f, "ALLOTMENT", "POTATO");
    await click(f);
    out.scripts.length = 0;
    f.p.setHitpoints(0);
    Patches.tick();
    assert.equal(out.scripts.length, 0);
    const g = caster(t),
        other = renderOutput(t, g);
    seeded(g, "ALLOTMENT", "POTATO");
    await click(g);
    other.scripts.length = 0;
    PluginManager.emitPlayerLogout({ player: g.p, username: g.p.getUsername() });
    for (const s of Object.values(Patches.farmFor(g.p).patches)) s.status = "dead";
    Patches.tick();
    assert.equal(other.scripts.length, 0);
});
test("compost bins show filling, rotting and ready quantities", async (t) => {
    for (const bin of [
        { count: 5, tier: 1, open: false },
        { count: 15, tier: 2, closedAt: Date.now(), open: false },
        { count: 15, tier: 2, closedAt: Date.now() - 7200000, open: true },
    ]) {
        const f = caster(t),
            out = renderOutput(t, f);
        const p = Data.CACHE.patches.find((p) => p.x === 3056 && p.y === 3312);
        Patches.stateFor(f.p, p).bin = bin;
        await click(f);
        const row = out.scripts.find((x) => x.id === 1119 && x.args[0] === 39);
        assert.ok(row);
        assert.notEqual(row.args[1], Data.itemId("Weeds"));
        assert.equal((row.args[2] >>> 14) >>> 6, bin.count);
    }
});
test("reopening restores selected tab and uses current saved crop state", async (t) => {
    const f = caster(t);
    seeded(f, "ALLOTMENT", "POTATO");
    await click(f);
    await tab(f, 4);
    const g = caster(t),
        out = renderOutput(t, g);
    g.p.setAttribute(Patches.FARM_ATTRIBUTE, structuredClone(Patches.farmFor(f.p)));
    await click(g);
    assert.equal(
        g.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId("farming_view_tab")),
        4,
    );
    assert.equal(
        out.scripts.find((x) => x.id === 1119 && x.args[0] === 8).args[1],
        Data.itemId("Potato"),
    );
});

test("every supported crop has a named renderer object, including clean herbs and special trees", async (t) => {
    const names = core.CacheDefinitions.getEnumValues(1238);
    for (const crop of Data.CROPS.values()) {
        const f = caster(t),
            out = renderOutput(t, f),
            patch = Data.CACHE.patches.find((p) => p.type === crop.type);
        assert.ok(patch, crop.key);
        Object.assign(Patches.stateFor(f.p, patch), {
            crop: crop.key,
            stage: 1,
            weeds: 0,
            lives: 3,
            nextAt: Date.now() + 86400000,
            plantedAt: Date.now(),
        });
        await click(f);
        const r = out.scripts.find(
            (x) =>
                x.id === 1119 &&
                x.args[1] !== Data.itemId("Weeds") &&
                x.args[1] !== core.CacheDefinitions.getItem(Data.itemId("Bucket")).note &&
                x.args[1] !== Data.itemId("Bucket"),
        );
        assert.ok(r, crop.key);
        assert.ok(names.has(r.args[1]), crop.key + " must have a cache display label");
    }
});

test("native passive protection uses captured Troll/Weiss and Harmony bits, not inferred gardeners", async (t) => {
    const f = caster(t),
        out = renderOutput(t, f),
        farm = Patches.farmFor(f.p);
    farm.faladorProtected = true;
    farm.fortisProtected = true;
    await click(f);
    const row = (index) => out.scripts.find((x) => x.id === 1119 && x.args[0] === index).args;
    assert.equal(row(47)[3] & 4, 4);
    assert.equal(row(152)[3] & 4, 4);
    assert.equal(row(143)[3] & 512, 512);
    assert.equal(row(143)[3] & 4, 0);
    assert.equal(row(1)[3] & 4, 0);
    assert.equal(row(174)[3] & 4, 0);
    assert.equal(row(8)[3] & 4, 0);
});
