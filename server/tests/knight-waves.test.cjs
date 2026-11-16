// Run with: node --test tests/knight-waves.test.cjs
//
// Unit coverage for the Knight Waves Training Ground before it is played in game: the King's
// Ransom gate, the eight-knight order, the melee-only and no-Prayer rules, wave persistence,
// completion, and the safe death. The plugin is attached to a stub api, so no server is built.
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const Room = require("../plugins/minigames/knightwaves/Room.KnightWaves");

const plugin = require("../plugins/minigames/KnightWaves.plugin");

let area = null;
let tasks = [];
let spawned = [];
let removed = [];
let hooks = {};
let persistDefaults = [];
let completedEvents = [];
let respawnGrants = [];
let prayerSyncs = [];
let resetPrayers = 0;
let customHandlers = new Map();
let xp = [];
let now = 0;

beforeEach(() => {
  tasks = [];
  spawned = [];
  removed = [];
  completedEvents = [];
  resetPrayers = 0;
  Room.sessions.clear();
  respawnGrants = [];
  prayerSyncs = [];
  xp = [];
  now = 0;
});

class StubArea {
  constructor(boundaries) { this.boundaries = boundaries; this.members = new Set(); }
  enter(character) { this.members.add(character); }
  leave(character) { this.members.delete(character); }
}
class StubBoundary {
  constructor(x, x2, y, y2, z) { Object.assign(this, { x, x2, y, y2, z }); }
}
class StubLocation {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  getX() { return this.x; }
  getY() { return this.y; }
  getZ() { return this.z; }
}
class StubTask {
  constructor(ticks, player, running) { this.ticks = ticks; this.stopped = false; }
  execute() {}
  stop() { this.stopped = true; }
}

const core = {
  Area: StubArea,
  Boundary: StubBoundary,
  Location: StubLocation,
  Task: StubTask,
  TaskManager: { submit(task) { tasks.push(task); } },
  CombatType: { MELEE: 0, RANGED: 2, MAGIC: 3 },
  Skill: { ATTACK: 0, STRENGTH: 1, DEFENCE: 2, HITPOINTS: 3, RANGED: 4, MAGIC: 6 },
  PrayerHandler: { resetAll() { resetPrayers++; } },
  RegionManager: {},
  World: { getProcessCycle: () => now },
};

plugin.register({
  core,
  persistAttribute(key, value) { persistDefaults.push([key, value]); },
  registerArea(value) { area = value; },
  onNpcDeath(handler) { hooks.npcDeath = handler; },
  onPlayerDeath(handler) { hooks.playerDeath = handler; },
  onShouldDropItemsOnDeath(handler) { hooks.shouldDrop = handler; },
  onPlayerLogout(handler) { hooks.logout = handler; },
  onCanAttack(handler) { hooks.canAttack = handler; },
  onPrayerDisabled(handler) { hooks.prayerDisabled = handler; },
  onCombatHitResolved(handler) { hooks.hitResolved = handler; },
  onCustomEvent(name, handler) { customHandlers.set(name, [...(customHandlers.get(name) ?? []), handler]); },
  spawnNpc(definition) {
    const npc = {
      definition,
      __skipDefaultRespawn: false,
      hitpoints: 100,
      isRegistered: () => true,
      getHitpoints() { return this.hitpoints; },
      getCombat: () => ({ attack: (player) => { npc.attacked = player; } }),
    };
    spawned.push(npc);
    return npc;
  },
  removeNpc(npc) { removed.push(npc); npc.hitpoints = 0; },
  emitCustomEvent(name, event) {
    if (name === "quest:is-complete") event.complete = event.player.krComplete === true;
    if (name === "knight-waves:completed") completedEvents.push(event);
    if (name === "respawn-point:grant") respawnGrants.push(event);
    if (name === "prayer:sync-unlocks") prayerSyncs.push(event);
    for (const handler of customHandlers.get(name) ?? []) handler(event);
  },
});

function player({ kr = true, wave = 0, inside = true } = {}) {
  const attrs = new Map([["knight-waves:wave", wave]]);
  const messages = [];
  const varbits = [];
  return {
    krComplete: kr,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    attrs,
    messages,
    varbits,
    location: new StubLocation(inside ? 2759 : 2744, inside ? 3510 : 3500, 2),
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getLocation() { return this.location; },
    getHitpoints: () => 99,
    moveTo(location) { this.location = location; },
    sendMessage(text) { messages.push(text); },
    getPacketSender: () => ({ sendVarbit: (id, value) => varbits.push([id, value]) }),
    getMovementQueue: () => ({ reset() {} }),
    levels: { 0: 99, 1: 99, 2: 99, 3: 99, 4: 99, 6: 99 },
    getSkillManager() {
      return {
        getCurrentLevel: (skill) => this.levels[skill],
        setCurrentLevel: (skill, value) => { this.levels[skill] = value; },
        addExperiences: (skill, amount) => { xp.push([skill, amount]); },
      };
    },
  };
}

function enter(p) {
  area.postEnter(p);
  return p;
}

function attack(p, type, npc) {
  const event = { attacker: p, target: npc, method: { type: () => type }, allow: null, message: null };
  hooks.canAttack(event);
  return event;
}

function runTasks() {
  while (tasks.length) tasks.shift().execute();
}

test("registers the room and persists the wave count", () => {
  assert.ok(area, "area registered");
  assert.deepEqual(persistDefaults, [["knight-waves:wave", 0], ["knight-waves:rewards", false]]);
});

test("King's Ransom is required", () => {
  const p = player({ kr: false });
  enter(p);
  assert.equal(spawned.length, 0);
  assert.equal(p.location.x, 2750);
  assert.equal(p.messages.at(-1), "You need to have completed the King's Ransom Quest to gain access to the Knight Waves.");
});

test("the first wave is Sir Bedivere and the order runs to Sir Lancelot", () => {
  const p = player();
  enter(p);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].definition.id, 4361);
  assert.equal(spawned[0].definition.ownerOnly, true);
  assert.equal(spawned[0].attacked, p);
  assert.deepEqual(p.varbits.at(-1), [3909, 0]);
  assert.equal(resetPrayers, 1);
  const expected = [4361, 4360, 4359, 4358, 4357, 4356, 4355, 4354];
  for (let wave = 0; wave < 8; wave++) {
    assert.equal(spawned.at(-1).definition.id, expected[wave]);
    hooks.npcDeath({ npc: spawned.at(-1) });
    runTasks();
  }
  assert.equal(p.attrs.get("knight-waves:wave"), 8);
});

test("ranged and magic are refused, melee and Prayer rules apply", () => {
  const p = player({ wave: 1 });
  const npc = { __knightWaves: { player: p } };
  assert.equal(attack(p, core.CombatType.MELEE, npc).allow, null);
  const ranged = attack(p, core.CombatType.RANGED, npc);
  assert.equal(ranged.allow, false);
  assert.match(ranged.message, /melee/i);
  assert.equal(attack(p, core.CombatType.MAGIC, npc).allow, false);
  const prayer = { player: p, disabled: null, message: null };
  hooks.prayerDisabled(prayer);
  assert.equal(prayer.disabled, true);
  assert.match(prayer.message, /Prayer/);
});

test("a kill advances the saved wave and spawns the next knight", () => {
  const p = player({ wave: 2 });
  enter(p);
  const npc = spawned.at(-1);
  assert.equal(npc.definition.id, 4359, "wave 3 is Sir Tristram");
  hooks.npcDeath({ npc });
  assert.equal(p.attrs.get("knight-waves:wave"), 3);
  assert.deepEqual(p.varbits.at(-1), [3909, 3]);
  assert.equal(spawned.length, 1, "next knight waits two ticks");
  area.process(p);
  assert.equal(spawned.length, 1, "the tick does not race the delayed spawn");
  runTasks();
  assert.equal(spawned.at(-1).definition.id, 4358, "wave 4 is Sir Palomedes");
});

test("the eighth kill completes the activity and refuses re-entry", () => {
  const p = player({ wave: 7 });
  enter(p);
  assert.equal(spawned.at(-1).definition.id, 4354, "wave 8 is Sir Lancelot");
  hooks.npcDeath({ npc: spawned.at(-1) });
  assert.equal(p.attrs.get("knight-waves:wave"), 8);
  assert.equal(completedEvents.length, 1);
  assert.equal(completedEvents[0].player, p);
  assert.equal(tasks.length, 0);
  const again = player({ wave: 8 });
  enter(again);
  assert.equal(again.location.x, 2750);
  assert.match(again.messages.at(-1), /cannot re-enter/);
});

test("death is safe, puts the player outside and clears the knight", () => {
  const p = player({ wave: 4 });
  enter(p);
  const npc = spawned.at(-1);
  const drop = { player: p, shouldDrop: null };
  hooks.shouldDrop(drop);
  assert.equal(drop.shouldDrop, false);
  const death = { player: p, handled: false };
  hooks.playerDeath(death);
  assert.equal(death.handled, true);
  assert.equal(p.location.x, 2750);
  assert.equal(p.attrs.get("knight-waves:wave"), 4, "the wave is kept");
  assert.ok(removed.includes(npc));
});

test("a damaging hit drains the stats the knight's page names", () => {
  const p = player({ wave: 0 });
  enter(p);
  const knight = spawned.at(-1);
  hooks.hitResolved({ attacker: knight, target: p, hit: { isAccurate: () => true, getTotalDamage: () => 4 } });
  assert.equal(p.levels[core.Skill.STRENGTH], 94);
  assert.equal(p.levels[core.Skill.RANGED], 94);
  assert.equal(p.levels[core.Skill.MAGIC], 94);
  assert.equal(p.levels[core.Skill.DEFENCE], 99);
  // A splash drains nothing.
  hooks.hitResolved({ attacker: knight, target: p, hit: { isAccurate: () => false, getTotalDamage: () => 0 } });
  assert.equal(p.levels[core.Skill.STRENGTH], 94);
});

test("completion pays the four XP rewards and grants Camelot once", () => {
  const p = player({ wave: 7 });
  enter(p);
  hooks.npcDeath({ npc: spawned.at(-1) });
  assert.equal(p.attrs.get("knight-waves:rewards"), true);
  assert.deepEqual(xp, [
    [core.Skill.ATTACK, 20000], [core.Skill.STRENGTH, 20000],
    [core.Skill.DEFENCE, 20000], [core.Skill.HITPOINTS, 20000],
  ]);
  assert.equal(respawnGrants.length, 1);
  assert.equal(respawnGrants[0].key, "camelot");
  assert.equal(respawnGrants[0].set, true);
  assert.equal(prayerSyncs.length, 1);
  // Re-entering is refused, and a second completion event pays nothing again.
  customHandlers.get("knight-waves:completed")[0]({ player: p });
  assert.equal(xp.length, 4);
});

test("the squire plays the activity transcript before and after completion", () => {
  const transcriptCalls = [];
  const runtime = require.resolve("../plugins/quests/QuestRuntime");
  const previous = require.cache[runtime];
  require.cache[runtime] = {
    id: runtime, filename: runtime, loaded: true,
    exports: { startTranscript(api, player, npcId, page, variant) { transcriptCalls.push([npcId, page, variant]); return true; } },
  };
  try {
    const squire = customHandlers.get("knight-waves:squire")[0];
    const before = { player: player({ wave: 0 }), npcId: 4353, npc: null, handled: false };
    squire(before);
    assert.equal(before.handled, true);
    assert.deepEqual(transcriptCalls.at(-1), [4353, "Squire (Camelot)", "before-completing-the-knight-waves"]);

    const after = { player: player({ wave: 8 }), npcId: 4353, npc: null, handled: false };
    squire(after);
    assert.deepEqual(transcriptCalls.at(-1), [4353, "Squire (Camelot)", "after-completing-the-knight-waves"]);

    const duringQuest = { player: player({ kr: false }), npcId: 4353, npc: null, handled: false };
    squire(duringQuest);
    assert.equal(duringQuest.handled, false);
  } finally {
    if (previous) require.cache[runtime] = previous;
    else delete require.cache[runtime];
  }
});

test("a knight that is left too long despawns until the player leaves and returns", () => {
  const p = player({ wave: 0 });
  enter(p);
  const npc = spawned.at(-1);
  now = 500;
  area.process(p);
  assert.ok(removed.includes(npc));
  assert.match(p.messages.at(-1), /waited long enough/);
  const count = spawned.length;
  now = 501;
  area.process(p);
  assert.equal(spawned.length, count, "no automatic respawn after the timeout");
  area.postLeave(p);
  enter(p);
  assert.equal(spawned.length, count + 1, "re-entry starts the same wave again");
});

test("logging out removes the knight but keeps progress", () => {
  const p = player({ wave: 5 });
  enter(p);
  const npc = spawned.at(-1);
  hooks.logout({ player: p });
  assert.ok(removed.includes(npc));
  assert.equal(p.attrs.get("knight-waves:wave"), 5);
});
