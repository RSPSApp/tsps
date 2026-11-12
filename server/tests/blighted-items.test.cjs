// Run after `yarn build`: node --test tests/blighted-items.test.cjs
//
// Issue 4682: blighted super restores could be drunk anywhere (Varrock, Edgeville). Blighted
// supplies share one rule (plugins/items/BlightedItems.js): the Wilderness, Ferox Enclave, the
// Mage Arena bank, PvP worlds, Castle Wars, Clan Wars and Soul Wars (Wiki: Blighted super restore,
// Blighted manta ray, Blighted karambwan, Blighted anglerfish, the blighted sacks). Clicked here as
// the inventory widget op the cache gives "Drink" / "Eat", through ClientConnection.dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const { isBlightedItem } = require("../plugins/items/BlightedItems");

const VARROCK = [3212, 3424];
const EDGEVILLE = [3094, 3493];
const WILDERNESS = [3100, 3600];
const FEROX_ENCLAVE = [3150, 3635];
const MAGE_ARENA_BANK = [2539, 4712];
const POTION_REFUSAL = "The blighted potion can be used only in the Wilderness.";
let core;
let I;
let next = 7400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, [x, y]) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("blight" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, 0));
  p.needsPlacement = false;
  const skills = p.getSkillManager();
  for (const name of ["HITPOINTS", "PRAYER", "ATTACK"]) {
    const skill = core.Skill[name];
    skills.setExperience(skill, core.SkillManager.getExperienceForLevel(99));
    skills.setMaxLevel(skill, 99);
    skills.setCurrentLevel(skill, 99, false);
  }
  skills.setCurrentLevel(core.Skill.PRAYER, 10, false);
  skills.setCurrentLevel(core.Skill.ATTACK, 50, false);
  p.setHitpoints(50);
  const c = new ClientConnection(channel);
  c.player = p;
  const game = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    game.push(message);
    return p.getPacketSender();
  });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), skills, game };
}

function opFor(itemId, option) {
  for (const op of [2, 3, 4, 5, 6, 7]) {
    if (ItemActionPacketListener.resolveInventoryWidgetAction(itemId, op)?.option === option) return op;
  }
  assert.fail(`the cache gives item ${itemId} no ${option} op`);
}

async function use(f, slot, option) {
  const itemId = f.inv.getItems()[slot].getId();
  await f.c.dispatch([{ type: "widget_action", widgetId: 149 << 16, groupId: 149, childId: 0, buttonNum: opFor(itemId, option), slot, itemId }]);
  f.c.processTurnPackets();
}

const slotId = (f, slot) => f.inv.getItems()[slot]?.getId() ?? -1;
const prayer = (f) => f.skills.getCurrentLevel(core.Skill.PRAYER);

for (const [where, tile] of [["Varrock", VARROCK], ["Edgeville", EDGEVILLE]]) {
  test(`a blighted super restore is refused in ${where}, dose kept`, async t => {
    assert.equal(core.CacheDefinitions.getItem(I.BLIGHTED_SUPER_RESTORE_4_).name, "Blighted super restore(4)");
    const f = actor(t, tile);
    f.inv.setItem(0, new core.Item(I.BLIGHTED_SUPER_RESTORE_4_, 1));
    await use(f, 0, "Drink");
    assert.deepEqual(f.game, [POTION_REFUSAL]);
    assert.equal(slotId(f, 0), I.BLIGHTED_SUPER_RESTORE_4_);
    assert.equal(prayer(f), 10);
  });
}

for (const [where, tile] of [["the Wilderness", WILDERNESS], ["Ferox Enclave", FEROX_ENCLAVE], ["the Mage Arena bank", MAGE_ARENA_BANK]]) {
  test(`a blighted super restore drinks in ${where} like a super restore`, async t => {
    const f = actor(t, tile);
    f.inv.setItem(0, new core.Item(I.BLIGHTED_SUPER_RESTORE_4_, 1));
    await use(f, 0, "Drink");
    assert.ok(!f.game.includes(POTION_REFUSAL), f.game.join(" | "));
    assert.equal(slotId(f, 0), I.BLIGHTED_SUPER_RESTORE_3_);
    // Super restore: 8 + 25% of 99 Prayer.
    assert.equal(prayer(f), 10 + 8 + Math.floor(99 * 0.25));
  });
}

test("an ordinary super restore still drinks in Varrock", async t => {
  const f = actor(t, VARROCK);
  f.inv.setItem(0, new core.Item(I.SUPER_RESTORE_4_, 1));
  await use(f, 0, "Drink");
  assert.equal(slotId(f, 0), I.SUPER_RESTORE_3_);
  assert.ok(prayer(f) > 10);
});

const BLIGHTED_FOOD = [
  ["Blighted manta ray", () => I.BLIGHTED_MANTA_RAY],
  ["Blighted anglerfish", () => I.BLIGHTED_ANGLERFISH],
  ["Blighted karambwan", () => I.BLIGHTED_KARAMBWAN],
];

for (const [name, id] of BLIGHTED_FOOD) {
  test(`${name} is refused in Varrock and eaten at the Mage Arena bank`, async t => {
    assert.equal(core.CacheDefinitions.getItem(id()).name, name);
    const refused = actor(t, VARROCK);
    refused.inv.setItem(0, new core.Item(id(), 1));
    await use(refused, 0, "Eat");
    assert.deepEqual(refused.game, [`The ${name.toLowerCase()} can be eaten only in the Wilderness.`]);
    assert.equal(slotId(refused, 0), id());
    assert.equal(refused.p.getHitpoints(), 50);

    // The Mage Arena bank has no Wilderness level, but blighted supplies work there (Wiki).
    const bank = actor(t, MAGE_ARENA_BANK);
    bank.inv.setItem(0, new core.Item(id(), 1));
    await use(bank, 0, "Eat");
    assert.equal(slotId(bank, 0), -1);
    assert.ok(bank.p.getHitpoints() > 50);
  });
}

test("every cache item named Blighted ... is a blighted item, and nothing else is", () => {
  const named = [I.BLIGHTED_SUPER_RESTORE_1_, I.BLIGHTED_OVERLOAD_4_, I.BLIGHTED_ANCIENT_ICE_SACK, I.BLIGHTED_SURGE_SACK,
    I.BLIGHTED_MANTA_RAY, I.BLIGHTED_KARAMBWAN, I.BLIGHTED_ANGLERFISH];
  for (const id of named) assert.equal(isBlightedItem(core, id), true, core.CacheDefinitions.getItem(id).name);
  for (const id of [I.SUPER_RESTORE_4_, I.MANTA_RAY, I.AHRIMS_HOOD, I.VESTAS_BLIGHTED_LONGSWORD]) {
    assert.equal(isBlightedItem(core, id), false, core.CacheDefinitions.getItem(id).name);
  }
});
