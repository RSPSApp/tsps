const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
const { ATTR_SKIP_PERSISTENCE } = require("../plugins/bots/runtime/PersistenceConstants.PlayerBots");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
let core, Data, Patches, vaultObject, Pin;
let nextIndex = 100;
const previousDisableBots = process.env.DISABLE_PLAYER_BOTS;
const originalConsoleError = console.error;
const caughtErrors = [];
let hunterStartupAttempted = false;

before(async () => {
    console.error = (...args) => {
        caughtErrors.push(args.map(String).join(" "));
        originalConsoleError.apply(console, args);
    };
    process.env.DISABLE_PLAYER_BOTS = "1";
    const root = path.resolve(__dirname, "..");
    await CachePipeline.initialize(root);
    PluginManager.loadFromDirectory(path.join(root, "plugins"));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
    core.RegionManager.loadMapFiles(1243, 3740);
    // Registration alone leaves these real event consumers without startup context.
    for (const hook of PluginManager.serverStartupHooks) {
        if (!["Hunter", "WarpedSceptre"].includes(hook.pluginName)) continue;
        if (hook.pluginName === "Hunter") hunterStartupAttempted = true;
        hook.handler({});
    }
    Data = require("../plugins/skills/farming/Data.Farming");
    Patches = require("../plugins/skills/farming/Patches.Farming");
    Pin = require("../plugins/interface/bankpin/Common.BankPin");
    Data.initializeFarmingData();
    vaultObject = core.MapObjects.get(
        core.CacheDefinitions.getLocId("kebos_farming_guild_seed_vault"),
        new core.Location(1243, 3740, 0),
    );
    assert.ok(vaultObject, "real cache/map Seed Vault loc");
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

function actor(t) {
    const channel = {
        kind: "test",
        remoteAddress: "127.0.0.1",
        isOpen: () => true,
        send: () => true,
        close() {},
        onData() {},
        onError() {},
        onClose() {},
    };
    const p = new Player(new PlayerSession(channel));
    t.after(() => {
        try {
            core.GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(p);
            // Death tasks use a shared default key; stop only this actor's unkeyed death task.
            for (const task of [...core.TaskManager.pendingTasks.toArray(), ...core.TaskManager.activeTasks])
                if (task instanceof PlayerDeathTask && task.player === p) task.stop();
            core.TaskManager.cancelTasks(p);
            if (p.getIndex() >= 0) core.TaskManager.cancelTasks(p.getIndex());
            p.getMovementQueue().reset();
        } finally {
            p.setRegistered(false);
        }
    });
    p.setAttribute(ATTR_SKIP_PERSISTENCE, true);
    p.setIndex(nextIndex++);
    p.setUsername("vaultqa" + p.getIndex());
    p.setRegistered(true);
    p.setLocation(new core.Location(1244, 3740, 0));
    p.needsPlacement = false;
    p.getSkillManager().setMaxLevels(core.Skill.FARMING, 45, false).setCurrentLevel(core.Skill.FARMING, 45, false);
    const connection = new ClientConnection(channel);
    connection.player = p;
    const messages = [];
    t.mock.method(p.getPacketSender(), "sendMessage", (text) => {
        messages.push(text);
        return p.getPacketSender();
    });
    const farm = Patches.farmFor(p);
    const open = () =>
        PluginManager.emitObjectInteraction({
            player: p,
            object: vaultObject,
            definition: core.ObjectDefinition.forPlayer(vaultObject.getId(), p),
            option: "Open",
            optionSlot: 1,
            handled: false,
        });
    return { p, connection, messages, farm, open };
}


function setIronmanMode(f, mode) {
    const previous = f.p.getRights();
    f.p.setRights(core.PlayerRights.ADMINISTRATOR);
    try {
        PluginManager.emitCommand({
            player: f.p, base: "ironman", raw: `ironman ${mode}`,
            parts: ["ironman", mode], handled: false,
        });
    } finally {
        f.p.setRights(previous);
    }
    assert.equal(f.p.getAttribute("ironman:mode"), mode, "registered mode command");
}

async function click(f, name, action = 1, slot, itemId) {
    const widgetId = core.CacheDefinitions.getComponentId(name);
    await f.connection.dispatch([
        {
            type: "widget_action",
            widgetId,
            groupId: widgetId >>> 16,
            childId: widgetId & 65535,
            buttonNum: action,
            slot,
            itemId,
        },
    ]);
    f.connection.processTurnPackets();
}

const amount = async (f, value) => {
    await f.connection.dispatch([{ type: "dialogue_amount", amount: value }]);
    f.connection.processTurnPackets();
};
const seed = () => Data.itemId("Potato seed");
const deposit = (f) => click(f, "seed_vault:deposit_all");
const withdraw = (f, op = 7, slot = 0, id = seed()) =>
    click(f, "seed_vault:obj_list", op, slot, id);

// The pre-native Guild.guildObject deposit producer: use its accepted crop set and
// actual Inventory operations, so this represents a balance that really could exist.
function legacyDeposit(f) {
    const vault = f.farm.vault ??= {};
    for (const item of [...f.p.getInventory().getValidItems()]) {
        const def = core.CacheDefinitions.getItem(item.getId());
        const id = def.noteTemplate >= 0 ? def.note : item.getId();
        if (![...Data.CROPS.values()].some(c => c.seed === id || c.sapling === id)) continue;
        const amount = Math.min(item.getAmount(), 2147483647 - (vault[id] ?? 0));
        if (amount > 0) {
            f.p.getInventory().deleteNumber(item.getId(), amount);
            vault[id] = (vault[id] ?? 0) + amount;
        }
    }
}

test("old producer Gout tubers recover once and cannot be deposited again", async (t) => {
    const f = actor(t), id = Data.itemId("Gout tuber"), inv = f.p.getInventory();
    const emit = PluginManager.emitCustomEvent.bind(PluginManager), saves = [];
    t.mock.method(PluginManager, "emitCustomEvent", (name, event) => {
        if (name === "persistence:save" && event.player === f.p) saves.push(event.reason);
        return emit(name, event);
    });
    assert.equal(core.CacheDefinitions.getItem(id).params?.get(709), undefined);
    inv.add(new core.Item(id, 3), false);
    legacyDeposit(f);
    assert.equal(f.farm.vault[id], 3);
    assert.equal(inv.getAmount(id), 0);
    f.open();
    assert.equal(inv.getAmount(id), 3);
    assert.equal(f.farm.vault[id], 0);
    assert.ok(saves.includes("seed-vault-legacy-recovery"));
    f.open();
    await deposit(f);
    assert.equal(inv.getAmount(id), 3);
    assert.equal(f.farm.vault[id], 0);
    assert.ok(f.messages.some(m => m.includes("returned") && m.includes("Gout tuber")));
});

test("legacy recovery retains full-bag balance and partial remainder across reload", (t) => {
    const f = actor(t), id = Data.itemId("Gout tuber"), inv = f.p.getInventory();
    inv.add(new core.Item(id, 3), false);
    legacyDeposit(f);
    while (inv.getFreeSlots()) inv.add(new core.Item(Data.itemId("Rake")), false);
    f.open();
    assert.equal(f.farm.vault[id], 3);
    assert.equal(inv.getAmount(id), 0);
    assert.ok(f.messages.some(m => m.includes("Make room") && m.includes("reopen")));
    inv.deleteAtSlot(27);
    f.open();
    assert.equal(inv.getAmount(id), 1);
    assert.equal(f.farm.vault[id], 2);
    f.p.getPacketSender().sendInterfaceRemoval();
    PluginManager.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
    const relog = actor(t), restored = relog.p.getInventory();
    relog.p.setAttribute(Patches.FARM_ATTRIBUTE, JSON.parse(JSON.stringify(f.farm)));
    restored.getItems().splice(0, 28, ...inv.getItems().map(item => item.clone()));
    restored.deleteAtSlot(26);
    relog.open();
    assert.equal(restored.getAmount(id), 2);
    assert.equal(Patches.farmFor(relog.p).vault[id], 1);
});

test("recovery does not turn malformed or unrelated saved balances into items", (t) => {
    const id = Data.itemId("Gout tuber");
    for (const balance of [-1, 1.5, "3", 2147483648]) {
        const f = actor(t);
        f.farm.vault = { [id]: balance, [Data.itemId("Rake")]: 3, [-10]: 2 };
        f.open();
        assert.equal(f.p.getInventory().getValidItems().length, 0);
        assert.equal(f.farm.vault[id], balance);
    }
});

test("legacy recovery obeys PIN, range, life and trade gates", (t) => {
    for (const mode of ["pin", "remote", "dead", "trade"]) {
        const f = actor(t), id = Data.itemId("Gout tuber");
        f.p.getInventory().add(new core.Item(id, 2), false);
        legacyDeposit(f);
        if (mode === "pin") Pin.set(f.p, "hash", Pin.hash(f.p, "2468"));
        if (mode === "remote") f.p.setLocation(new core.Location(3200, 3200));
        if (mode === "dead") f.p.setHitpoints(0);
        if (mode === "trade") f.p.setStatus(core.PlayerStatus.TRADING);
        f.open();
        assert.equal(f.p.getInventory().getAmount(id), 0, mode);
        assert.equal(f.farm.vault[id], 2, mode);
    }
});

test("Ultimate Ironman cannot open the Seed Vault or create state", (t) => {
    const f = actor(t);
    setIronmanMode(f, "ultimate");
    f.p.setAttribute(Patches.FARM_ATTRIBUTE, undefined);
    f.p.getInventory().add(new core.Item(seed(), 6), false);
    assert.equal(PluginManager.emitCanBank(f.p, "deposit-box"), false, "registered UIM bank rule");
    assert.equal(f.p.isNeedsPlacement(), false);
    assert.ok(f.p.getHitpoints() > 0);
    f.open();
    assert.notEqual(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"), "UIM vault refusal");
    assert.equal(f.p.getAttribute(Patches.FARM_ATTRIBUTE), undefined, "no farm state created");
    assert.equal(f.p.getInventory().getAmount(seed()), 6, "inventory unchanged");
});

test("Ultimate Ironman is refused before the Vault PIN keypad", (t) => {
    const locked = actor(t);
    setIronmanMode(locked, "ultimate");
    locked.p.setAttribute(Patches.FARM_ATTRIBUTE, undefined);
    Pin.set(locked.p, "hash", Pin.hash(locked.p, "2468"));
    locked.open();
    assert.notEqual(locked.p.getInterfaceId(), Pin.ids.groups.keypad, "UIM refusal precedes PIN");
    assert.notEqual(locked.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"));
    assert.equal(locked.p.getAttribute(Patches.FARM_ATTRIBUTE), undefined);
});

test("standard Ironman still unlocks and uses the Seed Vault with a PIN", async (t) => {
    const f = actor(t);
    setIronmanMode(f, "ironman");
    f.p.setAttribute(Patches.FARM_ATTRIBUTE, undefined);
    Pin.set(f.p, "hash", Pin.hash(f.p, "2468"));
    f.p.getInventory().add(new core.Item(seed(), 6), false);
    f.open();
    assert.equal(f.p.getInterfaceId(), Pin.ids.groups.keypad, "vault PIN prompt");
    assert.equal(f.p.getAttribute(Patches.FARM_ATTRIBUTE), undefined);
    await amount(f, 2468);
    core.TaskManager.process();
    core.TaskManager.process();
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"));
    await deposit(f);
    assert.equal(Patches.farmFor(f.p).vault[seed()], 6);
    assert.equal(f.p.getInventory().getAmount(seed()), 0);
});

test("Ultimate Ironman cannot recover an existing legacy Vault balance", (t) => {
    const f = actor(t), id = Data.itemId("Gout tuber");
    f.p.getInventory().add(new core.Item(id, 3), false);
    legacyDeposit(f);
    assert.equal(f.farm.vault[id], 3, "old producer stored the balance");
    assert.equal(f.p.getInventory().getAmount(id), 0);
    setIronmanMode(f, "ultimate");
    f.open();
    assert.equal(f.p.getInventory().getAmount(id), 0, "no legacy recovery for UIM");
    assert.equal(f.farm.vault[id], 3, "saved balance unchanged");
    assert.notEqual(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"));
});

test("a PIN resume rechecks a switch to Ultimate before opening the Vault", async (t) => {
    const f = actor(t);
    setIronmanMode(f, "ironman");
    f.p.setAttribute(Patches.FARM_ATTRIBUTE, undefined);
    Pin.set(f.p, "hash", Pin.hash(f.p, "2468"));
    f.open();
    assert.equal(f.p.getInterfaceId(), Pin.ids.groups.keypad);
    setIronmanMode(f, "ultimate");
    assert.equal(f.p.getInterfaceId(), Pin.ids.groups.keypad, "mode command leaves keypad open");
    await amount(f, 2468);
    core.TaskManager.process();
    core.TaskManager.process();
    assert.notEqual(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"), "resume refuses UIM");
    assert.equal(f.p.getAttribute(Patches.FARM_ATTRIBUTE), undefined);
});

test("remote Vault event preserves the PIN guard for an allowed player", async (t) => {
    const f = actor(t);
    f.p.setLocation(new core.Location(3200, 3200, 0));
    f.p.needsPlacement = false;
    f.p.setAttribute(Patches.FARM_ATTRIBUTE, undefined);
    Pin.set(f.p, "hash", Pin.hash(f.p, "2468"));
    f.p.getInventory().add(new core.Item(seed(), 6), false);
    const request = { player: f.p, opened: false };
    PluginManager.emitCustomEvent("farming:open-seed-vault", request);
    assert.equal(request.opened, true, "registered remote consumer");
    assert.equal(f.p.getInterfaceId(), Pin.ids.groups.keypad);
    assert.equal(f.p.getAttribute(Patches.FARM_ATTRIBUTE), undefined);
    await amount(f, 2468);
    core.TaskManager.process();
    core.TaskManager.process();
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"));
    await deposit(f);
    assert.equal(Patches.farmFor(f.p).vault[seed()], 6);
});

test("changing an open Vault user to Ultimate blocks later transfers", async (t) => {
    const f = actor(t);
    f.p.getInventory().add(new core.Item(seed(), 6), false);
    f.open();
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"));
    const before = structuredClone(f.farm.vault);
    setIronmanMode(f, "ultimate");
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"), "mode command leaves modal open");
    await deposit(f);
    assert.equal(f.p.getInventory().getAmount(seed()), 6, "no UIM transfer");
    assert.deepEqual(f.farm.vault, before, "saved balances unchanged");
});

test("opens native main and side modal with existing saved seeds", (t) => {
    const f = actor(t);
    f.farm.vault = { [seed()]: 20 };
    f.open();
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"));
    assert.equal(
        f.p
            .getPacketSender()
            .isSubInterfaceOpen(core.CacheDefinitions.getInterfaceId("seed_vault_deposit")),
        true,
    );
    assert.equal(f.farm.vault[seed()], 20);
});

test("deposit-all uses exact slots, normalizes notes and preserves metadata-bearing variants", async (t) => {
    const f = actor(t),
        inv = f.p.getInventory(),
        sapling = Data.itemId("Oak sapling");
    inv.add(new core.Item(seed(), 12), false);
    inv.add(new core.Item(core.CacheDefinitions.getItem(sapling).note, 3), false);
    const marked = new core.Item(seed(), 7);
    marked.setMetaValue("test:marker", "keep");
    inv.add(marked, false);
    inv.add(new core.Item(Data.itemId("Rake")), false);
    f.open();
    await deposit(f);
    await deposit(f);
    assert.equal(f.farm.vault[seed()], 12);
    assert.equal(f.farm.vault[sapling], 3);
    assert.equal(inv.getAmount(seed()), 7);
    assert.equal(
        inv
            .getValidItems()
            .find((i) => i.getId() === seed())
            .getMetaValue("test:marker"),
        "keep",
    );
    assert.equal(inv.getAmount(Data.itemId("Rake")), 1);
});

test("native deposit and withdrawal amounts 1/5/10/all use canonical balances", async (t) => {
    const f = actor(t),
        inv = f.p.getInventory();
    inv.add(new core.Item(seed(), 30), false);
    f.open();
    await click(f, "seed_vault_deposit:inv", 3, 0, seed());
    assert.equal(f.farm.vault[seed()], 5);
    assert.equal(inv.getAmount(seed()), 25);
    await withdraw(f, 2);
    assert.equal(f.farm.vault[seed()], 4);
    await click(f, "seed_vault_deposit:inv", 4, 0, seed());
    assert.equal(f.farm.vault[seed()], 14);
    await withdraw(f, 3);
    assert.equal(f.farm.vault[seed()], 9);
    await withdraw(f);
    assert.equal(f.farm.vault[seed()], 0);
    assert.equal(inv.getAmount(seed()), 30);
});

test("full inventory and stack cap allow only the addable withdrawal", async (t) => {
    const f = actor(t),
        inv = f.p.getInventory();
    f.farm.vault = { [seed()]: 20 };
    inv.add(new core.Item(seed(), 2147483642), false);
    while (inv.getFreeSlots()) inv.add(new core.Item(Data.itemId("Rake")), false);
    f.open();
    await withdraw(f);
    assert.equal(inv.getAmount(seed()), 2147483647);
    assert.equal(f.farm.vault[seed()], 15);
    await withdraw(f);
    assert.equal(f.farm.vault[seed()], 15);
});

test("deposit stack cap keeps the excess in its original inventory slot", async (t) => {
    const f = actor(t),
        inv = f.p.getInventory();
    f.farm.vault = { [seed()]: 2147483645 };
    inv.add(new core.Item(seed(), 10), false);
    f.open();
    await deposit(f);
    assert.equal(f.farm.vault[seed()], 2147483647);
    assert.equal(inv.forSlot(0).getAmount(), 8);
});

test("saplings withdraw partially into the last free slot or as notes", async (t) => {
    const f = actor(t),
        inv = f.p.getInventory(),
        id = Data.itemId("Oak sapling");
    f.farm.vault = { [id]: 3 };
    while (inv.getFreeSlots() > 1) inv.add(new core.Item(Data.itemId("Rake")), false);
    f.open();
    await withdraw(f, 7, 0, id);
    assert.equal(inv.getAmount(id), 1);
    assert.equal(f.farm.vault[id], 2);
    inv.deleteAtSlot(0);
    await click(f, "seed_vault:xall");
    await withdraw(f, 9, 0, id);
    assert.equal(inv.getAmount(core.CacheDefinitions.getItem(id).note), 2);
    assert.equal(f.farm.vault[id], 0);
});

test("withdraw-X rejects zero and stale callbacks after closing, moving, replacing state or logging out", async (t) => {
    for (const mode of ["zero", "close", "move", "state", "logout"]) {
        const f = actor(t);
        f.farm.vault = { [seed()]: 10 };
        f.open();
        await withdraw(f, 6);
        if (mode === "close") f.p.getPacketSender().sendInterfaceRemoval();
        if (mode === "move") f.p.setLocation(new core.Location(3200, 3200));
        if (mode === "state") f.p.setAttribute(Patches.FARM_ATTRIBUTE, structuredClone(f.farm));
        if (mode === "logout")
            PluginManager.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
        await amount(f, mode === "zero" ? 0 : 5);
        assert.equal(f.p.getInventory().getAmount(seed()), 0, mode);
        assert.equal(Patches.farmFor(f.p).vault[seed()], 10, mode);
    }
});

test("real PIN guard blocks opening and subsequent transfers until unlocked", async (t) => {
    const f = actor(t);
    f.farm.vault = { [seed()]: 10 };
    Pin.set(f.p, "hash", Pin.hash(f.p, "0042"));
    f.open();
    assert.notEqual(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"));
    await withdraw(f);
    assert.equal(f.p.getInventory().getAmount(seed()), 0);
    f.p.getPacketSender().sendInterfaceRemoval();
    Pin.unlock(f.p);
    f.open();
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"));
    Pin.lock(f.p);
    await withdraw(f);
    assert.equal(f.farm.vault[seed()], 10);
});

test("forged, remote, dead and mid-trade widget actions do not transfer items", async (t) => {
    for (const mode of ["id", "slot", "remote", "dead", "trade"]) {
        const f = actor(t);
        f.farm.vault = { [seed()]: 10 };
        f.open();
        if (mode === "remote") f.p.setLocation(new core.Location(3200, 3200));
        if (mode === "dead") f.p.setHitpoints(0);
        if (mode === "trade") f.p.setStatus(core.PlayerStatus.TRADING);
        await withdraw(
            f,
            7,
            mode === "slot" ? -1 : 0,
            mode === "id" ? Data.itemId("Rake") : seed(),
        );
        assert.equal(f.p.getInventory().getAmount(seed()), 0, mode);
        assert.equal(f.farm.vault[seed()], 10, mode);
    }
});

test("favourites, quantities and balances survive a saved-state reload", async (t) => {
    const f = actor(t);
    f.farm.vault = { [seed()]: 10 };
    f.open();
    await withdraw(f, 8);
    await click(f, "seed_vault:x5");
    const g = actor(t);
    g.p.setAttribute(Patches.FARM_ATTRIBUTE, structuredClone(f.farm));
    g.open();
    assert.equal(
        g.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId("seed_vault_fave1")),
        0,
    );
    assert.equal(
        g.p.getPacketSender().getVarp(core.CacheDefinitions.getVarpId("seed_vault_selected_qty")),
        5,
    );
    await click(g, "seed_vault:obj_list", 1, 0, seed());
    assert.equal(g.p.getInventory().getAmount(seed()), 5);
    assert.equal(Patches.farmFor(g.p).vault[seed()], 5);
});

test("withdraw-all keeps a placeholder and native remove-placeholder removes only that slot", async (t) => {
    const f = actor(t);
    f.farm.vault = { [seed()]: 5 };
    f.open();
    await withdraw(f);
    assert.equal(f.farm.vaultOrder[0], seed());
    await withdraw(f, 8, 0, core.CacheDefinitions.getItem(seed()).placeholder);
    assert.equal(f.farm.vaultOrder.includes(seed()), false);
});

test("native lock popup preserves the Vault and protects bulk deposits while allowing explicit deposits", async (t) => {
    const f = actor(t),
        inv = f.p.getInventory(),
        other = Data.itemId("Guam seed");
    inv.add(new core.Item(seed(), 12), false);
    inv.add(new core.Item(other, 5), false);
    f.open();
    await click(f, "seed_vault:lock_menu");
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"));
    assert.equal(
        f.p
            .getPacketSender()
            .isSubInterfaceOpen(core.CacheDefinitions.getInterfaceId("bank_side_locks")),
        true,
    );
    await click(f, "bank_side_locks:slots", 1, 0);
    assert.equal(
        f.p
            .getPacketSender()
            .getVarbit(core.CacheDefinitions.getVarbitId("bank_side_slot_overview")),
        1,
    );
    await click(f, "bank_side_locks:done");
    await deposit(f);
    assert.equal(inv.getAmount(seed()), 12);
    assert.equal(f.farm.vault[other], 5);
    await click(f, "seed_vault_deposit:inv", 2, 0, seed());
    assert.equal(inv.getAmount(seed()), 11);
    assert.equal(f.farm.vault[seed()], 1);
});

test("lock checkboxes, side Lock-slot and saved lock settings work with stale-popup guards", async (t) => {
    const f = actor(t);
    f.p.getInventory().add(new core.Item(seed(), 12), false);
    f.open();
    await click(f, "seed_vault:lock_menu");
    await click(f, "bank_side_locks:extraoptions");
    await click(f, "bank_side_locks:done");
    await click(f, "seed_vault_deposit:inv", 9, 0, seed());
    assert.equal(f.farm.vaultSettings.locks, 1);
    await click(f, "bank_side_locks:slots", 1, 0);
    assert.equal(f.farm.vaultSettings.locks, 1, "closed editor cannot mutate locks");
    await click(f, "seed_vault:lock_menu");
    await click(f, "bank_side_locks:ignorelocks");
    await click(f, "bank_side_locks:done");
    await deposit(f);
    assert.equal(f.farm.vault[seed()], 12);
    const g = actor(t);
    g.p.setAttribute(Patches.FARM_ATTRIBUTE, structuredClone(f.farm));
    g.open();
    assert.equal(
        g.p
            .getPacketSender()
            .getVarbit(core.CacheDefinitions.getVarbitId("bank_side_slot_overview")),
        1,
    );
    assert.equal(
        g.p
            .getPacketSender()
            .getVarbit(core.CacheDefinitions.getVarbitId("bank_side_slot_ignoreinvlocks")),
        1,
    );
});

test("custom quantity and a real amount reply update native quantity selectors", async (t) => {
    const f = actor(t);
    f.farm.vault = { [seed()]: 20 };
    f.open();
    await click(f, "seed_vault:xx", 2);
    await amount(f, 7);
    assert.equal(
        f.p.getPacketSender().getVarp(core.CacheDefinitions.getVarpId("seed_vault_requested_qty")),
        7,
    );
    await withdraw(f, 1);
    assert.equal(f.p.getInventory().getAmount(seed()), 7);
    assert.equal(f.farm.vault[seed()], 13);
});

test("drag swaps only current Vault slots and keeps favourites attached to seeds", async (t) => {
    const f = actor(t),
        other = Data.itemId("Guam seed");
    f.farm.vault = { [seed()]: 10, [other]: 20 };
    f.open();
    const from = f.farm.vaultOrder.indexOf(seed()),
        to = f.farm.vaultOrder.indexOf(other);
    await withdraw(f, 8, from, seed());
    const sourceWidgetId = core.CacheDefinitions.getComponentId("seed_vault:obj_list"),
        targetWidgetId = core.CacheDefinitions.getComponentId("seed_vault:text_list");
    await f.connection.dispatch([
        {
            type: "widget_drag",
            sourceWidgetId,
            targetWidgetId,
            sourceSlot: from,
            targetSlot: to,
            sourceItemId: seed(),
            targetItemId: other,
        },
    ]);
    f.connection.processTurnPackets();
    assert.equal(f.farm.vaultOrder[to], seed());
    assert.equal(f.farm.vaultOrder[from], other);
    assert.equal(
        f.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId("seed_vault_fave1")),
        to,
    );
    await f.connection.dispatch([
        {
            type: "widget_drag",
            sourceWidgetId,
            targetWidgetId,
            sourceSlot: from,
            targetSlot: to,
            sourceItemId: seed(),
            targetItemId: other,
        },
    ]);
    f.connection.processTurnPackets();
    assert.equal(f.farm.vaultOrder[to], seed(), "stale item IDs cannot reorder another item");
});

test("real Guild assignment and completion feed the native contract category", async (t) => {
    const f = actor(t),
        Guild = require("../plugins/skills/farming/Guild.Farming");
    f.p.getSkillManager().setCurrentLevel(core.Skill.FARMING, 99, false);
    const janeId = Array.from(
        { length: core.CacheDefinitions.getCounts().npcs },
        (_, id) => id,
    ).find((id) => core.CacheDefinitions.getNpc(id).name === "Guildmaster Jane");
    const npc = core.NPC.create(janeId, f.p.getLocation().clone());
    let options;
    t.mock.method(Patches, "choose", (_p, entries) => {
        options = entries;
    });
    Guild.guildNpc({ player: f.p, npc, definition: npc.getDefinition(), handled: false });
    options[0][1]();
    assert.ok(f.farm.contract);
    f.open();
    const crop = Data.CROPS.get(f.farm.contract.crop),
        sender = f.p.getPacketSender();
    assert.equal(
        sender.getVarbit(core.CacheDefinitions.getVarbitId("farmguild_contract_type")),
        core.CacheDefinitions.getItem(crop.seed).params.get(895),
    );
    assert.equal(
        sender.getVarbit(core.CacheDefinitions.getVarbitId("farmguild_contract_complete")),
        0,
    );
    await click(f, "seed_vault:category_list", 1, 0);
    assert.equal(sender.getVarbit(core.CacheDefinitions.getVarbitId("seed_vault_category")), 12);
    Guild.completeContract({ player: f.p, crop: crop.key, patch: { x: 1243, y: 3740, z: 0 } });
    assert.equal(f.farm.contract.complete, true);
    f.open();
    assert.equal(
        sender.getVarbit(core.CacheDefinitions.getVarbitId("farmguild_contract_complete")),
        1,
    );
    delete f.farm.contract;
    f.open();
    assert.equal(sender.getVarbit(core.CacheDefinitions.getVarbitId("farmguild_contract_type")), 0);
});

test("native PIN keypad opens storage only after correct entry and never replays a transfer", async (t) => {
    const f = actor(t);
    f.p.setAttribute(Patches.FARM_ATTRIBUTE, undefined);
    Pin.set(f.p, "hash", Pin.hash(f.p, "2468"));
    f.p.getInventory().add(new core.Item(seed(), 6), false);
    f.open();
    assert.equal(f.p.getInterfaceId(), Pin.ids.groups.keypad);
    assert.equal(f.p.getAttribute(Patches.FARM_ATTRIBUTE), undefined);
    await amount(f, 1357);
    core.TaskManager.process();
    core.TaskManager.process();
    assert.equal(f.p.getAttribute(Patches.FARM_ATTRIBUTE), undefined);
    assert.equal(f.p.getInventory().getAmount(seed()), 6);
    f.open();
    await amount(f, 2468);
    core.TaskManager.process();
    core.TaskManager.process();
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"));
    assert.equal(f.p.getInventory().getAmount(seed()), 6);
    await deposit(f);
    assert.equal(Patches.farmFor(f.p).vault[seed()], 6);
    await withdraw(f, 2);
    assert.equal(Patches.farmFor(f.p).vault[seed()], 5);
    assert.equal(f.p.getInventory().getAmount(seed()), 1);
});
test("a native PIN resume after leaving does not create Farming storage", async (t) => {
    const f = actor(t);
    f.p.setAttribute(Patches.FARM_ATTRIBUTE, undefined);
    Pin.set(f.p, "hash", Pin.hash(f.p, "2468"));
    f.open();
    f.p.setLocation(new core.Location(3200, 3200));
    await amount(f, 2468);
    core.TaskManager.process();
    core.TaskManager.process();
    assert.equal(f.p.getAttribute(Patches.FARM_ATTRIBUTE), undefined);
    assert.notEqual(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("seed_vault"));
});
