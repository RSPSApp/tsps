// Run after `yarn build`: node --test tests/ralos-rise.test.cjs
// Ralos' Rise prayer training (docs/ralos-rise.md): the exposed altar's blessing, the chisel's
// shards, and the libation bowl's fill, sacrifice loop, refill, refusals, Check and saved state.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { PluginManager } = require("../dist/plugins/PluginManager");

const RalosRise = require("../plugins/skills/RalosRise.plugin");
const Altar = require("../plugins/skills/ralosrise/ExposedAltar.RalosRise");
const Bones = require("../plugins/skills/ralosrise/BlessedBones.RalosRise");
const Bowl = require("../plugins/skills/ralosrise/LibationBowl.RalosRise");
const BONES = require("../plugins/skills/data/bones.json");
const DATA = require("../plugins/skills/data/ralos-rise.json");
const LEAGUE = require("../plugins/modes/data/league-relics.json");

const submitted = [];
const handlers = new Map();
const objectActions = new Map();
const itemActions = new Map();
const itemOnItem = [];
const persisted = [];
const logins = [];
let cycle = 1;
let core;
const api = {
  emitCustomEvent: (name, payload) => (handlers.get(name) ?? []).forEach((handler) => handler(payload)),
  onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  persistAttribute: (...args) => persisted.push(args),
  onObjectInteraction: (name, actions) => objectActions.set(name, actions),
  onItemAction: (name, actions) => itemActions.set(name, actions),
  onItemOnItem: (a, b, handler) => itemOnItem.push({ a, b, handler }),
  onPlayerLogin: (handler) => logins.push(handler),
};
const random = Math.random;
const id = (name) => CacheDefinitions.getObjId(name);

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = {
    ...PluginManager.getCoreApi(),
    World: { getProcessCycle: () => cycle },
    TaskManager: { submit: (task) => { task.setRunning(true); submitted.push(task); } },
  };
  api.core = core;
  RalosRise.register(api);
});

afterEach(() => {
  Math.random = random;
  submitted.length = 0;
});

const runTicks = (ticks) => {
  for (let i = 0; i < ticks; i++) {
    cycle++;
    submitted.filter((task) => task.isRunning()).forEach((task) => task.tick());
  }
};

/** A player carrying `items` (gamevals, or [gameval, amount]), recording what the server sends. */
function playerWith(items, { prayer = 99, points = prayer, worn = [], attributes = {} } = {}) {
  const slots = Array.from({ length: 28 }, (_, slot) => {
    const entry = items[slot];
    if (!entry) return null;
    const [name, amount] = Array.isArray(entry) ? entry : [entry, 1];
    return new core.Item(id(name), amount);
  });
  const sent = { messages: [], boxes: [], spam: [], logged: [], xp: [], animations: [], sounds: [], varbits: new Map(), closed: [] };
  const skills = { points };
  const packets = {
    sendTypedMessage(type, text) { (type === core.ChatType.SPAM ? sent.spam : sent.logged).push(text); return packets; },
    sendSound(sound) { sent.sounds.push(sound); return packets; },
    sendVarbit(varbit, value) { sent.varbits.set(varbit, value); return packets; },
    getVarbit: (varbit) => sent.varbits.get(varbit) ?? 0,
    getVarp: () => 0,
    closeChatboxFor(owner) { sent.closed.push(owner); return true; },
  };
  const attributeMap = new Map(Object.entries(attributes));
  const amountOf = (itemId) => slots.reduce((sum, item) => sum + (item?.getId() === itemId ? item.getAmount() : 0), 0);
  const inventory = {
    getItems: () => slots,
    setItem: (slot, item) => { slots[slot] = item; },
    refreshItems() {},
    getSlotForItemId: (itemId) => slots.findIndex((item) => item?.getId() === itemId),
    getAmount: amountOf,
    deleteAtSlot(slot, amount) {
      const item = slots[slot];
      slots[slot] = item.getAmount() > amount ? new core.Item(item.getId(), item.getAmount() - amount) : null;
    },
    deleteNumber(itemId, amount) {
      const slot = slots.findIndex((item) => item?.getId() === itemId);
      inventory.deleteAtSlot(slot, amount);
    },
    add(item) {
      const slot = slots.findIndex((entry) => entry?.getId() === item.getId());
      if (slot >= 0) slots[slot] = new core.Item(item.getId(), slots[slot].getAmount() + item.getAmount());
      else slots[slots.indexOf(null)] = item;
    },
  };
  const player = {
    sent,
    slots,
    skills,
    amountOf,
    getIndex: () => 1,
    isRegistered: () => true,
    getHitpoints: () => 10,
    getAttribute: (key) => attributeMap.get(key),
    setAttribute: (key, value) => attributeMap.set(key, value),
    sendMessage: (text) => sent.messages.push(text),
    performAnimation: (animation) => sent.animations.push(animation.getId?.() ?? animation.id),
    getPacketSender: () => packets,
    getInventory: () => inventory,
    getEquipment: () => ({ getItems: () => worn.map((name) => ({ getId: () => id(name) })) }),
    getDialogueManager: () => ({ startDialogues: (builder) => sent.boxes.push(builder.getDialogues().get(0)) }),
    getSkillManager: () => ({
      getMaxLevel: () => prayer,
      getCurrentLevel: () => skills.points,
      decreaseCurrentLevel: (_skill, amount, minimum) => { skills.points = Math.max(minimum, skills.points - amount); },
      addExperiences: (skill, xp) => sent.xp.push([skill, xp]),
    }),
  };
  return player;
}

const boxText = (player) => player.sent.boxes.map((box) => box.getText?.() ?? box.text);
const charge = (player) => player.getAttribute(Bowl.CHARGE_ATTRIBUTE);
const CHARGE_VARBIT = () => CacheDefinitions.getVarbitId(DATA.bowl.chargeVarbit);
const TYPE_VARBIT = () => CacheDefinitions.getVarbitId(DATA.bowl.wineVarbit);
const bowl = () => objectActions.get("Libation bowl");

test("the plugin is members-only and hooks the altar, the bowl and every breakable bone", () => {
  assert.equal(RalosRise.members, true);
  assert.deepEqual(Object.keys(objectActions.get("Exposed altar")), ["Bless"]);
  assert.deepEqual(Object.keys(bowl()), ["Fill", "Sacrifice", "Check"]);
  for (const name of ["Blessed bones", "Blessed superior dragon bones", "Sun-kissed bones", "Blessed bone statuette"]) {
    assert.ok(itemActions.get(name)?.["Break-down"], name);
    assert.ok(itemOnItem.some((hook) => hook.a === "Chisel" && hook.b === name), name);
  }
});

test("every blessable bone names a real blessed obj, with the Wiki's (and Soul Harvest's) shard count", () => {
  const league = LEAGUE.effects.soulHarvest.shards;
  const blessed = BONES.bones.filter((row) => row.blessed);
  assert.equal(blessed.length, 19);
  for (const row of blessed) {
    assert.ok(Number.isInteger(id(row.blessed)), row.blessed);
    assert.ok(Number.isInteger(row.shards) && row.shards > 0, row.obj);
  }
  const byObj = Object.fromEntries(blessed.map((row) => [row.obj, row.shards]));
  assert.equal(byObj.bones, league.BONES);
  assert.equal(byObj.dragon_bones, league.DRAGON_BONES);
  assert.equal(byObj.dagannoth_king_bones, league.DAGANNOTH_BONES);
  assert.equal(byObj.dragon_bones_superior, league.SUPERIOR_DRAGON_BONES);
  // Wiki: these cannot be blessed.
  for (const name of ["bones_burnt", "wolf_bones", "tbwt_jogre_bones", "mm_normal_monkey_bones", "tbwt_beast_bones", "dorgesh_construction_bone"]) {
    assert.equal(BONES.bones.find((row) => row.obj === name).blessed, undefined, name);
  }
});

test("Bless turns every wine and blessable bone at once, leaving noted, unblessable and too-high bones", () => {
  const notedDragon = CacheDefinitions.getItem(id("dragon_bones")).notedId;
  const player = playerWith(["jug_wine", "jug_wine", "jug_sunfire_wine", "bones", "dragon_bones", "wolf_bones", "dragon_bones_superior"], { prayer: 69 });
  player.slots[10] = new core.Item(notedDragon, 5);
  objectActions.get("Exposed altar").Bless({ player });
  const names = player.slots.map((item) => item && CacheDefinitions.getObjNames().get(item.getId()));
  assert.deepEqual(names.slice(0, 7), ["jug_wine_blessed", "jug_wine_blessed", "jug_sunfire_wine_blessed", "blessed_bones", "blessed_dragon_bones", "wolf_bones", "dragon_bones_superior"]);
  assert.equal(player.slots[10].getId(), notedDragon);
  assert.deepEqual(player.sent.messages, ["You bless 3 jugs of wine on the altar.", "You bless 2 bones on the altar."]);
  assert.deepEqual(player.sent.animations, [CacheDefinitions.getSeqId("human_lockedchest")]);
  assert.deepEqual(player.sent.sounds, [2674]);
  assert.deepEqual(player.sent.xp, [], "no experience for blessing");
});

test("Bless refuses nothing suitable, low Prayer, and superior dragon bones under 70", () => {
  const nothing = playerWith(["wolf_bones", "bones_burnt"]);
  objectActions.get("Exposed altar").Bless({ player: nothing });
  assert.deepEqual(boxText(nothing), ["You don't have anything suitable to bless on this altar. You'll either<br>need to bring bones or wines to bless."]);
  assert.deepEqual(nothing.sent.logged, ["You don't have anything suitable to bless on this altar. You'll either need to bring bones or wines to bless."]);
  assert.equal(nothing.sent.animations.length, 0);

  const low = playerWith(["bones"], { prayer: 29 });
  objectActions.get("Exposed altar").Bless({ player: low });
  assert.equal(low.slots[0].getId(), id("bones"));
  assert.equal(boxText(low).length, 1);

  const superior = playerWith(["dragon_bones_superior"], { prayer: 69 });
  objectActions.get("Exposed altar").Bless({ player: superior });
  assert.equal(superior.slots[0].getId(), id("dragon_bones_superior"));
  assert.match(boxText(superior)[0], /70/);
  const able = playerWith(["dragon_bones_superior"], { prayer: 70 });
  objectActions.get("Exposed altar").Bless({ player: able });
  assert.equal(able.slots[0].getId(), id("blessed_dragon_bones_superior"));
});

test("a chisel breaks one blessed bone at once and one every 4 ticks, 5 Crafting XP each", () => {
  const player = playerWith(["chisel", "blessed_bones", "blessed_dagannoth_bones", "blessed_bones"]);
  const hook = itemOnItem.find((entry) => entry.b === "Blessed bones");
  assert.equal(hook.handler({ player, usedItemId: id("chisel"), usedWithItemId: id("blessed_bones") }), true);
  assert.equal(player.amountOf(id("blessed_bone_shard")), 4);
  runTicks(3);
  assert.equal(player.amountOf(id("blessed_bone_shard")), 4);
  runTicks(1);
  assert.equal(player.amountOf(id("blessed_bone_shard")), 8);
  runTicks(8);
  assert.equal(player.amountOf(id("blessed_bones")), 0);
  assert.equal(player.amountOf(id("blessed_dagannoth_bones")), 1, "only that kind");
  assert.deepEqual(player.sent.xp.map(([skill, xp]) => [skill, xp]), [[core.Skill.CRAFTING, 5], [core.Skill.CRAFTING, 5]]);
  assert.deepEqual(player.sent.sounds, [2586, 2586]);
  assert.equal(player.sent.animations[0], CacheDefinitions.getSeqId("human_cutting_restart"));
  assert.equal(submitted[0].isRunning(), false);

  // Break-down, and the already-blessed items.
  const statuette = playerWith(["chisel", "varlamore_bone_statuette02", "sun_kissed_bone"]);
  itemActions.get("Blessed bone statuette")["Break-down"]({ player: statuette, itemId: id("varlamore_bone_statuette02") });
  itemActions.get("Sun-kissed bones")["Break-down"]({ player: statuette, itemId: id("sun_kissed_bone") });
  assert.equal(statuette.amountOf(id("blessed_bone_shard")), 170);
});

test("breaking down needs a chisel, and 70 Prayer for blessed superior dragon bones; other items pass through", () => {
  const noChisel = playerWith(["blessed_bones"]);
  itemActions.get("Blessed bones")["Break-down"]({ player: noChisel, itemId: id("blessed_bones") });
  assert.equal(noChisel.amountOf(id("blessed_bones")), 1);
  assert.equal(noChisel.sent.messages.length, 1);
  const low = playerWith(["chisel", "blessed_dragon_bones_superior"], { prayer: 69 });
  itemActions.get("Blessed superior dragon bones")["Break-down"]({ player: low, itemId: id("blessed_dragon_bones_superior") });
  assert.equal(low.amountOf(id("blessed_bone_shard")), 0);
  // "Dagannoth bones" names both the blessed and the plain bones: the plain ones are not ours.
  const plain = playerWith(["chisel", "dagannoth_king_bones"]);
  const hook = itemOnItem.find((entry) => entry.b === "Dagannoth bones");
  assert.equal(hook.handler({ player: plain, usedItemId: id("chisel"), usedWithItemId: id("dagannoth_king_bones") }), false);
});

test("the bowl's multiloc shows Fill at charge 0 and Sacrifice/Check from 1 to 400", () => {
  const bowlLoc = CacheDefinitions.getLocId("varlamore_libation_bowl");
  const cached = CacheDefinitions.getObject(bowlLoc);
  assert.equal(cached.transformVarbit, CHARGE_VARBIT());
  assert.deepEqual(cached.transforms, [CacheDefinitions.getLocId("varlamore_libation_bowl_empty"), CacheDefinitions.getLocId("varlamore_libation_bowl_full")]);
  const actions = (value) => {
    const player = playerWith([]);
    player.getPacketSender().sendVarbit(CHARGE_VARBIT(), value);
    return ObjectDefinition.forPlayer(bowlLoc, player).getInteractions().filter(Boolean);
  };
  assert.deepEqual(actions(0), ["Fill"]);
  for (const value of [1, 100, 400]) assert.deepEqual(actions(value), ["Sacrifice", "Check"], String(value));
});

test("Fill pours the first blessed jug for 400 charges, and the bowl sacrifices 4 ticks later", () => {
  const player = playerWith(["jug_wine", "jug_sunfire_wine_blessed", "jug_wine_blessed", ["blessed_bone_shard", 150]]);
  bowl().Fill({ player });
  assert.equal(player.slots[1].getId(), id("jug_empty"));
  assert.equal(player.slots[2].getId(), id("jug_wine_blessed"));
  assert.equal(charge(player), 400);
  assert.equal(player.sent.varbits.get(CHARGE_VARBIT()), 400);
  assert.equal(player.sent.varbits.get(TYPE_VARBIT()), 1);
  assert.deepEqual(boxText(player), ["You pour some blessed sunfire wine into the libation<br>bowl."]);
  assert.equal(player.sent.boxes[0].getItemId(), id("jug_sunfire_wine_blessed"));
  assert.deepEqual(player.sent.animations, [CacheDefinitions.getSeqId("human_pickuptable")]);
  assert.deepEqual(player.sent.sounds, [2401]);
  runTicks(3);
  assert.equal(player.amountOf(id("blessed_bone_shard")), 150);
  runTicks(1);
  assert.equal(player.amountOf(id("blessed_bone_shard")), 50);
  assert.equal(charge(player), 300);
  assert.deepEqual(player.sent.closed, [Bowl._test.FILL_BOX], "the sacrifice closes the fill's box");
  assert.deepEqual(player.sent.xp.at(-1), [core.Skill.PRAYER, 600], "6 a shard with sunfire wine");

  const none = playerWith(["jug_wine"]);
  bowl().Fill({ player: none });
  assert.deepEqual(boxText(none), ["You don't have any blessed wine to fill the libation bowl with."]);
  assert.equal(charge(none), undefined);
});

test("Sacrifice takes up to 100 shards and 2 Prayer points, refills from a jug, and stops when the wine runs out", () => {
  Math.random = () => 0.99;
  const player = playerWith([["blessed_bone_shard", 950], "jug_wine_blessed"], { points: 50, attributes: { [Bowl.CHARGE_ATTRIBUTE]: 200 } });
  bowl().Sacrifice({ player });
  assert.equal(player.amountOf(id("blessed_bone_shard")), 850);
  assert.equal(charge(player), 100);
  assert.equal(player.skills.points, 48);
  assert.deepEqual(player.sent.xp, [[core.Skill.PRAYER, 500]]);
  assert.deepEqual(player.sent.animations, [CacheDefinitions.getSeqId("human_pray_blessed_bone_shards_01")]);
  assert.deepEqual(player.sent.sounds, [958]);

  // Another click on the same tick does nothing more; on the next tick it sacrifices at once.
  bowl().Sacrifice({ player });
  assert.equal(player.amountOf(id("blessed_bone_shard")), 850);
  cycle++;
  bowl().Sacrifice({ player });
  assert.equal(player.amountOf(id("blessed_bone_shard")), 750);
  // The bowl ran dry: the jug refilled it on the same tick.
  assert.equal(charge(player), 400);
  assert.equal(player.slots[1].getId(), id("jug_empty"));
  assert.deepEqual(player.sent.spam, ["You pour some more blessed wine into the libation bowl."]);
  assert.deepEqual(player.sent.sounds, [958, 958, 2401]);

  // Left alone: every 4 ticks, then the second jug's worth runs out.
  runTicks(4 * 4);
  assert.equal(player.amountOf(id("blessed_bone_shard")), 350);
  assert.equal(charge(player), 0);
  assert.deepEqual(boxText(player), ["You don't have enough blessed wine to sacrifice any more shards<br>into the libation bowl."]);
  runTicks(8);
  assert.equal(player.amountOf(id("blessed_bone_shard")), 350);
  assert.equal(player.sent.xp.length, 6);
});

test("the bowl refuses without shards or Prayer points, and stops when they run out", () => {
  const filled = { [Bowl.CHARGE_ATTRIBUTE]: 400 };
  const noShards = playerWith([], { attributes: filled });
  bowl().Sacrifice({ player: noShards });
  assert.deepEqual(boxText(noShards), ["You don't have any blessed bone shards to sacrifice into the libation<br>bowl."]);
  const noPrayer = playerWith([["blessed_bone_shard", 10]], { points: 1, attributes: filled });
  bowl().Sacrifice({ player: noPrayer });
  assert.deepEqual(boxText(noPrayer), ["You need at least two prayer points to sacrifice blessed bone shards<br>into the libation bowl."]);
  assert.equal(noPrayer.amountOf(id("blessed_bone_shard")), 10);

  Math.random = () => 0.99;
  const running = playerWith([["blessed_bone_shard", 500]], { points: 3, attributes: { ...filled } });
  bowl().Sacrifice({ player: running });
  assert.equal(running.skills.points, 1);
  assert.deepEqual(boxText(running), ["You need at least two prayer points to continue sacrificing blessed<br>bone shards into the libation bowl."]);
  runTicks(8);
  assert.equal(running.amountOf(id("blessed_bone_shard")), 400);

  const low = playerWith([["blessed_bone_shard", 10]], { prayer: 29, attributes: filled });
  bowl().Sacrifice({ player: low });
  assert.equal(low.amountOf(id("blessed_bone_shard")), 10);
  assert.equal(low.sent.messages.length, 1);
});

test("the Zealot's robes save shards one by one, but not the bowl's charges", () => {
  const rolls = Array.from({ length: 100 }, (_, i) => (i < 10 ? 0.01 : 0.99));
  Math.random = () => rolls.shift();
  const player = playerWith([["blessed_bone_shard", 100]], {
    worn: ["shades_prayer_helm", "shades_prayer_top", "shades_prayer_bottom", "shades_prayer_boots"],
    attributes: { [Bowl.CHARGE_ATTRIBUTE]: 400 },
  });
  bowl().Sacrifice({ player });
  assert.equal(player.amountOf(id("blessed_bone_shard")), 10);
  assert.equal(charge(player), 300);
  assert.deepEqual(player.sent.xp, [[core.Skill.PRAYER, 500]], "XP for every shard offered");
  // No robes, no rolls.
  Math.random = () => { throw new Error("rolled without robes"); };
  assert.equal(Bowl._test.savedShards(playerWith([]), 100), 0);
});

test("Check tells the charges left; the bowl's state is saved and sent again at login", () => {
  const player = playerWith([], { attributes: { [Bowl.CHARGE_ATTRIBUTE]: 237, [Bowl.WINE_TYPE_ATTRIBUTE]: 1 } });
  bowl().Check({ player });
  assert.deepEqual(player.sent.messages, ["The libation bowl has enough blessed sunfire wine left to sacrifice 237 more blessed bone shards."]);
  assert.deepEqual(persisted, [[Bowl.CHARGE_ATTRIBUTE, 0], [Bowl.WINE_TYPE_ATTRIBUTE, 0]]);
  logins.forEach((login) => login({ player }));
  assert.equal(player.sent.varbits.get(CHARGE_VARBIT()), 237);
  assert.equal(player.sent.varbits.get(TYPE_VARBIT()), 1);
  const fresh = playerWith([]);
  logins.forEach((login) => login({ player: fresh }));
  assert.equal(fresh.sent.varbits.size, 0, "nothing to send for an empty bowl");
});
