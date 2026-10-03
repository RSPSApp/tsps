// Run after `yarn build`: node --test tests/gemstone-crab.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Location } = require("../dist/game/model/Location");
const { Skill } = require("../dist/game/model/Skill");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const { Mobile } = require("../dist/game/entity/impl/Mobile");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");

before(() => CachePipeline.initialize());

const CRAB = 14779;
const SHELL = 14780;

/** A plugin NPC: records what the plugin does to it. */
function fakeNpc(id, x, y, z) {
  const npc = {
    id, location: new Location(x, y, z), hitpoints: 0, animations: [], graphics: [], removed: false,
    getId: () => id,
    getLocation: () => npc.location,
    setScriptedMovement(value) { npc.scripted = value; },
    setHitpointsLocked(value) { npc.locked = value; },
    setMaxHitpoints(value) { npc.max = value; },
    setHitpoints(value) { npc.hitpoints = value; },
    getHitpoints: () => npc.hitpoints,
    setHealthBar(bar) { npc.bar = bar; },
    setCombatXpMultiplier(value) { npc.xp = value; },
    performAnimation(animation) { npc.animations.push(animation.getId()); },
    performGraphic(graphic) { npc.graphics.push(graphic.getId()); },
    setPositionToFace() {},
  };
  return npc;
}

const spawned = [];
const hooks = { npc: [], objects: {}, zonesEnter: [], zonesExit: [], dealt: [], commands: {} };
const GemstoneCrab = require("../plugins/bosses/GemstoneCrab.plugin");
GemstoneCrab.register({
  getItemOnGroundManager: () => ({ registerNonGlobals() {} }),
  onServerStartup() {},
  onPlayerDealtDamage: (handler) => hooks.dealt.push(handler),
  onNpcInteraction: (handler) => hooks.npc.push(handler),
  onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
  onZoneEnter: (zone, handler) => hooks.zonesEnter.push({ zone, handler }),
  onZoneExit: (zone, handler) => hooks.zonesExit.push({ zone, handler }),
  registerCommand: (name, handler) => { hooks.commands[name] = handler; },
  spawnNpc: ({ id, x, y, z }) => { const npc = fakeNpc(id, x, y, z); spawned.push(npc); return npc; },
  removeNpc: (npc) => { npc.removed = true; },
});
const { state, tick, attack, inReach, rollGem, spawnCrab, topDealers, SPOTS } = GemstoneCrab._test;

function player(name, x, y, z = 0) {
  const messages = [];
  const varbits = new Map();
  const items = [];
  const scripts = [];
  const hidden = new Map();
  return {
    messages, varbits, items, scripts, hidden, location: new Location(x, y, z),
    getUsername: () => name,
    getLocation() { return this.location; },
    getHitpoints: () => 99,
    isRegistered: () => true,
    sendMessage: (message) => messages.push(message),
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
        sendConfig: (id, value) => { varbits.set(`varp${id}`, value); return sender; },
        sendInterfaceScript: (id, args = []) => { scripts.push([id, args]); return sender; },
        sendInterfaceDisplayState: (uid, hide) => { hidden.set(uid, hide); return sender; },
      };
      return sender;
    },
    getInventory: () => ({ isFull: () => false, addItem: (item) => items.push(item.getId()), contains: () => false }),
    getEquipment: () => ({ get: () => null, getItems: () => new Array(14).fill(null) }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, getMaxLevel: () => 99 }),
    performAnimation() {},
  };
}

function withRandom(value, run) {
  const random = Math.random;
  Math.random = typeof value === "function" ? value : () => value;
  try {
    return run();
  } finally {
    Math.random = random;
  }
}

beforeEach(() => {
  spawned.length = 0;
  if (state.shell) state.shell.expiresAt = state.tick;
  if (state.shell) tick();
  Object.assign(state, { tick: 0, spot: -1, nextSpot: -1, crab: null, shell: null, burrow: null, damage: new Map() });
});

test("the crab rises with its time as its hitpoints, burrows, leaves its shell and rises elsewhere", () => {
  withRandom(0, () => spawnCrab());
  const crab = state.crab;
  assert.equal(crab.id, CRAB);
  assert.deepEqual([crab.location.getX(), crab.location.getY()], SPOTS[state.spot].crab);
  assert.equal(crab.locked, true, "hits never lower its hitpoints");
  assert.equal(crab.scripted, true, "core combat doesn't move it or attack with it");
  assert.equal(crab.max, 918, "its lifetime");
  assert.deepEqual(crab.bar, { id: 20, width: 120 });
  assert.equal(crab.xp, 0.875);
  assert.deepEqual(crab.animations, [12481]);
  assert.deepEqual(crab.graphics, [3454], "it rises with vfx_crab_boss_death");

  tick();
  assert.equal(crab.hitpoints, 917, "a tick of its time gone");
  const firstSpot = state.spot;
  for (let t = 0; t < 917; t++) tick();
  assert.deepEqual(crab.animations.slice(-1), [12482], "it burrows when its time is up");
  assert.deepEqual(crab.graphics.slice(-1), [3454]);
  assert.equal(crab.hitpoints, 1, "never 0, which would kill it (a death, drops, a respawn)");
  for (let t = 0; t < 2; t++) tick();
  assert.equal(state.shell.blocker.getId(), 32740, "its blocking loc goes down 2 ticks in");
  assert.equal(state.shell.npc, null);
  for (let t = 0; t < 2; t++) tick();
  assert.equal(crab.removed, true);
  const shell = state.shell.npc;
  assert.equal(shell.id, SHELL, "its shell is left where it was, 4 ticks in");
  assert.deepEqual(shell.graphics, [3452]);

  withRandom(0.99, () => { for (let t = 0; t < 25; t++) tick(); });
  assert.notEqual(state.crab, null, "the crab rose again 29 ticks after burrowing");
  assert.notEqual(state.spot, firstSpot, "at another mine");
  assert.equal(state.shell.npc, shell, "while the shell stays");

  for (let t = 0; t < 121; t++) tick();
  assert.deepEqual(shell.animations, [12484], "the shell crumbles over its last 4 ticks");
  for (let t = 0; t < 4; t++) tick();
  assert.equal(shell.removed, true);
  assert.equal(state.shell, null);
});

test("it reaches players beside or under its 5x5, but not on its centre tile", () => {
  withRandom(0, () => spawnCrab());
  const [x, y] = SPOTS[state.spot].crab;
  assert.equal(inReach(player("a", x - 1, y)), true, "beside");
  assert.equal(inReach(player("b", x + 1, y + 1)), true, "under");
  assert.equal(inReach(player("c", x + 2, y + 2)), false, "the centre tile is safe");
  assert.equal(inReach(player("d", x - 2, y)), false, "two away");
  assert.equal(inReach(player("e", x, y, 1)), false, "another level");
});

test("it hits every player on the side its target stands on, and no one else", () => {
  withRandom(0, () => spawnCrab());
  const [x, y] = SPOTS[state.spot].crab;
  const at = (name, dx, dy) => {
    const p = player(name, x + dx, y + dy);
    p.hits = 0;
    p.getCombat = () => ({ getHitQueue: () => ({ addPendingDamage: () => { p.hits++; } }) });
    hooks.zonesEnter.find(({ zone }) => zone.minX <= x && x <= zone.maxX && zone.minY <= y && y <= zone.maxY).handler({ player: p });
    return p;
  };
  const west = at("west", -1, 2);
  const westCorner = at("west corner", -1, -1);
  const westUnder = at("west, under it", 0, 3);
  const east = at("east", 5, 2);
  const north = at("north", 2, 5);
  const centre = at("centre", 2, 2);
  state.attack.target = west;
  state.attack.holdUntil = state.tick + 100;
  attack();
  assert.deepEqual(
    [west, westCorner, westUnder, east, north, centre].map((p) => p.hits),
    [1, 1, 1, 0, 0, 0],
    "the west side, its corners and under it; not east, north or the centre tile",
  );
  for (const p of [west, westCorner, westUnder, east, north, centre]) {
    hooks.zonesExit.find(({ zone }) => zone.minX <= x && x <= zone.maxX && zone.minY <= y && y <= zone.maxY).handler({ player: p });
  }
});

test("the 16 top damage dealers may mine the shell, once each, for three gems", () => {
  withRandom(0, () => spawnCrab());
  const crab = state.crab;
  const players = Array.from({ length: 18 }, (_, i) => player(`p${i}`, 0, 0));
  players.forEach((p, i) => hooks.dealt.forEach((handler) => handler({ player: p, target: crab, hit: { getTotalDamage: () => i + 1 } })));
  assert.deepEqual(topDealers().slice(0, 3), ["p17", "p16", "p15"]);
  assert.equal(topDealers().length, 16);

  state.endsAt = state.tick;
  for (let t = 0; t < 5; t++) tick();
  const shell = state.shell.npc;
  const mine = (p) => hooks.npc.forEach((handler) => handler({ player: p, npc: shell, clickType: 1 }));

  mine(players[0]);
  assert.equal(players[0].messages.at(-1), "Your understanding of the gemstone crab is not great enough to mine its shell.");
  const top = players[17];
  const pickaxe = require("../plugins/skills/Mining.plugin").PICKAXES.find((entry) => entry.requiredLevel === 1);
  top.getInventory = () => ({
    isFull: () => false,
    addItem: (item) => top.items.push(item.getId()),
    contains: (id) => id === pickaxe.id,
  });
  mine(top);
  assert.equal(top.messages.at(-1), "You swing your pick at the crab shell.");
  for (let t = 0; t < 4; t++) TaskManager.process();
  assert.equal(top.items.length, 3, "three uncut gems");
  assert.match(top.messages.at(-1), /^You mine an uncut [a-z ]+ from the crab shell\.$/);
  mine(top);
  assert.equal(top.messages.at(-1), "You have already taken your share of this crab's shell.");
});

test("the burrow messages go to the players at its mine, not the whole world", () => {
  withRandom(0, () => spawnCrab());
  const [x, y] = SPOTS[state.spot].crab;
  const zone = (list) => list.find(({ zone }) => zone.minX <= x && x <= zone.maxX && zone.minY <= y && y <= zone.maxY);
  const here = player("here", x - 1, y);
  const edgeville = player("edgeville", 3093, 3493);
  zone(hooks.zonesEnter).handler({ player: here });
  state.damage.set("here", 5);
  state.endsAt = state.tick;
  withRandom(0.99, () => { for (let t = 0; t < 3; t++) tick(); });
  assert.ok(here.messages.includes("The gemstone crab burrows away, leaving a piece of its shell behind."));
  assert.ok(here.messages.includes("The top crab crusher was here!"));
  assert.deepEqual(edgeville.messages, [], "nothing for a player elsewhere");
  zone(hooks.zonesExit).handler({ player: here });
});

test("leaving its mine fades the HUD out (script 2889 with its 14 components) and then hides it", () => {
  withRandom(0, () => spawnCrab());
  const [x, y] = SPOTS[state.spot].crab;
  const zone = (list) => list.find(({ zone }) => zone.minX <= x && x <= zone.maxX && zone.minY <= y && y <= zone.maxY);
  const p = player("p", x - 1, y);
  zone(hooks.zonesEnter).handler({ player: p });
  const HP = (303 << 16) | 5;
  assert.equal(p.hidden.get(HP), false, "shown on arrival");
  assert.deepEqual(p.scripts.slice(-2).map(([id, args]) => [id, args.length, args.at(-1)]), [[2887, 15, 254], [2376, 19, (303 << 16) | 3]],
    "faded back in (an earlier fade-out leaves the bar transparent), then opened");
  zone(hooks.zonesExit).handler({ player: p });
  const [id, args] = p.scripts.at(-1);
  assert.equal(id, 2889);
  assert.equal(args.length, 15, "14 components and a transparency");
  assert.equal(args[0], HP);
  for (let t = 0; t < 3; t++) TaskManager.process();
  assert.equal(p.hidden.get(HP), true, "hidden once faded");
  assert.equal(p.varbits.get("varp1683"), -1);
});

test("a shell roll is uncut dragonstone 1 in 500, else a gem by its weight out of 32", () => {
  assert.equal(withRandom(0, () => rollGem()), 1631, "uncut dragonstone");
  const rolls = [0.5, 0];
  assert.equal(withRandom(() => rolls.shift(), () => rollGem()), 1625, "uncut opal, first on the table");
  const last = [0.5, 31.5 / 32];
  assert.equal(withRandom(() => last.shift(), () => rollGem()), 1617, "uncut diamond, 1/32");
});

test("a hitpoints-locked NPC shows a hit's damage but keeps its hitpoints", () => {
  const npc = Object.create(Mobile.prototype);
  let hitpoints = 75;
  Object.assign(npc, {
    isNpc: () => true,
    isPlayer: () => false,
    getAsNpc: () => ({ isHitpointsLocked: () => true }),
    getHitpoints: () => hitpoints,
    setHitpoints: (value) => { hitpoints = value; },
  });
  const hit = npc.decrementHealth(new HitDamage(200, HitMask.RED));
  assert.equal(hit.getDamage(), 200, "the hitsplat shows the full hit");
  assert.equal(hitpoints, 75);
});

test("combat XP against an NPC is scaled by its multiplier (the crab's 3.5 per damage)", () => {
  const xp = [];
  const attacker = { getSkillManager: () => ({ addExperience: (skill, amount) => xp.push([skill.getName(), amount]) }) };
  const crab = { isNpc: () => true, getAsNpc: () => ({ getCombatXpMultiplier: () => 0.875 }) };
  const hit = {
    getTotalDamage: () => 12,
    getSkills: () => [Skill.STRENGTH.getIndex()],
    getCombatType: () => CombatType.MELEE,
    getTarget: () => crab,
  };
  CombatFactory.rewardExp(attacker, hit);
  assert.deepEqual(xp, [["Hitpoints", 14], ["Strength", 42]], "12 damage: 14 Hitpoints, 42 Strength (3.5 each)");
});
