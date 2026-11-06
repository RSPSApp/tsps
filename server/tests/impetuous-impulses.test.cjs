// Run after `yarn build`: node --test tests/impetuous-impulses.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIds } = require("../dist/util/IdEnums");

const plugin = require("../plugins/minigames/ImpetuousImpulses.plugin");
const core = PluginManager.getCoreApi();
const { Skill, Location } = core;
plugin._test.init({ core });

const FIELD = new Location(2427, 4446, 0);
const WHEAT = { getLocation: () => new Location(2566, 4300, 0) };
const PORTAL_DEFINITION = { getInteractions: () => ["Exit", "Investigate", null, null, null] };

function sequence(...values) {
  let index = 0;
  return () => values[index++];
}

function player({ hunter = 17, boost = 0, strength = 1, items = {} } = {}) {
  const attributes = new Map();
  const inventory = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const p = {
    messages: [], moved: [], xp: 0, attributes, location: new Location(2565, 4300, 0),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      contains: (id) => (inventory.get(id) ?? 0) > 0,
      containsNumber: (id) => (inventory.get(id) ?? 0) > 0,
      getFreeSlots: () => 28 - [...inventory.values()].reduce((sum, amount) => sum + amount, 0),
      capacity: () => 28,
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
      deleteNumber: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
    }),
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill === Skill.HUNTER ? hunter : 99),
      getCurrentLevel: (skill) => (skill === Skill.HUNTER ? hunter + boost : skill === Skill.STRENGTH ? strength : 99),
      addExperiences: (_, amount) => { p.xp += amount; },
      addExperience: (skill, amount) => { if (skill === Skill.STRENGTH) p.xp += amount; },
    }),
    sendMessage: (message) => p.messages.push(message),
    getLocation: () => p.location,
    moveTo: (destination) => { p.moved.push(destination); p.location = destination; },
    setLocation: (destination) => { p.location = destination; },
    performAnimation() {},
    varbits: new Map(),
    getPacketSender() {
      const sender = new Proxy({}, {
        get: (_target, name) => (...args) => {
          if (name === "sendVarbit") p.varbits.set(args[0], args[1]);
          return sender;
        },
      });
      return sender;
    },
  };
  return p;
}

test("Hunter 17 gates the crop circle and cannot be boosted into it", () => {
  const weak = player({ hunter: 16, boost: 5 });
  assert.equal(plugin._test.enterCropCircle({ player: weak, object: { getLocation: () => FIELD } }), true);
  assert.match(weak.messages.at(-1), /Hunter level of 17/);
  assert.equal(weak.getAttribute(plugin._test.ENTRY_ATTRIBUTE), undefined);

  const strong = player();
  assert.equal(plugin._test.enterCropCircle({ player: strong, object: { getLocation: () => FIELD } }), false);
  assert.deepEqual(strong.getAttribute(plugin._test.ENTRY_ATTRIBUTE), [2427, 4446, 0]);
});

test("the exit portal returns to the remembered field; otherwise the Zanaris one", () => {
  const defaulted = player();
  plugin._test.moveToField(defaulted);
  assert.deepEqual([defaulted.moved[0].getX(), defaulted.moved[0].getY(), defaulted.moved[0].getZ()], [2427, 4446, 0]);

  const p = player();
  plugin._test.enterCropCircle({ player: p, object: { getLocation: () => FIELD } });
  p.setAttribute(plugin._test.ENTRY_ATTRIBUTE, [3000, 3200, 0]);
  assert.equal(plugin._test.portalOption({ player: p, definition: PORTAL_DEFINITION, clickType: 1 }), true);
  assert.deepEqual([p.moved[0].getX(), p.moved[0].getY(), p.moved[0].getZ()], [3000, 3200, 0]);
  assert.equal(plugin._test.portalOption({ player: p, definition: PORTAL_DEFINITION, clickType: 2 }), true);
  assert.match(p.messages.at(-1), /crop circle/);
});

test("wheat chances interpolate and fast is rolled before medium", () => {
  assert.equal(plugin._test.fastChance(1), 0);
  assert.ok(Math.abs(plugin._test.fastChance(99) - 0.39) < 1e-9);
  assert.ok(Math.abs(plugin._test.mediumChance(1) - 0.04) < 1e-9);
  assert.equal(plugin._test.mediumChance(99), 1);

  assert.equal(plugin._test.rollTier(50, sequence(0.1, 0.9)), plugin._test.TIERS[0]);
  assert.equal(plugin._test.rollTier(50, sequence(0.3, 0.3)), plugin._test.TIERS[1]);
  assert.equal(plugin._test.rollTier(50, sequence(0.9, 0.9)), plugin._test.TIERS[2]);
});

test("a push waits its tier's ticks, moves two tiles and awards no XP", () => {
  const p = player({ strength: 1 });
  assert.equal(plugin._test.pushThrough({ player: p, object: WHEAT, random: () => 0.99 }), true);
  assert.match(p.messages.at(-1), /hard work/);
  assert.equal(plugin._test.pushes.get(p).ticks, 10);

  for (let i = 0; i < 9; i++) plugin._test.process(p);
  assert.equal(p.moved.length, 0);
  plugin._test.process(p);
  assert.equal(p.moved.length, 1);
  assert.deepEqual([p.moved[0].getX(), p.moved[0].getY(), p.moved[0].getZ()], [2567, 4300, 0]);
  assert.equal(p.xp, 0);
});

test("leaving or moving cancels a pending push", () => {
  const leaving = player();
  plugin._test.pushThrough({ player: leaving, object: WHEAT, random: () => 0.99 });
  plugin._test.cancel(leaving);
  plugin._test.process(leaving);
  assert.equal(leaving.moved.length, 0);

  const walking = player();
  plugin._test.pushThrough({ player: walking, object: WHEAT, random: () => 0.99 });
  walking.location = new Location(2565, 4301, 0);
  plugin._test.process(walking);
  assert.equal(plugin._test.pushes.has(walking), false);
  assert.equal(walking.moved.length, 0);
});

test("Elnock's toggle awards the tier's Strength XP once on, and nothing while off", () => {
  // Opted out by default since 1 March 2023: a fast push still moves the player, it just pays nothing.
  const off = player({ strength: 99 });
  assert.equal(plugin._test.xpEnabled(off), false);
  plugin._test.pushThrough({ player: off, object: WHEAT, random: sequence(0, 0) });
  for (let i = 0; i < 6; i++) plugin._test.process(off);
  assert.equal(off.moved.length, 1, "the push still completes with XP off");
  assert.equal(off.xp, 0, "off by default, as since 1 March 2023");

  const fast = player({ strength: 99 });
  plugin._test.setXpEnabled(fast, true);
  plugin._test.pushThrough({ player: fast, object: WHEAT, random: sequence(0, 0) });
  for (let i = 0; i < 6; i++) plugin._test.process(fast);
  assert.equal(fast.xp, 4, "a fast push is 4 XP");

  const medium = player({ strength: 99 });
  plugin._test.setXpEnabled(medium, true);
  plugin._test.pushThrough({ player: medium, object: WHEAT, random: sequence(0.99, 0) });
  for (let i = 0; i < 8; i++) plugin._test.process(medium);
  assert.equal(medium.xp, 2, "a medium push is 2 XP");

  const slow = player({ strength: 1 });
  plugin._test.setXpEnabled(slow, true);
  plugin._test.pushThrough({ player: slow, object: WHEAT, random: sequence(0.99, 0.99) });
  for (let i = 0; i < 10; i++) plugin._test.process(slow);
  assert.equal(slow.xp, 0, "a slow push is worth nothing either way");
});

test("the wheat branch asks the question that matches the current toggle", () => {
  const { wheatCondition, ELNOCK_NPC_ID, WHEAT_ON_CONDITION, WHEAT_OFF_CONDITION } = plugin._test.elnock;
  const p = player();

  // Off by default, so he offers to turn it on.
  assert.equal(wheatCondition({ player: p, npcId: ELNOCK_NPC_ID, text: WHEAT_ON_CONDITION }), false);
  assert.equal(wheatCondition({ player: p, npcId: ELNOCK_NPC_ID, text: WHEAT_OFF_CONDITION }), true);

  plugin._test.setXpEnabled(p, true);
  assert.equal(wheatCondition({ player: p, npcId: ELNOCK_NPC_ID, text: WHEAT_ON_CONDITION }), true);
  assert.equal(wheatCondition({ player: p, npcId: ELNOCK_NPC_ID, text: WHEAT_OFF_CONDITION }), false);

  assert.equal(wheatCondition({ player: p, npcId: 1, text: WHEAT_ON_CONDITION }), null, "another NPC is left alone");
  assert.equal(wheatCondition({ player: p, npcId: ELNOCK_NPC_ID, text: "Something else:" }), null);
});

test("Elnock plays the \"before learning\" transcript until he has taught the player", () => {
  const { variant, onChoice, taught, ELNOCK_NPC_ID, BEFORE_LEARNING, AFTER_LEARNING } = plugin._test.elnock;
  const p = player();

  assert.equal(variant({ player: p, npcId: ELNOCK_NPC_ID }), BEFORE_LEARNING);
  assert.equal(variant({ player: p, npcId: 1 }), null, "another NPC is left alone");

  // Asking how to catch them is what moves him on; the wheat branch only exists in the later text.
  onChoice({ player: p, npcId: ELNOCK_NPC_ID, option: "So what are these implings?" });
  assert.equal(taught(p), false, "an unrelated choice teaches nothing");
  assert.equal(variant({ player: p, npcId: ELNOCK_NPC_ID }), BEFORE_LEARNING);

  onChoice({ player: p, npcId: ELNOCK_NPC_ID, option: "Can I catch these implings then?" });
  assert.equal(taught(p), true);
  assert.equal(variant({ player: p, npcId: ELNOCK_NPC_ID }), AFTER_LEARNING);
});

test("the wheat branch is reachable only after he has taught the player", () => {
  // The transcript that contains the wheat option is the "after learning" one, so this guards the
  // path that makes the toggle reachable at all.
  const dialogs = require("../data/definitions/npc-dialogues.json");
  const el = dialogs["Elnock Inquisitor"];
  const { BEFORE_LEARNING, AFTER_LEARNING } = plugin._test.elnock;
  const hasWheat = (name) => JSON.stringify(el.variants[name]).includes("Can you tell me about the wheat?");

  assert.equal(el.default, BEFORE_LEARNING, "his default transcript is the pre-learning one");
  assert.equal(hasWheat(BEFORE_LEARNING), false, "the pre-learning text has no wheat branch");
  assert.equal(hasWheat(AFTER_LEARNING), true, "the wheat branch lives in the post-learning text");
});

test("the scroll question is answered from the inventory, or he offers one forever", () => {
  const { wheatCondition, ELNOCK_NPC_ID } = plugin._test.elnock;
  const text = "If the player has an Impling scroll in their inventory:";
  const withScroll = player({ items: { [core.ItemIdentifiers.IMPLING_SCROLL]: 1 } });
  const without = player();

  // The transcript's wording is inverted: these steps are what he says to someone WITHOUT one, so
  // the branch has to answer "no scroll" for the offer to play and "has scroll" to fall through to
  // his six-option menu.
  assert.equal(wheatCondition({ player: withScroll, npcId: ELNOCK_NPC_ID, text }), false,
    "holding the scroll skips the offer and reaches his menu");
  assert.equal(wheatCondition({ player: without, npcId: ELNOCK_NPC_ID, text }), true,
    "without one he offers it");
});

test("accepting the scroll offer actually hands one over", () => {
  const { wheatAction, ELNOCK_NPC_ID, SCROLL_STEP } = plugin._test.elnock;
  const p = player();
  const scroll = core.ItemIdentifiers.IMPLING_SCROLL;
  assert.equal(p.getInventory().getAmount(scroll), 0);

  const event = { player: p, npcId: ELNOCK_NPC_ID, stepId: SCROLL_STEP };
  wheatAction(event);
  assert.equal(event.handled, true);
  assert.equal(p.getInventory().getAmount(scroll), 1, "the narration alone gave nothing before");
  // Handled steps stop the engine sending their own line, so the plugin has to say it.
  assert.match(p.messages.at(-1), /gives you a scroll/);
});

test("the export's textless prompt marker no longer ends the wheat branch", () => {
  // The bare "Turn wheat Strengh XP ON?" line came out of the export as an `unavailable` marker,
  // which ends playback. Handling it continues the branch, so the Yes/No behind it still plays.
  const { wheatAction, ELNOCK_NPC_ID, PROMPT_GAP_STEP } = plugin._test.elnock;
  const event = { player: player(), npcId: ELNOCK_NPC_ID, stepId: PROMPT_GAP_STEP };
  wheatAction(event);
  assert.equal(event.handled, true, "handled carries on with the rest of the branch");
  assert.equal(event.end, undefined, "and must not close the dialogue");
});

test("confirming either wheat outcome sets the toggle", () => {
  const { wheatAction, ELNOCK_NPC_ID, WHEAT_XP_ON_STEP, WHEAT_XP_OFF_STEP } = plugin._test.elnock;
  const p = player();

  const on = { player: p, npcId: ELNOCK_NPC_ID, stepId: WHEAT_XP_ON_STEP };
  wheatAction(on);
  assert.equal(plugin._test.xpEnabled(p), true);
  assert.equal(on.handled, true);

  const off = { player: p, npcId: ELNOCK_NPC_ID, stepId: WHEAT_XP_OFF_STEP };
  wheatAction(off);
  assert.equal(plugin._test.xpEnabled(p), false);
  assert.equal(off.handled, true);

  const other = { player: p, npcId: ELNOCK_NPC_ID, stepId: "not-a-step" };
  wheatAction(other);
  assert.equal(other.handled, undefined, "an unrelated step is left for its own handler");
});

test("Elnock's gift is once per account and needs room", () => {
  const p = player();
  assert.equal(plugin._test.gift(p), true);
  assert.equal(p.getInventory().getAmount(ItemIds.BUTTERFLY_NET), 1);
  assert.equal(p.getInventory().getAmount(ItemIds.IMPLING_JAR), 7);
  assert.equal(p.getInventory().getAmount(ItemIds.IMPLING_SCROLL), 1);
  assert.equal(p.getAttribute(plugin._test.GIFT_ATTRIBUTE), true);
  assert.equal(plugin._test.gift(p), false);
  assert.equal(p.getInventory().getAmount(ItemIds.IMPLING_JAR), 7);

  const full = player({ items: { [ItemIds.BABY_IMPLING_JAR]: 25 } });
  assert.equal(plugin._test.gift(full), false);
  assert.equal(full.getAttribute(plugin._test.GIFT_ATTRIBUTE), undefined);
  assert.equal(full.getInventory().getAmount(ItemIds.BUTTERFLY_NET), 0);
});

test("each Elnock offer takes any one of its three jar stacks (cache enum 2752)", () => {
  const jars = player({ items: { [ItemIds.NINJA_IMPLING_JAR]: 1 } });
  assert.equal(plugin._test.trade(jars, "jars"), true, "one jar of any impling");
  assert.equal(jars.getInventory().getAmount(ItemIds.NINJA_IMPLING_JAR), 0);
  assert.equal(jars.getInventory().getAmount(ItemIds.IMPLING_JAR), 3);

  const young = player({ items: { [ItemIds.YOUNG_IMPLING_JAR]: 2, [ItemIds.BABY_IMPLING_JAR]: 1 } });
  assert.equal(plugin._test.trade(young, "repellent"), true, "two young pay without any gourmet");
  assert.equal(young.getInventory().getAmount(ItemIds.IMP_REPELLENT), 1);
  assert.equal(young.getInventory().getAmount(ItemIds.YOUNG_IMPLING_JAR), 0);
  assert.equal(young.getInventory().getAmount(ItemIds.BABY_IMPLING_JAR), 1, "the short baby stack is left");

  const all = player({ items: {
    [ItemIds.GOURMET_IMPLING_JAR]: 3, [ItemIds.EARTH_IMPLING_JAR]: 2, [ItemIds.ESSENCE_IMPLING_JAR]: 1,
  } });
  assert.equal(plugin._test.trade(all, "net"), true);
  assert.equal(all.getInventory().getAmount(ItemIds.MAGIC_BUTTERFLY_NET), 1);
  assert.equal(all.getInventory().getAmount(ItemIds.GOURMET_IMPLING_JAR), 0, "only the first full stack is paid");
  assert.equal(all.getInventory().getAmount(ItemIds.EARTH_IMPLING_JAR), 2);
  assert.equal(all.getInventory().getAmount(ItemIds.ESSENCE_IMPLING_JAR), 1);

  const nature = player({ items: { [ItemIds.NATURE_IMPLING_JAR]: 1 } });
  assert.equal(plugin._test.trade(nature, "generator"), true);
  assert.equal(nature.getInventory().getAmount(ItemIds.JAR_GENERATOR), 1);
});

test("a failed trade consumes nothing", () => {
  const p = player({ items: { [ItemIds.GOURMET_IMPLING_JAR]: 2, [ItemIds.EARTH_IMPLING_JAR]: 1 } });
  assert.equal(plugin._test.trade(p, "net"), false);
  assert.equal(p.getInventory().getAmount(ItemIds.GOURMET_IMPLING_JAR), 2);
  assert.equal(p.getInventory().getAmount(ItemIds.EARTH_IMPLING_JAR), 1);
  assert.equal(p.messages.at(-1), "You don't have the required implings in jars to trade for this.");

  const noJars = player();
  assert.equal(plugin._test.trade(noJars, "jars"), false);
});

test("Elnock's Exchange: a shop_frame slot selects ii_elnex, Confirm trades it", () => {
  const elnock = plugin._test.elnock;
  const p = player({ items: { [ItemIds.ESSENCE_IMPLING_JAR]: 1 } });
  elnock.openExchange({ player: p });
  assert.equal(p.varbits.get(elnock.SELECTED_VARBIT), 0);
  elnock.selectOffer({ player: p, slot: 6 });
  assert.equal(p.varbits.get(elnock.SELECTED_VARBIT), 3, "captured: slot 6 -> 3");
  elnock.confirmOffer({ player: p });
  assert.equal(p.getInventory().getAmount(ItemIds.JAR_GENERATOR), 0, "slot 6 is the third offer, not the net");
  elnock.selectOffer({ player: p, slot: 3 });
  elnock.confirmOffer({ player: p });
  assert.equal(p.getInventory().getAmount(ItemIds.MAGIC_BUTTERFLY_NET), 1, "slot 3: the net, for one essence");

  elnock.selectOffer({ player: p, slot: 4 });
  assert.equal(p.varbits.get(elnock.SELECTED_VARBIT), 2, "only the offers' own slots select");
});


test("Puro-Puro roaming implings start invisible, show after two minutes and are replaced when caught", () => {
  const roaming = plugin._test.roaming;
  const spawns = [], removed = [];
  roaming.init({ core, spawnNpc: (def) => { const npc = { def, setVisible(v) { npc.visible = v; } }; spawns.push(npc); return npc; }, removeNpc: (npc) => removed.push(npc) });
  roaming.start();
  assert.equal(spawns.length, 26, "10 low, 12 mid and 4 high points from the cache");
  assert.ok(spawns.every((n) => n.visible === false));
  for (let i = 0; i < roaming.MANIFEST_TICKS; i++) roaming.process();
  assert.ok(spawns.every((n) => n.visible === true));
  const event = { npc: spawns[0], handled: false };
  roaming.caught(event);
  assert.equal(event.handled, true);
  for (let i = 0; i < roaming.CAUGHT_TICKS; i++) roaming.process();
  assert.deepEqual(removed, [spawns[0]]);
  assert.equal(spawns.length, 27, "respawns at once");
  assert.deepEqual([spawns[26].def.x, spawns[26].def.y], [spawns[0].def.x, spawns[0].def.y]);
  assert.equal(spawns[26].visible, false);
  roaming.shutdown();
  assert.equal(roaming.live.size, 0);
});
