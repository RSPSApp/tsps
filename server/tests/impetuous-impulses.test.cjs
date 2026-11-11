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
    getEquipment: () => ({ getItems: () => [] }),
    getBanks: () => [],
    getInventory: () => ({
      getItems: () => [...inventory].map(([id, amount]) => new core.Item(id, amount)),
      refreshItems() {},
      deleteAtSlot: (slot, amount) => { const [id, held] = [...inventory][slot]; inventory.set(id, held - amount); },
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

test("Elnock equipment exchanges require and consume all three jar stacks", () => {
  const offers = [
    ["repellent", [[ItemIds.BABY_IMPLING_JAR, 3], [ItemIds.YOUNG_IMPLING_JAR, 2], [ItemIds.GOURMET_IMPLING_JAR, 1]], ItemIds.IMP_REPELLENT],
    ["net", [[ItemIds.GOURMET_IMPLING_JAR, 3], [ItemIds.EARTH_IMPLING_JAR, 2], [ItemIds.ESSENCE_IMPLING_JAR, 1]], ItemIds.MAGIC_BUTTERFLY_NET],
    ["generator", [[ItemIds.ESSENCE_IMPLING_JAR, 3], [ItemIds.ECLECTIC_IMPLING_JAR, 2], [ItemIds.NATURE_IMPLING_JAR, 1]], ItemIds.JAR_GENERATOR],
  ];
  for (const [key, payment, reward] of offers) {
    for (const [shortId, count] of payment) {
      const items = Object.fromEntries(payment);
      items[shortId] = count - 1;
      const p = player({ items });
      assert.equal(plugin._test.trade(p, key), false, `${key}: each ingredient must be sufficient`);
      for (const [id, amount] of Object.entries(items)) assert.equal(p.getInventory().getAmount(Number(id)), amount, "refusal preserves every input");
      assert.equal(p.getInventory().getAmount(reward), 0);
    }
    const items = Object.fromEntries(payment.map(([id, amount]) => [id, amount + 1]));
    const p = player({ items });
    assert.equal(plugin._test.trade(p, key), true);
    for (const [id] of payment) assert.equal(p.getInventory().getAmount(id), 1, "exact payment leaves each surplus");
    assert.equal(p.getInventory().getAmount(reward), 1);
    assert.equal(plugin._test.trade(p, key), false, "remaining surplus cannot buy another reward");
    assert.equal(p.getInventory().getAmount(reward), 1);
  }
});

test("Elnock's ordinary jar offer still takes one jar of any impling", () => {
  const p = player({ items: { [ItemIds.NINJA_IMPLING_JAR]: 1 } });
  assert.equal(plugin._test.trade(p, "jars"), true);
  assert.equal(p.getInventory().getAmount(ItemIds.NINJA_IMPLING_JAR), 0);
  assert.equal(p.getInventory().getAmount(ItemIds.IMPLING_JAR), 3);
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
  const p = player({ items: { [ItemIds.GOURMET_IMPLING_JAR]: 3, [ItemIds.EARTH_IMPLING_JAR]: 2, [ItemIds.ESSENCE_IMPLING_JAR]: 1 } });
  elnock.openExchange({ player: p });
  assert.equal(p.varbits.get(elnock.SELECTED_VARBIT), 0);
  elnock.selectOffer({ player: p, slot: 6 });
  assert.equal(p.varbits.get(elnock.SELECTED_VARBIT), 3, "captured: slot 6 -> 3");
  elnock.confirmOffer({ player: p });
  assert.equal(p.getInventory().getAmount(ItemIds.JAR_GENERATOR), 0, "slot 6 is the third offer, not the net");
  elnock.selectOffer({ player: p, slot: 3 });
  elnock.confirmOffer({ player: p });
  assert.equal(p.getInventory().getAmount(ItemIds.MAGIC_BUTTERFLY_NET), 1, "slot 3: the net, for the complete payment");

  elnock.selectOffer({ player: p, slot: 4 });
  assert.equal(p.varbits.get(elnock.SELECTED_VARBIT), 2, "only the offers' own slots select");
});


test("Puro-Puro roaming implings start invisible, show after two minutes and are replaced when caught", (t) => {
  const roaming = plugin._test.roaming;
  const spawns = [], removed = [];
  roaming.init({ core, spawnNpc: (def) => { const npc = { def, flags: new Map(), getId: () => def.id,
    getSpawnPosition: () => new Location(def.x, def.y, def.z),
    getMovementCoordinator: () => ({ getRadius: () => def.wanderRadius, setRadius: radius => { def.wanderRadius = radius; } }),
    setFlag(key, value) { this.flags.set(key, value); }, setVisible(v) { npc.visible = v; } };
    // Unit API supplies the entity-added callback; native cases below use World.add.
    roaming.configureFlight({ npc }); spawns.push(npc); return npc; }, removeNpc: (npc) => removed.push(npc) });
  roaming.start();
  t.after(() => roaming.shutdown());
  assert.equal(spawns.length, 24, "Wiki embedded map: 10 low, 12 mid and 2 high points");
  assert.ok(spawns.every(n => n.flags.get("movement:ignore-clipping") === true));
  for (const n of spawns) {
    const [minX, maxX, minY, maxY] = roaming.MAZE_BOUNDS;
    assert.ok(n.def.x - n.def.wanderRadius >= minX && n.def.x + n.def.wanderRadius <= maxX);
    assert.ok(n.def.y - n.def.wanderRadius >= minY && n.def.y + n.def.wanderRadius <= maxY);
  }
  assert.ok(spawns.every((n) => n.visible === false));
  for (let i = 0; i < roaming.MANIFEST_TICKS; i++) roaming.process();
  assert.ok(spawns.every((n) => n.visible === true));
  const event = { npc: spawns[0], handled: false };
  roaming.caught(event);
  assert.equal(event.handled, true);
  for (let i = 0; i < roaming.CAUGHT_TICKS; i++) roaming.process();
  assert.deepEqual(removed, [spawns[0]]);
  assert.equal(spawns.length, 25, "the caught point receives exactly one replacement");
  assert.deepEqual([spawns[24].def.x, spawns[24].def.y], [spawns[0].def.x, spawns[0].def.y]);
  assert.equal(spawns[24].visible, false);
  roaming.shutdown();
  assert.equal(roaming.live.size, 0);
});

test("Puro-Puro roaming network uses mapped points, crosses cache wheat and replaces a catch", async (t) => {
  // Existing unit cases above use supplied APIs. This last case starts the actual plugin/task route.
  await core.CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(require("node:path").resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2592, 4320);
  PluginManager.emitServerStartup({});
  t.after(() => PluginManager.emitServerShutdown({}));
  const roaming = require("../plugins/minigames/impetuousimpulses/Roaming.ImpetuousImpulses");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { PathFinder } = require("../dist/game/model/movement/path/PathFinder");
  const { NPCOptionPacketListener } = require("../dist/net/packet/impl/NPCOptionPacketListener");
  const I = core.ItemIdentifiers;
  let index = 19200;
  function actor(test) {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
      close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel));
    p.setIndex(index++); p.setUsername("puroroam" + p.getIndex()); p.setRegistered(true);
    p.setNeedsPlacement(false); p.setHitpoints(99); p.setAttribute("bot-skip-persistence", true);
    test.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
    return p;
  }
  const inRealm = (at) => at.getZ() === 0 && at.getX() >= 2560 && at.getX() <= 2623
    && at.getY() >= 4288 && at.getY() <= 4351;
  assert.ok(roaming.live.size > 0);
  assert.ok([...roaming.live.keys()].every(npc => !npc.isVisible()));
  for (let tick = 0; tick < 199; tick++) core.TaskManager.process();
  assert.ok([...roaming.live.keys()].every(npc => !npc.isVisible()));
  core.TaskManager.process();
  assert.ok([...roaming.live.keys()].every(npc => npc.isVisible()), "registered task completes manifestation");

  await t.test("the primary Wiki map gives two high-tier points and bounded ordinary wandering", () => {
    assert.equal(roaming.live.size, 24);
    const high = [...roaming.live.values()].filter(state => state.tier === "high").map(state => state.point).sort();
    assert.deepEqual(high, [[2576, 4336], [2610, 4301]]);
    for (const npc of roaming.live.keys()) {
      const at = npc.getSpawnPosition(), radius = npc.getMovementCoordinator().getRadius();
      assert.ok(inRealm(at.transform(-radius, -radius)) && inRealm(at.transform(radius, radius)));
    }
  });

  const scout = actor(t);
  let crossing;
  for (const objects of core.MapObjects.mapObjects.values()) {
    for (const object of objects) {
      const at = object.getLocation();
      if (!inRealm(at) || core.ObjectDefinition.forPlayer(object.getId(), scout)?.getName() !== "Magical wheat") continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const from = at.transform(dx, dy);
        if (inRealm(from) && !core.RegionManager.blocked(from, null)
          && !core.RegionManager.canMovestart(from, at, 1, 1, null)) {
          crossing = { object, from, target: at }; break;
        }
      }
      if (crossing) break;
    }
    if (crossing) break;
  }
  assert.ok(crossing, "active cache must provide an actual clipped magical-wheat edge");
  let flightNpc;
  await t.test("a real roaming impling crosses clipped wheat while a player and normal NPC do not", (sub) => {
    const p = actor(sub), { from, target } = crossing;
    p.setLocation(from.clone());
    const ordinary = core.NPC.create(core.NpcIdentifiers.MAN, from.clone());
    ordinary.setRegistered(true); ordinary.setNeedsPlacement(false);
    sub.after(() => ordinary.setRegistered(false));
    for (const mobile of [p, ordinary]) {
      assert.equal(mobile.hasFlag("movement:ignore-clipping"), false);
      const queue = mobile.getMovementQueue();
      queue.addCheckpoint(target); queue.process();
      assert.ok(mobile.getLocation().equals(from), "ordinary actors retain actual wheat collision");
    }
    flightNpc = [...roaming.live.keys()][0];
    flightNpc.setLocation(from.clone()); flightNpc.setNeedsPlacement(false);
    flightNpc.getMovementQueue().addCheckpoint(target);
    flightNpc.getMovementQueue().process();
    console.log("puro-roaming-motion", JSON.stringify({ wheatId: crossing.object.getId(),
      from: [from.getX(), from.getY()], target: [target.getX(), target.getY()],
      playerBlocked: p.getLocation().equals(from), npcBlocked: ordinary.getLocation().equals(from),
      implingCrossed: flightNpc.getLocation().equals(target) }));
    assert.ok(flightNpc.getLocation().equals(target), "the roaming impling crosses actual cache wheat");
  });

  await t.test("ordinary Catch reaches the roaming owner and completes removal and manifestation tasks", (sub) => {
    const p = actor(sub);
    const npc = [...roaming.live.keys()].find(npc => npc !== flightNpc);
    assert.ok(npc);
    const originalPoint = [...roaming.live.get(npc).point];
    const count = roaming.live.size;
    // Actor location/levels, NPC approach and successful RNG are supplied, not natural travel.
    npc.setLocation(crossing.from.clone()); npc.setNeedsPlacement(false);
    let reached = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      p.setLocation(npc.getLocation().transform(dx, dy));
      if (inRealm(p.getLocation()) && !core.RegionManager.blocked(p.getLocation(), null)
        && PathFinder.reachedEntity(p, npc)) { reached = true; break; }
    }
    assert.ok(reached, "the seeded approach must satisfy the real adjacent-reach predicate");
    p.getSkillManager().setMaxLevel(core.Skill.HUNTER, 99).setCurrentLevels(core.Skill.HUNTER, 99);
    p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.BUTTERFLY_NET, 1));
    p.getInventory().adds(I.IMPLING_JAR, 2);
    const definition = npc.getCurrentDefinition(p);
    const option = definition.getActions().findIndex(action => action === "Catch") + 1;
    assert.ok(option > 0); assert.equal(p.busy(), false);
    const rng = sub.mock.method(Math, "random", () => 0);
    new NPCOptionPacketListener().executeOption(p, npc.getIndex(), option);
    assert.equal(p.getInventory().getAmount(I.IMPLING_JAR), 1);
    const filled = [I.BABY_IMPLING_JAR, I.YOUNG_IMPLING_JAR, I.GOURMET_IMPLING_JAR, I.EARTH_IMPLING_JAR,
      I.ESSENCE_IMPLING_JAR, I.ECLECTIC_IMPLING_JAR, I.NATURE_IMPLING_JAR, I.MAGPIE_IMPLING_JAR,
      I.NINJA_IMPLING_JAR, I.DRAGON_IMPLING_JAR, I.LUCKY_IMPLING_JAR];
    assert.equal(filled.reduce((sum, id) => sum + p.getInventory().getAmount(id), 0), 1);
    assert.ok(roaming.live.get(npc).removeAt > 0, "registered catch event gives removal to the roaming controller");
    new NPCOptionPacketListener().executeOption(p, npc.getIndex(), option);
    rng.mock.restore();
    assert.equal(p.getInventory().getAmount(I.IMPLING_JAR), 1, "a repeated Catch cannot consume another jar");
    assert.equal(filled.reduce((sum, id) => sum + p.getInventory().getAmount(id), 0), 1);
    assert.equal(roaming.live.size, count, "repeat click does not create another replacement");
    core.TaskManager.process(); assert.ok(roaming.live.has(npc));
    core.TaskManager.process(); assert.equal(roaming.live.has(npc), false);
    assert.equal(npc.isRegistered(), false);
    assert.equal(roaming.live.size, count, "exactly one replacement preserves network size");
    const replacement = [...roaming.live].find(([candidate, state]) => candidate !== npc
      && state.point[0] === originalPoint[0] && state.point[1] === originalPoint[1])[0];
    assert.equal(replacement.isVisible(), false);
    assert.equal(replacement.hasFlag("movement:ignore-clipping"), true);
    assert.ok(replacement.getSpawnPosition().equals(new core.Location(...originalPoint, 0)));
    const radius = replacement.getMovementCoordinator().getRadius();
    assert.ok(inRealm(replacement.getSpawnPosition().transform(-radius, -radius))
      && inRealm(replacement.getSpawnPosition().transform(radius, radius)));
    // Supply the same reachable approach; only the replacement's hidden state changes.
    replacement.setLocation(crossing.from.clone()); replacement.setNeedsPlacement(false);
    assert.ok(PathFinder.reachedEntity(p, replacement));
    const hiddenOption = replacement.getCurrentDefinition(p).getActions().findIndex(action => action === "Catch") + 1;
    assert.ok(hiddenOption > 0);
    new NPCOptionPacketListener().executeOption(p, replacement.getIndex(), hiddenOption);
    assert.equal(p.getInventory().getAmount(I.IMPLING_JAR), 1, "pre-manifest Catch preserves the empty jar");
    assert.equal(filled.reduce((sum, id) => sum + p.getInventory().getAmount(id), 0), 1);
    assert.equal(roaming.live.get(replacement).removeAt, 0);
    assert.equal(roaming.live.size, count);
    replacement.setLocation(replacement.getSpawnPosition().clone());
    for (let tick = 0; tick < 199; tick++) core.TaskManager.process();
    assert.equal(replacement.isVisible(), false);
    core.TaskManager.process(); assert.equal(replacement.isVisible(), true);
  });
});

test("Puro-Puro fixed implings use world spawns, cross wheat and return after a catch", async (t) => {
  await core.CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(require("node:path").resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2592, 4320);
  t.after(() => PluginManager.emitServerShutdown({}));
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { PathFinder } = require("../dist/game/model/movement/path/PathFinder");
  const { NPCOptionPacketListener } = require("../dist/net/packet/impl/NPCOptionPacketListener");
  const roaming = require("../plugins/minigames/impetuousimpulses/Roaming.ImpetuousImpulses");
  const N = core.NpcIdentifiers, I = core.ItemIdentifiers;
  const fixedIds = new Set([N.BABY_IMPLING_2, N.YOUNG_IMPLING_2, N.GOURMET_IMPLING_2,
    N.EARTH_IMPLING_2, N.ESSENCE_IMPLING_2, N.ECLECTIC_IMPLING_2]);
  const inRealm = at => at.getZ() === 0 && at.getX() >= 2560 && at.getX() <= 2623
    && at.getY() >= 4288 && at.getY() <= 4351;
  let index = 19300;
  function actor(sub) {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
      close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel));
    p.setIndex(index++); p.setUsername("purofixed" + p.getIndex()); p.setRegistered(true);
    p.setNeedsPlacement(false); p.setHitpoints(99); p.setAttribute("bot-skip-persistence", true);
    sub.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
    return p;
  }
  // Same producer as ordinary world entry: definitions load into pending regions, then activate nearby.
  assert.equal(new core.NpcSpawnDefinitionLoader().load(), true);
  PluginManager.emitServerStartup({});
  core.NpcSpawnDefinitionLoader.activateNear(new core.Location(2592, 4320, 0));
  const worldSpawns = [...core.World.getNpcs()].filter(npc =>
    npc?.getSpawnLineage()?.owner === core.NpcSpawnDefinitionLoader.LINEAGE_OWNER);
  const lineages = new Set(worldSpawns.map(npc => npc.getSpawnLineage()));
  t.after(() => { for (const lineage of lineages) lineage.retire(); });
  const fixed = worldSpawns.filter(npc => inRealm(npc.getSpawnPosition()) && fixedIds.has(npc.getId()));
  assert.equal(fixed.length, 51, "actual world definitions supply the Wiki's fixed population");
  const unchangedCount = () => [...core.World.getNpcs()].filter(npc => npc && fixed.includes(npc)).length;
  const scout = actor(t);
  let crossing;
  const wallRecords = [];
  for (const objects of core.MapObjects.mapObjects.values()) {
    for (const object of objects) {
      const at = object.getLocation();
      if (!inRealm(at)) continue;
      if (object.getType() >= 0 && object.getType() <= 3) {
        const definition = core.ObjectDefinition.forPlayer(object.getId(), scout);
        wallRecords.push({ id: object.getId(), name: definition?.getName(), type: object.getType(),
          face: object.getFace(), position: [at.getX(), at.getY(), at.getZ()], solid: definition?.isSolid(),
          nearFixedWanderSquare: fixed.some(npc => {
            const home = npc.getSpawnPosition(), radius = npc.getMovementCoordinator().getRadius();
            return Math.abs(home.getX() - at.getX()) <= radius + 1 && Math.abs(home.getY() - at.getY()) <= radius + 1;
          }) });
      }
      if (crossing || core.ObjectDefinition.forPlayer(object.getId(), scout)?.getName() !== "Magical wheat") continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const from = at.transform(dx, dy);
        if (inRealm(from) && !core.RegionManager.blocked(from, null)
          && !core.RegionManager.canMovestart(from, at, 1, 1, null)) {
          crossing = { object, from, target: at }; break;
        }
      }
    }
  }
  assert.ok(crossing, "the active cache supplies an actual clipped wheat edge");
  console.log("puro-fixed-map-walls", JSON.stringify(wallRecords));

  await t.test("all fixed spawns fly with ordinary wander targets contained inside the realm", () => {
    const outOfBounds = fixed.filter(npc => {
      const at = npc.getSpawnPosition(), radius = npc.getMovementCoordinator().getRadius();
      return !inRealm(at.transform(-radius, -radius)) || !inRealm(at.transform(radius, radius));
    });
    console.log("puro-fixed-population", JSON.stringify({ count: fixed.length,
      minRadius: Math.min(...fixed.map(npc => npc.getMovementCoordinator().getRadius())),
      outOfBounds: outOfBounds.length }));
    assert.ok(fixed.every(npc => npc.hasFlag("movement:ignore-clipping")));
    assert.equal(outOfBounds.length, 0);
    assert.ok(worldSpawns.filter(npc => inRealm(npc.getSpawnPosition()) && !fixedIds.has(npc.getId()))
      .every(npc => !npc.hasFlag("movement:ignore-clipping")), "other world-spawned realm NPCs keep collision");
    assert.ok(fixed.every(npc => npc.getMovementCoordinator().getRadius() <= 5), "no wander radius grows");
  });

  await t.test("a world-spawned impling crosses cache wheat while ordinary actors remain clipped", sub => {
    const { from, target } = crossing;
    const p = actor(sub); p.setLocation(from.clone());
    const ordinary = core.NPC.create(N.MAN, from.clone());
    assert.equal(core.World.getNpcs().add(ordinary), true);
    ordinary.setNeedsPlacement(false);
    sub.after(() => core.World.getNpcs().remove(ordinary));
    const overworld = core.NPC.create(N.BABY_IMPLING_2, new core.Location(3000, 3200, 0));
    assert.equal(core.World.getNpcs().add(overworld), true);
    sub.after(() => core.World.getNpcs().remove(overworld));
    assert.equal(overworld.hasFlag("movement:ignore-clipping"), false, "other realms are not opted in");
    for (const mobile of [p, ordinary]) {
      assert.equal(mobile.hasFlag("movement:ignore-clipping"), false);
      mobile.getMovementQueue().addCheckpoint(target); mobile.getMovementQueue().process();
      assert.ok(mobile.getLocation().equals(from));
    }
    const npc = fixed.find(npc => npc.getId() === N.GOURMET_IMPLING_2);
    npc.setLocation(from.clone()); npc.setNeedsPlacement(false);
    npc.getMovementQueue().addCheckpoint(target); npc.getMovementQueue().process();
    console.log("puro-fixed-motion", JSON.stringify({ wheatId: crossing.object.getId(),
      from: [from.getX(), from.getY()], target: [target.getX(), target.getY()],
      playerBlocked: p.getLocation().equals(from), npcBlocked: ordinary.getLocation().equals(from),
      implingCrossed: npc.getLocation().equals(target) }));
    assert.ok(npc.getLocation().equals(target));
  });

  for (const [label, npcId, jarId, respawnTicks] of [
    ["baby", N.BABY_IMPLING_2, I.BABY_IMPLING_JAR, 7],
    ["earth", N.EARTH_IMPLING_2, I.EARTH_IMPLING_JAR, 50],
  ]) await t.test(`${label}: packet Catch, conservation and ${respawnTicks}-tick return permit another ordinary catch`, sub => {
    const p = actor(sub), npc = fixed.find(npc => npc.getId() === npcId), home = npc.getSpawnPosition().clone();
    const radiusBefore = npc.getMovementCoordinator().getRadius();
    assert.equal(npc.getMovementQueue().isMovementBlocked(), false);
    npc.setLocation(crossing.from.clone()); npc.setNeedsPlacement(false);
    let reached = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      p.setLocation(npc.getLocation().transform(dx, dy));
      if (inRealm(p.getLocation()) && !core.RegionManager.blocked(p.getLocation(), null)
        && PathFinder.reachedEntity(p, npc)) { reached = true; break; }
    }
    assert.ok(reached, "supplied approach satisfies the real reach predicate");
    p.getSkillManager().setMaxLevel(core.Skill.HUNTER, 99).setCurrentLevels(core.Skill.HUNTER, 99);
    p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.BUTTERFLY_NET, 1));
    p.getInventory().adds(I.IMPLING_JAR, 2);
    const option = npc.getCurrentDefinition(p).getActions().findIndex(action => action === "Catch") + 1;
    assert.ok(option > 0); assert.equal(p.busy(), false);
    const rng = sub.mock.method(Math, "random", () => 0);
    const click = () => new NPCOptionPacketListener().executeOption(p, npc.getIndex(), option);
    click(); click();
    assert.equal(p.getInventory().getAmount(I.IMPLING_JAR), 1);
    assert.equal(p.getInventory().getAmount(jarId), 1);
    assert.equal(roaming.live.has(npc), false, "fixed returns stay owned by Hunter, not the roaming controller");
    core.TaskManager.process(); assert.equal(npc.isVisible(), true);
    core.TaskManager.process(); assert.equal(npc.isVisible(), false);
    click();
    assert.equal(p.getInventory().getAmount(I.IMPLING_JAR), 1, "hidden Catch does not use a jar");
    for (let tick = 0; tick < respawnTicks - 1; tick++) core.TaskManager.process();
    assert.equal(npc.isVisible(), false);
    core.TaskManager.process();
    assert.equal(npc.isVisible(), true);
    assert.equal(npc.untargetable === true, false);
    assert.ok(npc.getLocation().equals(home));
    assert.equal(npc.getMovementQueue().isMovementBlocked(), false, "return restores ordinary movement");
    assert.equal(npc.getMovementCoordinator().getRadius(), radiusBefore, "return preserves capped radius");
    assert.equal(unchangedCount(), 51, "returns preserve exactly the original fixed actors");
    // Supply the next reachable approach to its restored home; no travel/client claim.
    let homeReached = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      p.setLocation(home.transform(dx, dy));
      if (inRealm(p.getLocation()) && !core.RegionManager.blocked(p.getLocation(), null)
        && PathFinder.reachedEntity(p, npc)) { homeReached = true; break; }
    }
    assert.ok(homeReached, "the restored home has a real reachable approach");
    click();
    assert.equal(p.getInventory().getAmount(I.IMPLING_JAR), 0);
    assert.equal(p.getInventory().getAmount(jarId), 2);
    rng.mock.restore();
    for (let tick = 0; tick < respawnTicks + 2; tick++) core.TaskManager.process();
    assert.equal(npc.isVisible(), true);
    assert.ok(npc.getLocation().equals(home));
    assert.equal(npc.getMovementQueue().isMovementBlocked(), false, "return restores ordinary movement");
    assert.equal(npc.getMovementCoordinator().getRadius(), radiusBefore, "return preserves capped radius");
    assert.equal(npc.hasFlag("movement:ignore-clipping"), true, "flight survives the fixed return path");
    assert.equal(unchangedCount(), 51);
  });
});
