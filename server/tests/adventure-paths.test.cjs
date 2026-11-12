const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
let core,
    next = 100;
before(async () => {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
    core.RegionManager.loadMapFiles(3234, 3222);
});
function actor(t, { experience = "new", iron = false } = {}) {
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
    p.setIndex(next++);
    p.setUsername("pathqa" + p.getIndex());
    p.setRegistered(true);
    p.setLocation(new core.Location(3234, 3222, 0));
    p.needsPlacement = false;
    p.setAttribute("tutorial-island:progress", 1000);
    p.setAttribute("tutorial-island:experience", experience);
    if (iron) p.setAttribute("ironman:mode", "ironman");
    const connection = new ClientConnection(channel);
    connection.player = p;
    const messages = [];
    t.mock.method(p.getPacketSender(), "sendMessage", (s) => {
        messages.push(s);
        return p.getPacketSender();
    });
    return { p, connection, messages };
}
function state(p) {
    const q = { player: p };
    PluginManager.emitCustomEvent("adventure-paths:state", q);
    return q;
}
function login(p) {
    PluginManager.emitPlayerLogin({ player: p, username: p.getUsername(), isNewAccount: false });
}
test("eligible new and returning players receive the current native Combat and Gatherer paths", (t) => {
    for (const experience of ["new", "returning"]) {
        const f = actor(t, { experience });
        login(f.p);
        assert.equal(state(f.p).eligible, true);
        assert.equal(
            f.p
                .getPacketSender()
                .getVarbit(core.CacheDefinitions.getVarbitId("adventurepath_player_participating")),
            1,
        );
        assert.equal(state(f.p).tasks.length, 18);
        const jon = core.NPC.create(
            core.CacheDefinitions.getNpcId("ap_guide_parent"),
            f.p.getLocation().clone(),
        );
        assert.equal(
            jon.getCurrentDefinition(f.p).getId(),
            core.CacheDefinitions.getNpcId("ap_guide_active"),
        );
    }
});
test("experienced players and ironman accounts cannot enroll or receive rewards", (t) => {
    for (const opts of [{ experience: "experienced" }, { iron: true }]) {
        const f = actor(t, opts);
        login(f.p);
        assert.equal(state(f.p).eligible, false);
        assert.equal(
            f.p
                .getPacketSender()
                .getVarbit(core.CacheDefinitions.getVarbitId("adventurepath_player_participating")),
            0,
        );
    }
});

test("real level gains complete all crossed milestone levels without counting temporary boosts", (t) => {
    const f = actor(t);
    login(f.p);
    f.p.getSkillManager().setCurrentLevel(core.Skill.ATTACK, 20, false);
    assert.equal(state(f.p).state.completed.includes(1), false);
    f.p.getSkillManager().addExperience(core.Skill.ATTACK, 5000, false);
    for (const id of [1, 2, 3]) assert.equal(state(f.p).state.completed.includes(id), true);
});

function jon(f, clickType = 4) {
    const npc = core.NPC.create(
        core.CacheDefinitions.getNpcId("ap_guide_active"),
        new core.Location(3234, 3223, 0),
    );
    PluginManager.emitNpcInteraction({
        player: f.p,
        npc,
        npcId: npc.getId(),
        definition: npc.getDefinition(),
        clickType,
        handled: false,
    });
    return npc;
}
test("Jon opens the native path overview through his real Open option", (t) => {
    const f = actor(t);
    login(f.p);
    jon(f);
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("adventurepath"));
});
test("Jon Claim grants earned cache rewards only once and records free and member entitlements separately", (t) => {
    const f = actor(t);
    f.p.getSkillManager().setMaxLevels(core.Skill.ATTACK, 5, false);
    login(f.p);
    const task = state(f.p).tasks.find((t) => t.id === 1);
    jon(f, 3);
    for (const r of task.free) assert.equal(f.p.getInventory().getAmount(r.id), r.amount);
    assert.deepEqual(state(f.p).state.free, [1]);
    assert.deepEqual(state(f.p).state.members, [1]);
    const snapshot = f.p
        .getInventory()
        .getValidItems()
        .map((i) => [i.getId(), i.getAmount()]);
    jon(f, 3);
    assert.deepEqual(
        f.p
            .getInventory()
            .getValidItems()
            .map((i) => [i.getId(), i.getAmount()]),
        snapshot,
    );
});
test("a full bag cannot spend unclaimed reward entitlements", (t) => {
    const f = actor(t);
    f.p.getSkillManager().setMaxLevels(core.Skill.ATTACK, 5, false);
    login(f.p);
    while (f.p.getInventory().getFreeSlots())
        f.p.getInventory().add(new core.Item(core.ItemIdentifiers.SPADE), false);
    jon(f, 3);
    assert.deepEqual(state(f.p).state.free, []);
    assert.deepEqual(state(f.p).state.members, []);
});

test("native client view settings persist while forged progress varps do not", async (t) => {
    const f = actor(t);
    login(f.p);
    jon(f);
    const C = core.CacheDefinitions,
        id = C.getVarpId("adventurepath_selected_path");
    await f.connection.dispatch([{ type: "varp_transmit", varpId: id, value: 1 }]);
    f.connection.processTurnPackets();
    assert.equal(f.p.getPacketSender().getVarp(id), 1);
    assert.equal(state(f.p).state.settings[id], 1);
    const completed = C.getVarpId("adventurepath_1_task");
    await f.connection.dispatch([{ type: "varp_transmit", varpId: completed, value: 2147483647 }]);
    f.connection.processTurnPackets();
    assert.deepEqual(state(f.p).state.completed, []);
});

function itemAction(f, id, option) {
    const item = f.p
            .getInventory()
            .getValidItems()
            .find((i) => i.getId() === id),
        slot = f.p.getInventory().getItems().indexOf(item);
    return PluginManager.emitItemAction({
        player: f.p,
        item,
        itemId: id,
        slot,
        interfaceId: core.CacheDefinitions.getComponentId("inventory:items"),
        option,
        clickType: 1,
        handled: false,
    });
}
test("searching a legitimate kit grants its contents once and preserves an unopened full-bag kit", (t) => {
    const f = actor(t);
    login(f.p);
    const id = core.CacheDefinitions.getObjId("adventurepath_combat_kit");
    state(f.p).state.kits.push(0);
    f.p.getInventory().add(new core.Item(id), false);
    assert.equal(itemAction(f, id, "Search"), true);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.IRON_LONGSWORD), 1);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE), 40);
    assert.equal(f.p.getInventory().getAmount(id), 0);
    f.p.getInventory().add(new core.Item(id), false);
    itemAction(f, id, "Search");
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.IRON_LONGSWORD), 1);
    const g = actor(t);
    login(g.p);
    state(g.p).state.kits.push(0);
    g.p.getInventory().add(new core.Item(id), false);
    while (g.p.getInventory().getFreeSlots())
        g.p.getInventory().add(new core.Item(core.ItemIdentifiers.SPADE), false);
    itemAction(g, id, "Search");
    assert.equal(g.p.getInventory().getAmount(id), 1);
    assert.equal(g.p.getInventory().getAmount(core.ItemIdentifiers.IRON_LONGSWORD), 0);
});
test("gatherer lamp accepts only the three gathering skills and consumes itself once", async (t) => {
    const f = actor(t);
    login(f.p);
    const id = core.CacheDefinitions.getObjId("adventurepath_gatherer_lamp");
    state(f.p).state.paths.push(1);
    f.p.getInventory().add(new core.Item(id), false);
    assert.equal(itemAction(f, id, "Rub"), true);
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("xpreward"));
    const slot =
        [...core.CacheDefinitions.getEnumValues(681)].find(
            ([k, v]) => v === core.Skill.FISHING.getClientId(),
        )[0] - 1;
    await f.connection.dispatch([
        {
            type: "dialogue_continue",
            widgetId: core.CacheDefinitions.getComponentId("xpreward:universe"),
            childIndex: slot,
        },
    ]);
    f.connection.processTurnPackets();
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.FISHING), 150);
    assert.equal(f.p.getInventory().getAmount(id), 0);
});

function voucherNpc(f, name) {
    const id = core.CacheDefinitions.getNpcId(
        {
            Aubury: "aubury",
            Lowe: "lowe",
            Apothecary: "apothecary",
            Horvik: "horvik_the_armourer",
            "Sword shop keeper": "swordshop1",
            "Grand Exchange Clerk": "ge_clerk_1",
        }[name],
    );
    assert.ok(Number.isInteger(id), name);
    const npc = core.NPC.create(id, f.p.getLocation().clone()),
        item = f.p
            .getInventory()
            .getValidItems()
            .find(
                (i) => i.getId() === core.CacheDefinitions.getObjId("adventurepath_combat_voucher"),
            );
    return PluginManager.emitItemOnNpc({
        player: f.p,
        target: npc,
        definition: npc.getDefinition(),
        item,
        itemId: item.getId(),
        slot: f.p.getInventory().getItems().indexOf(item),
        handled: false,
    });
}
test("voucher redemption uses Wiki quantities, preserves partial use and cannot pay twice", (t) => {
    const f = actor(t);
    login(f.p);
    state(f.p).state.paths.push(0);
    const voucher = core.CacheDefinitions.getObjId("adventurepath_combat_voucher");
    f.p.getInventory().add(new core.Item(voucher), false);
    voucherNpc(f, "Aubury");
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE), 200);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.MIND_RUNE), 200);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.CHAOS_RUNE), 50);
    assert.equal(f.p.getInventory().getAmount(voucher), 1);
    voucherNpc(f, "Aubury");
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE), 200);
});
// #1356 review: redeem took every Talk-to on a voucher NPC, even with nothing left to claim there, so Aubury and the
// Apothecary only said "No voucher rewards can be claimed here..." until all nine rewards were claimed.
test("Talk-to a voucher NPC whose rewards are claimed is the NPC's own conversation; the first pays", (t) => {
    const f = actor(t);
    login(f.p);
    state(f.p).state.paths.push(0);
    const voucher = core.CacheDefinitions.getObjId("adventurepath_combat_voucher");
    f.p.getInventory().add(new core.Item(voucher), false);
    const npc = core.NPC.create(core.CacheDefinitions.getNpcId("aubury"), f.p.getLocation().clone());
    const talk = () => {
        const event = { player: f.p, npc, npcId: npc.getId(), clickType: 1, action: "Talk-to", handled: false };
        PluginManager.emitNpcInteraction(event);
        return event;
    };
    talk();
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE), 200, "the first Talk-to pays Aubury's runes");
    f.p.getDialogueManager().reset?.();
    f.p.getPacketSender().sendInterfaceRemoval();
    f.messages.length = 0;
    const second = talk();
    assert.equal(second.handled, true, "the NPC's own Talk-to takes it");
    assert.ok(!f.messages.some((m) => /No voucher rewards can be claimed here/.test(m)), f.messages.join(" | "));
    assert.ok(f.p.getDialogueManager().isActive(), "Aubury's conversation is open");
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE), 200, "nothing paid twice");
    assert.equal(f.p.getInventory().getAmount(voucher), 1, "the voucher stays for the other NPCs");
});

test("the last voucher redemption can use the freed last inventory slot", (t) => {
    const f = actor(t);
    login(f.p);
    const s = state(f.p).state;
    s.paths.push(0);
    s.vouchers = [1, 2, 3, 4, 5, 6, 7, 8];
    const voucher = core.CacheDefinitions.getObjId("adventurepath_combat_voucher");
    while (f.p.getInventory().getFreeSlots() > 1)
        f.p.getInventory().add(new core.Item(core.ItemIdentifiers.SPADE), false);
    f.p.getInventory().add(new core.Item(voucher), false);
    voucherNpc(f, "Grand Exchange Clerk");
    assert.equal(f.p.getInventory().getAmount(voucher), 0);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 2500);
    assert.equal(s.vouchers.includes(0), true);
});

async function resume(f, choice) {
    const group = f.p.getPacketSender().getChatboxGroupId(),
        widgetId =
            choice == null
                ? (group << 16) | ([231, 217].includes(group) ? 5 : 0)
                : core.OptionDialogue.OPTIONS_WIDGET_ID;
    await f.connection.dispatch([
        { type: "dialogue_continue", widgetId, childIndex: choice ?? -1 },
    ]);
    f.connection.processTurnPackets();
}
async function menu(f) {
    for (let i = 0; i < 40; i++) {
        const pending = core.MultiChatboxPrompt.getPending(f.p);
        if (pending) return pending.options;
        const cur = f.p.getDialogueManager().getCurrent();
        if (cur instanceof core.OptionDialogue) return cur.getOptions();
        if (!cur) return [];
        await resume(f);
    }
    throw Error("dialogue did not reach a menu");
}
async function choose(f, text) {
    for (let i = 0; i < 5; i++) {
        const opts = await menu(f),
            index = opts.findIndex((x) => x === text || x.startsWith(text));
        if (index >= 0) {
            await resume(f, index + 1);
            return;
        }
        const more = opts.findIndex((x) => /More/.test(x));
        assert.ok(more >= 0, "missing option " + text + " in " + opts);
        await resume(f, more + 1);
    }
    throw Error("missing menu option " + text);
}
test("canonical Jon conversation supplies a kit and recovers a lost unopened kit without duplicates", async (t) => {
    const f = actor(t);
    login(f.p);
    jon(f, 1);
    await choose(f, "Do you have any Adventure Path starter kits");
    await menu(f);
    const id = core.CacheDefinitions.getObjId("adventurepath_combat_kit");
    assert.equal(f.p.getInventory().getAmount(id), 1);
    f.p.getPacketSender().sendInterfaceRemoval();
    f.p.getInventory().deleteNumber(id, 1, false);
    jon(f, 1);
    await choose(f, "Do you have any Adventure Path starter kits");
    await menu(f);
    assert.equal(f.p.getInventory().getAmount(id), 1);
});
test("native opt-out and opt-in use the canonical confirmation choices and Jon transform", async (t) => {
    const f = actor(t);
    login(f.p);
    jon(f, 1);
    await choose(f, "Disable Adventure Paths.");
    await choose(f, "Yes");
    await menu(f);
    assert.equal(state(f.p).state.disabled, true);
    assert.equal(
        f.p
            .getPacketSender()
            .getVarbit(core.CacheDefinitions.getVarbitId("adventurepath_player_participating")),
        2,
    );
    f.p.getPacketSender().sendInterfaceRemoval();
    jon(f, 1);
    await choose(f, "Yes please.");
    await choose(f, "Yes");
    await menu(f);
    assert.equal(state(f.p).state.disabled, false);
    assert.equal(
        f.p
            .getPacketSender()
            .getVarbit(core.CacheDefinitions.getVarbitId("adventurepath_player_participating")),
        1,
    );
});
test("delayed lamp confirmation refuses dead, trading, placed and changed item/meta states", async (t) => {
    for (const mode of ["dead", "trade", "placed", "id", "meta"]) {
        const f = actor(t);
        login(f.p);
        const id = core.CacheDefinitions.getObjId("adventurepath_gatherer_lamp");
        state(f.p).state.paths.push(1);
        f.p.getInventory().add(new core.Item(id), false);
        const item = f.p.getInventory().getValidItems()[0];
        itemAction(f, id, "Rub");
        if (mode === "dead") f.p.setHitpoints(0);
        if (mode === "trade") f.p.setStatus(core.PlayerStatus.TRADING);
        if (mode === "placed") f.p.needsPlacement = true;
        if (mode === "id") item.setId(core.ItemIdentifiers.SPADE);
        if (mode === "meta") item.setMetaValue("test:copy", true);
        const slot =
            [...core.CacheDefinitions.getEnumValues(681)].find(
                ([k, v]) => v === core.Skill.FISHING.getClientId(),
            )[0] - 1;
        await f.connection.dispatch([
            {
                type: "dialogue_continue",
                widgetId: core.CacheDefinitions.getComponentId("xpreward:universe"),
                childIndex: slot,
            },
        ]);
        f.connection.processTurnPackets();
        assert.equal(f.p.getSkillManager().getExperience(core.Skill.FISHING), 0, mode);
        assert.equal(f.p.getInventory().forSlot(0).getAmount(), 1, mode);
    }
});

test("native path overview mounts its side panel and restores the last selected task", (t) => {
    const f = actor(t);
    login(f.p);
    const C = core.CacheDefinitions;
    state(f.p).state.settings[C.getVarpId("adventurepath_selected_task")] = 1;
    jon(f);
    assert.equal(
        f.p.getPacketSender().isSubInterfaceOpen(C.getInterfaceId("adventurepath_side")),
        true,
    );
    assert.equal(f.p.getPacketSender().getVarp(C.getVarpId("adventurepath_selected_task")), 1);
});
test("the Grand Exchange Clerk's unpaid-voucher branch never plays: Talk-to pays the voucher first", (t) => {
    const f = actor(t);
    login(f.p);
    assert.equal(
        PluginManager.emitNpcDialogueCondition({
            player: f.p,
            definition: { getName: () => "Grand Exchange Clerk" },
            text: "If the player is carrying a Combat path voucher and hasn't received their reward:",
        }),
        false,
    );
});

test("Lumbridge tutor conditions use actual Adventure Path participation", (t) => {
    const f = actor(t);
    login(f.p);
    const npcId = core.NpcIdentifiers.MAGIC_COMBAT_TUTOR;
    assert.equal(
        PluginManager.emitNpcDialogueCondition({
            player: f.p,
            npcId,
            text: "If the player has Adventure Paths",
        }),
        true,
    );
    assert.equal(
        PluginManager.emitNpcDialogueCondition({
            player: f.p,
            npcId,
            text: "If the player does not have Adventure Paths",
        }),
        false,
    );
    state(f.p).state.disabled = true;
    assert.equal(
        PluginManager.emitNpcDialogueCondition({
            player: f.p,
            npcId,
            text: "If the player has Adventure Paths",
        }),
        false,
    );
});

test("ineligible experienced and Ironman players can still hear Jon explain Adventure Paths", async (t) => {
    for (const opts of [{ experience: "experienced" }, { iron: true }]) {
        const f = actor(t, opts);
        login(f.p);
        jon(f, 1);
        assert.ok(f.p.getDialogueManager().isActive());
        await menu(f);
        assert.equal(f.p.getInventory().getValidItems().length, 0);
        assert.equal(state(f.p).eligible, false);
    }
});

function click(f, name, action = 1, slot = -1) {
    const buttonId = core.CacheDefinitions.getComponentId(name);
    return PluginManager.emitInterfaceActionClick({
        player: f.p,
        buttonId,
        groupId: buttonId >>> 16,
        componentId: buttonId & 65535,
        action,
        slot,
        itemId: -1,
        handled: false,
    });
}
test("side-panel Show Paths and Show Task information reopen the native overview", (t) => {
    const f = actor(t);
    login(f.p);
    jon(f);
    f.p
        .getPacketSender()
        .sendInterface(core.CacheDefinitions.getInterfaceId("adventurepath_reward"));
    click(f, "adventurepath_side:open_interface");
    assert.equal(f.p.getInterfaceId(), core.CacheDefinitions.getInterfaceId("adventurepath"));
    const C = core.CacheDefinitions;
    f.p.getPacketSender().sendVarbit(C.getVarbitId("adventurepath_path_in_focus"), 1);
    f.p.getPacketSender().sendVarbit(C.getVarbitId("adventurepath_gatherer_task_focus"), 1);
    click(f, "adventurepath_side:task_name");
    assert.equal(f.p.getPacketSender().getVarp(C.getVarpId("adventurepath_selected_task")), 16);
    assert.equal(f.p.getPacketSender().getVarp(C.getVarpId("adventurepath_selected_path")), 1);
});
test("native task hint controls use the cache location and remove the arrow", (t) => {
    const f = actor(t);
    login(f.p);
    jon(f);
    const C = core.CacheDefinitions;
    f.p.getPacketSender().sendConfig(C.getVarpId("adventurepath_selected_task"), 16);
    const hints = [];
    t.mock.method(f.p.getPacketSender(), "sendPositionalHint", (location) => {
        hints.push([location.getX(), location.getY(), location.getZ()]);
        return f.p.getPacketSender();
    });
    let removed = 0;
    t.mock.method(f.p.getPacketSender(), "clearHintArrow", () => {
        removed++;
        return f.p.getPacketSender();
    });
    click(f, "adventurepath:navigation");
    assert.deepEqual(hints, [[3242, 3151, 0]]);
    click(f, "adventurepath:navigation", 2);
    assert.equal(removed, 1);
});

// Load the real world-definition module against isolated on-disk configuration; no game-object or reward mocks.
function configureWorld(t, members) {
    const fs = require("node:fs"),
        os = require("node:os"),
        modulePath = require.resolve("../dist/game/definition/WorldDefinition"),
        original = require.cache[modulePath],
        target = core.WorldDefinition,
        saved = { ...target },
        cwd = process.cwd(),
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsps-adventure-world-"));
    try {
        fs.mkdirSync(path.join(dir, "data/definitions"), { recursive: true });
        fs.writeFileSync(
            path.join(dir, "data/definitions/world.json"),
            JSON.stringify({
                spawn: { x: 3222, y: 3219, z: 0 },
                zones: [{ tags: ["f2p"] }],
                experienceMultiplier: 1,
                membersWorld: members,
            }),
        );
        process.chdir(dir);
        delete require.cache[modulePath];
        Object.assign(target, require(modulePath));
    } finally {
        process.chdir(cwd);
        require.cache[modulePath] = original;
        const resolved = path.resolve(dir);
        assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
    t.after(() => Object.assign(target, saved));
}
test("F2P task claims keep supplemental member rewards available across a saved-state reload", (t) => {
    configureWorld(t, false);
    const f = actor(t);
    f.p.getSkillManager().setMaxLevels(core.Skill.ATTACK, 5, false);
    login(f.p);
    const task = state(f.p).tasks.find((x) => x.id === 1);
    jon(f, 3);
    assert.deepEqual(state(f.p).state.free, [1]);
    assert.deepEqual(state(f.p).state.members, []);
    const saved = JSON.parse(JSON.stringify(state(f.p).state)),
        g = actor(t);
    g.p.setAttribute("adventure-paths:state", saved);
    g.p.getSkillManager().setMaxLevels(core.Skill.ATTACK, 5, false);
    for (const i of f.p.getInventory().getValidItems()) g.p.getInventory().add(i.clone(), false);
    configureWorld(t, true);
    login(g.p);
    const originalFree = task.free.map((r) => [r.id, g.p.getInventory().getAmount(r.id)]);
    jon(g, 3);
    assert.deepEqual(state(g.p).state.members, [1]);
    for (const [id, amount] of originalFree)
        assert.equal(
            g.p.getInventory().getAmount(id),
            amount + (task.members.find((r) => r.id === id)?.amount ?? 0),
        );
    const snapshot = g.p
        .getInventory()
        .getItems()
        .map((i) => [i.getId(), i.getAmount()]);
    jon(g, 3);
    assert.deepEqual(
        g.p
            .getInventory()
            .getItems()
            .map((i) => [i.getId(), i.getAmount()]),
        snapshot,
    );
});
test("all 18 cache task rewards and both path completion items can be claimed once", (t) => {
    const f = actor(t);
    login(f.p);
    const tasks = state(f.p).tasks;
    assert.equal(new Set(tasks.map((x) => x.id)).size, 18);
    for (const task of tasks) {
        const skill = core.Skill.values().find((s) => s.getIndex() === task.skill);
        f.p.getSkillManager().setMaxLevels(skill, 20, false);
        for (const reward of [...task.free, ...task.members]) {
            assert.ok(Number.isInteger(reward.id) && reward.id > 0);
            assert.ok(Number.isSafeInteger(reward.amount) && reward.amount > 0);
        }
    }
    login(f.p);
    assert.equal(state(f.p).state.completed.length, 18);
    for (let i = 0; i < 4; i++) {
        jon(f, 3);
        const bag = f.p.getInventory();
        for (const [slot, item] of bag.getItems().entries())
            if (
                item.getId() > 0 &&
                ![
                    core.CacheDefinitions.getObjId("adventurepath_combat_voucher"),
                    core.CacheDefinitions.getObjId("adventurepath_gatherer_lamp"),
                ].includes(item.getId())
            )
                bag.deleteAtSlot(slot, item.getAmount());
    }
    assert.equal(state(f.p).state.free.length, 18);
    assert.deepEqual([...state(f.p).state.paths].sort(), [0, 1]);
    assert.equal(
        f.p
            .getInventory()
            .getAmount(core.CacheDefinitions.getObjId("adventurepath_combat_voucher")),
        1,
    );
    assert.equal(
        f.p.getInventory().getAmount(core.CacheDefinitions.getObjId("adventurepath_gatherer_lamp")),
        1,
    );
});
test("all voucher recipients pay their free then member entitlements, recovering the consumed F2P voucher", (t) => {
    configureWorld(t, false);
    const f = actor(t);
    login(f.p);
    state(f.p).state.paths.push(0);
    const id = core.CacheDefinitions.getObjId("adventurepath_combat_voucher");
    f.p.getInventory().add(new core.Item(id), false);
    for (const name of ["Grand Exchange Clerk", "Lowe", "Aubury", "Apothecary"])
        voucherNpc(f, name);
    assert.equal(f.p.getInventory().getAmount(id), 0);
    assert.deepEqual([...state(f.p).state.vouchers].sort(), [0, 1, 2, 3]);
    configureWorld(t, true);
    jon(f, 3);
    assert.equal(f.p.getInventory().getAmount(id), 1);
    for (const name of ["Horvik", "Sword shop keeper", "Lowe", "Aubury", "Apothecary"])
        voucherNpc(f, name);
    assert.deepEqual([...state(f.p).state.vouchers].sort(), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(f.p.getInventory().getAmount(id), 0);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.IRON_ARROW), 200);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE), 200);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.ENERGY_POTION_3_), 5);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.ENERGY_POTION_4_), 5);
    jon(f, 3);
    assert.equal(f.p.getInventory().getAmount(id), 0);
});

test("canonical Talk reward choice recovers lost unused completion items when no task claims remain", async (t) => {
    for (const itemName of ["adventurepath_gatherer_lamp", "adventurepath_combat_voucher"]) {
        const f = actor(t);
        login(f.p);
        const s = state(f.p).state;
        s.paths = [0, 1];
        s.kitOpened = true;
        s.vouchers = [0];
        jon(f, 1);
        await choose(f, "I'd like to claim my Adventure Path rewards.");
        await menu(f);
        assert.equal(
            f.p.getInventory().getAmount(core.CacheDefinitions.getObjId(itemName)),
            1,
            itemName,
        );
    }
});

test("focus changes preserve authoritative recommendation bits while saving only client-owned bits", async (t) => {
    const f = actor(t);
    login(f.p);
    jon(f);
    const C = core.CacheDefinitions,
        id = C.getVarpId("adventurepath_in_focus"),
        before = f.p.getPacketSender().getVarp(id);
    assert.notEqual(before & (31 << 16), 0);
    const focus = 1 | (1 << 21),
        value = (before & ~(2047 | (31 << 11) | (7 << 21))) | focus;
    await f.connection.dispatch([{ type: "varp_transmit", varpId: id, value }]);
    f.connection.processTurnPackets();
    assert.equal(f.p.getPacketSender().getVarp(id), value);
    assert.equal(state(f.p).state.settings[id], focus);
    const s = JSON.parse(JSON.stringify(state(f.p).state)),
        g = actor(t);
    g.p.setAttribute("adventure-paths:state", s);
    login(g.p);
    assert.equal(g.p.getPacketSender().getVarp(id), value);
});

test("cache tree category is retained for native resource hint selection", () => {
    assert.equal(core.CacheDefinitions.getObject(core.ObjectIdentifiers.TREE).category, 189);
});

test("native hints select a real loaded tree and a registered fishing spot before the fallback", (t) => {
    const f = actor(t);
    login(f.p);
    jon(f);
    const C = core.CacheDefinitions,
        out = f.p.getPacketSender(),
        tiles = [],
        npcs = [];
    t.mock.method(out, "sendPositionalHint", (p) => {
        tiles.push(p);
        return out;
    });
    t.mock.method(out, "sendEntityHint", (npc) => {
        npcs.push(npc);
        return out;
    });
    f.p.setLocation(new core.Location(3228, 3246, 0));
    core.RegionManager.loadMapFiles(3228, 3246);
    out.sendConfig(C.getVarpId("adventurepath_selected_task"), 17);
    click(f, "adventurepath:navigation");
    assert.equal(tiles.length, 1);
    assert.ok(f.messages.includes("A hint arrow has been added above a tree you can chop."));
    f.p.setLocation(new core.Location(3245, 3157, 0));
    const id = [...C.getNpcNames().keys()].find((id) => C.getNpc(id).category === 283);
    assert.ok(Number.isInteger(id));
    const npc = core.NPC.create(id, new core.Location(3245, 3158, 0));
    core.World.getNpcs().add(npc);
    t.after(() => core.World.getNpcs().remove(npc));
    out.sendConfig(C.getVarpId("adventurepath_selected_task"), 16);
    click(f, "adventurepath:navigation");
    assert.deepEqual(npcs, [npc]);
    assert.ok(
        f.messages.includes("A hint arrow has been added above a fishing spot you can fish from."),
    );
});

test("real PlayerSave round trip retains enrollment without Tutorial Island saved fields", (t) => {
    const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
    const f = actor(t);
    login(f.p);
    f.p.getSkillManager().setMaxLevels(core.Skill.ATTACK, 5, false);
    login(f.p);
    const saved = PlayerSave.fromPlayer(f.p),
        g = actor(t, { experience: "experienced" });
    g.p.setAttribute("tutorial-island:experience", null);
    g.p.setAttribute("tutorial-island:progress", null);
    delete saved.attributes["tutorial-island:experience"];
    delete saved.attributes["tutorial-island:progress"];
    assert.equal(saved.attributes["adventure-paths:state"].experience, "new");
    assert.equal(saved.attributes["adventure-paths:state"].tutorialComplete, true);
    saved.applyToPlayer(g.p);
    login(g.p);
    assert.equal(state(g.p).eligible, true);
    assert.ok(state(g.p).state.completed.includes(1));
});
