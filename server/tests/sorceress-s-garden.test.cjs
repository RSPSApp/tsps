// Run after `yarn build`: node --test tests/sorceress-s-garden.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const plugin = require("../plugins/minigames/SorceresssGarden.plugin");

const core = PluginManager.getCoreApi();
plugin._test.setCore(core);

const WINTER_FRUIT = 10847;
const WINTER_JUICE = 10851;
const WINTER_TREE = 13407;
const SPRING_TREE = 13405;
const SUMMER_GATE = 11987;
const FOUNTAIN = 12941;
const PESTLE = 233;
const BEER_GLASS = 1919;

let questComplete = true;
plugin._test.setApi({
  emitCustomEvent(name, request) {
    if (name === "quest:is-complete") request.complete = questComplete;
  },
  // The Apprentice's cast is delayed; here it lands at once.
  getTaskManager: () => ({ submit: (task) => task.execute() }),
});

beforeEach(() => {
  questComplete = true;
});

function player({ level = 99, items = {}, name = "tester" } = {}) {
  const attributes = new Map();
  const inventory = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const p = {
    messages: [],
    xp: [],
    moves: [],
    builder: null,
    inventory,
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      contains: (id) => (inventory.get(id) ?? 0) > 0,
      delete: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
      refreshItems: () => {},
    }),
    getSkillManager: () => ({
      getCurrentLevel: () => level,
      addExperiences: (skill, amount) => p.xp.push([skill, amount]),
    }),
    getDialogueManager: () => ({
      startDialogues: (builder) => {
        p.builder = builder;
      },
    }),
    getPacketSender() {
      const sender = new Proxy({}, { get: () => () => sender });
      return sender;
    },
    sendMessage: (message) => p.messages.push(message),
    moveTo: (location) => p.moves.push(location),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getUsername: () => name,
    isRegistered: () => true,
    getLocation: () => new core.Location(3321, 3139, 0),
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {} }),
    performGraphic: () => {},
  };
  return p;
}

const xpOf = (p, skill) => p.xp.filter(([id]) => id === skill).reduce((sum, [, amount]) => sum + amount, 0);
const dialogueText = (p) => [...(p.builder?.getDialogues().values() ?? [])]
  .map((entry) => entry.getText?.())
  .filter(Boolean)
  .join("\n");

test("the seasonal XP, fruit and level tables match the Wiki", () => {
  const expected = {
    winter: { farmingXp: 30, handInXp: 350, fruits: 5, level: 1, treeId: WINTER_TREE },
    spring: { farmingXp: 40, handInXp: 1350, fruits: 4, level: 25, treeId: SPRING_TREE },
    autumn: { farmingXp: 50, handInXp: 2350, fruits: 3, level: 45, treeId: 13406 },
    summer: { farmingXp: 60, handInXp: 3000, fruits: 2, level: 65, treeId: 12943 },
  };
  for (const [key, table] of Object.entries(expected)) {
    const season = plugin._test.SEASONS[key];
    assert.equal(season.farmingXp, table.farmingXp);
    assert.equal(season.handInXp, table.handInXp);
    assert.equal(season.fruits, table.fruits);
    assert.equal(season.level, table.level);
    assert.equal(plugin._test.seasonForTree(table.treeId).key, key);
  }
  assert.equal(plugin._test.seasonForGate(SUMMER_GATE).key, "summer");
});

test("a garden refuses entry below its current Thieving level", () => {
  const low = player({ level: 64 });
  assert.equal(plugin._test.entryBlocked(low, plugin._test.SEASONS.summer), true);
  assert.match(low.messages[0], /Thieving level of 65/);
  assert.deepEqual(low.moves.map((at) => [at.getX(), at.getY()]), [[2912, 5472]]);

  const boosted = player({ level: 65 });
  assert.equal(plugin._test.entryBlocked(boosted, plugin._test.SEASONS.summer), false);
  assert.equal(boosted.moves.length, 0);

  assert.equal(plugin._test.entryBlocked(player({ level: 1 }), plugin._test.SEASONS.winter), false);
});

test("an elemental catches only within two tiles with the hedge line clear", () => {
  assert.equal(plugin._test.withinCatchRange(0, 0, 2, 2), true);
  assert.equal(plugin._test.withinCatchRange(0, 0, 2, 3), false);

  const wallAtOneZero = (x, y) => x === 1 && y === 0;
  assert.equal(plugin._test.lineOfSightBlocked(0, 0, 3, 0, wallAtOneZero), true);
  assert.equal(plugin._test.lineOfSightBlocked(0, 0, 3, 0, () => false), false);
  assert.equal(plugin._test.shouldCatch(0, 0, 2, 0, () => false), true);
  assert.equal(plugin._test.shouldCatch(0, 0, 2, 0, wallAtOneZero), false, "hedge blocks the view");
  assert.equal(plugin._test.shouldCatch(0, 0, 3, 0, () => false), false, "out of range");
});

test("the patrol tracks are 2-6 tile straight runs derived from the map clips", () => {
  const spawn = new core.Location(2891, 5470, 0);
  const track = plugin._test.buildTrack(spawn, (x, y) => y === 5473);
  assert.deepEqual(track, { dir: [1, 0], length: 6 });
  // spawn + one step + end: the Wiki's image-only routes are approximated, not copied.
  assert.equal(plugin._test.buildTrack(spawn, () => true), null);
});

test("a safe pick grants exactly one sq'irk, its Farming XP and sends the player back", () => {
  const p = player();
  plugin._test.pickFruit({ player: p, objectId: WINTER_TREE });
  assert.equal(p.inventory.get(WINTER_FRUIT), 1);
  assert.equal(xpOf(p, core.Skill.FARMING), 30);
  assert.equal(xpOf(p, core.Skill.THIEVING), 0);
  assert.deepEqual(p.moves.map((at) => [at.getX(), at.getY()]), [[2912, 5472]]);

  const low = player({ level: 24 });
  plugin._test.pickFruit({ player: low, objectId: SPRING_TREE });
  assert.equal(low.inventory.get(10844) ?? 0, 0);
  assert.equal(low.moves.length, 0);
  assert.match(low.messages[0], /Thieving level of 25/);
});

test("brewing consumes the season's fruit and a beer glass, once", () => {
  const winter = player({ items: { [WINTER_FRUIT]: 5, [BEER_GLASS]: 1 } });
  assert.equal(plugin._test.brew({ player: winter, usedItemId: PESTLE, usedWithItemId: WINTER_FRUIT }), true);
  assert.equal(winter.inventory.get(WINTER_JUICE), 1);
  assert.equal(winter.inventory.get(WINTER_FRUIT), 0);
  assert.equal(winter.inventory.get(BEER_GLASS), 0);
  assert.equal(xpOf(winter, core.Skill.COOKING), 5);

  // No fruit left: repeating the interaction cannot duplicate the glass.
  assert.equal(plugin._test.brew({ player: winter, usedItemId: WINTER_FRUIT, usedWithItemId: PESTLE }), true);
  assert.equal(winter.inventory.get(WINTER_JUICE), 1);
  assert.match(dialogueText(winter), /wait until I have enough fruit to make a full glass/);

  const spring = player({ items: { [10844]: 3, [BEER_GLASS]: 1 } });
  plugin._test.brew({ player: spring, usedItemId: PESTLE, usedWithItemId: 10844 });
  assert.equal(spring.inventory.get(10848) ?? 0, 0, "four spring sq'irks are needed");

  const summer = player({ items: { [10845]: 2, [BEER_GLASS]: 1 } });
  plugin._test.brew({ player: summer, usedItemId: 10845, usedWithItemId: PESTLE });
  assert.equal(summer.inventory.get(10849), 1);

  const noGlass = player({ items: { [10845]: 2 } });
  plugin._test.brew({ player: noGlass, usedItemId: PESTLE, usedWithItemId: 10845 });
  assert.equal(noGlass.inventory.get(10849) ?? 0, 0);
  assert.match(noGlass.messages.at(-1), /beer glass/);
});

test("Osman takes one glass per hand-in for its Thieving XP", () => {
  const summer = player({ items: { [10849]: 2 } });
  assert.equal(plugin._test.talkToSpymaster({ player: summer, npcId: 4286 }), true);
  assert.equal(xpOf(summer, core.Skill.THIEVING), 3000);
  assert.equal(summer.inventory.get(10849), 1);
  assert.equal(plugin._test.talkToSpymaster({ player: summer, npcId: 4286 }), true);
  assert.equal(xpOf(summer, core.Skill.THIEVING), 6000);
  assert.equal(summer.inventory.get(10849), 0);
  assert.equal(plugin._test.talkToSpymaster({ player: summer, npcId: 4286 }), false, "no juice falls through");

  const winter = player({ items: { [WINTER_JUICE]: 1 } });
  plugin._test.talkToSpymaster({ player: winter, npcId: 4286 });
  assert.equal(xpOf(winter, core.Skill.THIEVING), 350);
  assert.match(winter.messages[0], /350 Thieving experience points/);
});

function apprenticeNpc() {
  return {
    chats: [],
    forceChat(line) { this.chats.push(line); },
    setPositionToFace() {},
    performGraphic() {},
    getLocation: () => new core.Location(3321, 3140, 0),
  };
}

test("the apprentice's transcript: variant by past teleports, Osman and follower conditions", () => {
  const t = plugin._test;
  const fresh = player();
  assert.match(t.selectVariant({ player: fresh, npcId: 1808 }), /has-not-been-teleported/);
  fresh.setAttribute(t.TELEPORTED_ATTRIBUTE, true);
  assert.match(t.selectVariant({ player: fresh, npcId: 1808 }), /has-been-teleported/);
  assert.equal(t.selectVariant({ player: fresh, npcId: 1 }), null, "other Apprentices keep theirs");

  questComplete = false;
  const locked = player();
  assert.equal(t.answerCondition({ player: locked, npcId: 1808, text: "If the player has not talked to Osman about the Sorceress's Garden:" }), true);
  assert.equal(t.answerCondition({ player: locked, npcId: 1808, text: "If the player has talked to Osman about the Sorceress's Garden:" }), false);
  questComplete = true;
  assert.equal(t.answerCondition({ player: locked, npcId: 1808, text: "If the player has talked to Osman about the Sorceress's Garden:" }), true);

  const followed = player();
  followed.setAttribute(t.PET_ATTRIBUTE, { isRegistered: () => true });
  assert.equal(t.answerCondition({ player: followed, npcId: 1808, text: "If the player has a pet following them" }), true);
  assert.equal(t.answerCondition({ player: followed, npcId: 1808, text: "If the player does not have a pet following them" }), false);
});

test("the apprentice casts after her first-visit line and for the returning teleport action", () => {
  const t = plugin._test;
  const first = player();
  const npc = apprenticeNpc();
  const line = { player: first, npc, npcId: 1808, text: "Okay, here goes! Remember, to return, just drink from the fountain." };
  t.handleLine(line);
  assert.equal(first.moves.length, 0, "nothing until the player continues");
  line.after();
  assert.deepEqual(npc.chats, ["Senventior Disthinte Molesko!"], "captured overhead, sic");
  assert.deepEqual(first.moves.map((at) => [at.getX(), at.getY()]), [[2912, 5474]]);
  assert.equal(first.getAttribute(t.TELEPORTED_ATTRIBUTE), true);

  const spell = { player: first, npcId: 1808, text: "Seventior Disthinte Molesko!", skip: false };
  t.handleLine(spell);
  assert.equal(spell.skip, true, "said overhead instead of in the chatbox");

  const again = player();
  const action = { player: again, npc: apprenticeNpc(), npcId: 1808, action: "teleport", handled: false };
  t.handleAction(action);
  assert.equal(action.handled, true);
  assert.deepEqual(again.moves.map((at) => [at.getX(), at.getY()]), [[2912, 5474]]);
});

test("the Teleport option works once she has teleported you, and the fountain goes back home", () => {
  const t = plugin._test;
  const fresh = player();
  t.teleportByApprentice({ player: fresh, npc: apprenticeNpc(), npcId: 1808 });
  assert.match(dialogueText(fresh), /far too busy sweeping/);
  assert.equal(fresh.moves.length, 0);

  const p = player();
  p.setAttribute(t.TELEPORTED_ATTRIBUTE, true);
  const npc = apprenticeNpc();
  t.teleportByApprentice({ player: p, npc, npcId: 1808 });
  assert.deepEqual(npc.chats, ["Senventior Disthinte Molesko!"]);
  assert.deepEqual(p.moves.map((at) => [at.getX(), at.getY()]), [[2912, 5474]]);

  const leaver = player();
  t.drinkFromFountain({ player: leaver, objectId: FOUNTAIN });
  assert.deepEqual(leaver.moves.map((at) => [at.getX(), at.getY()]), [[3321, 3139]]);
  assert.equal(t.drinkFromFountain({ player: leaver, objectId: 12940 }), false);
});

test("gates check the maze's level before opening", () => {
  const low = player({ level: 64 });
  plugin._test.openGate({ player: low, objectId: SUMMER_GATE });
  assert.match(low.messages[0], /Thieving level of 65/);

  const ready = player({ level: 65 });
  plugin._test.openGate({ player: ready, objectId: SUMMER_GATE });
  assert.equal(ready.messages[0], "You open the gate.");
  assert.equal(plugin._test.openGate({ player: ready, objectId: 12345 }), false);
});

test("the last player out clears the session and resets the patrol to its spawn", () => {
  const garden = plugin._test.createGarden(plugin._test.SEASONS.winter);
  const spawn = new core.Location(2891, 5470, 0);
  const npc = {
    id: 5797,
    at: new core.Location(2893, 5470, 0),
    getId: () => npc.id,
    getLocation: () => npc.at,
    moveTo: (location) => {
      npc.at = location;
    },
    setScriptedMovement() {},
    getMovementCoordinator: () => ({ setRadius() {} }),
    getMovementQueue: () => ({ reset() {}, size: () => 0, canWalk: () => false, walkStep() {} }),
  };
  garden.patrols.set(npc, { spawn, dir: [1, 0], length: 6, forward: false, pause: 3 });

  const leaving = player();
  plugin._test.sessions.set(leaving, {});
  garden.postLeave({ isPlayer: () => true, getAsPlayer: () => leaving });

  assert.equal(plugin._test.sessions.has(leaving), false);
  assert.deepEqual([npc.at.getX(), npc.at.getY()], [2891, 5470]);
  const state = garden.patrols.get(npc);
  assert.equal(state.forward, true);
  assert.equal(state.pause, 0);
});
