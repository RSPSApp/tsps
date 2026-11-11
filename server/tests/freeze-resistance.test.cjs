// node --test tests/freeze-resistance.test.cjs
// Freeze resistance (OSRS Wiki: Freeze): a monster's resistance shortens a freeze by that percentage and 100% means
// it is never frozen even when the spell lands. The value is the Wiki infobox's `freezeresistance`, exported per NPC
// by osrsreboxed-db (docs/npc-status-immunities.json `freeze_resistance`) and read by NpcDefinitionLoader.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server"); Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { TimerKey } = require("../dist/util/timers/TimerKey");

before(async () => {
  await CachePipeline.initialize(process.cwd());
  new NpcDefinitionLoader().load();
});

/** A freezable stand-in with the surface freezeTicks uses; `resistance` goes through the real definition. */
function target({ resistance = 0, size = 1, flag = false, npc = true } = {}) {
  const definition = Object.assign(new NpcDefinition(), { freezeResistance: resistance });
  const timers = new Map();
  const registered = [];
  return {
    registered,
    isNpc: () => npc,
    isPlayer: () => !npc,
    getAsNpc() { return this; },
    getCurrentDefinition: () => definition,
    getSize: () => size,
    hasFlag: (name) => flag && name === "combat:freezable",
    getTimers: () => ({
      has: (key) => timers.has(key),
      registers: (key, ticks) => { timers.set(key, ticks); registered.push([key, ticks]); },
    }),
    getMovementQueue: () => ({ reset() {} }),
    getPacketSender: () => ({ sendEffectTimer() {} }),
    sendMessage() {},
    ticks: () => timers.get(TimerKey.FREEZE),
  };
}

test("the loader reads freeze_resistance as a whole percentage and ignores anything else", () => {
  const read = (record, name = "Fixture") => {
    const definition = new NpcDefinition();
    NpcDefinitionLoader.applyStatusImmunities(definition, name, record);
    return definition.getFreezeResistance();
  };
  assert.equal(read({ name: "Fixture", freeze_resistance: 50 }), 50);
  assert.equal(read({ name: "Fixture", freeze_resistance: 100 }), 100);
  assert.equal(read({ name: "Fixture", freeze_resistance: 250 }), 100);
  assert.equal(read({ name: "Fixture", freeze_resistance: -5 }), 0);
  assert.equal(read({ name: "Fixture", freeze_resistance: "50" }), 0);
  assert.equal(read({ name: "Fixture", freeze_resistance: 33.5 }), 0);
  assert.equal(read({ name: "Fixture" }), 0, "a record from before the field");
  assert.equal(read({ name: "Other", freeze_resistance: 50 }), 0, "another cache name is not this NPC");
});

test("a freeze is shortened by the resistance, never below one tick", () => {
  for (const [resistance, expected] of [[0, 20], [20, 16], [33, 13], [50, 10], [60, 8], [99, 1]]) {
    const npc = target({ resistance });
    CombatFactory.freezeTicks(npc, 20);
    assert.equal(npc.ticks(), expected, `${resistance}%`);
  }
});

test("100% resistance is never frozen: no timer, no frozen event", () => {
  const events = [];
  PluginManager.createApi("FreezeResistanceProbe").onCustomEvent("combat:frozen", (event) => events.push(event));
  const npc = target({ resistance: 100 });
  CombatFactory.freezeTicks(npc, 20);
  assert.deepEqual(npc.registered, []);
  assert.deepEqual(events.filter((event) => event.target === npc), []);
  const free = target({ resistance: 0 });
  CombatFactory.freezeTicks(free, 20);
  assert.equal(events.filter((event) => event.target === free).length, 1, "the probe sees a landed freeze");
});

test("a large NPC is still immune, unless the Wiki gives it a partial resistance", () => {
  const plain = target({ size: 3 });
  CombatFactory.freezeTicks(plain, 20);
  assert.deepEqual(plain.registered, [], "size 3, no resistance data: the existing rule stands");
  const flagged = target({ size: 3, flag: true });
  CombatFactory.freezeTicks(flagged, 20);
  assert.equal(flagged.ticks(), 20, "an opt-in flag still frees it");
  const partial = target({ size: 5, resistance: 40 });
  CombatFactory.freezeTicks(partial, 20);
  assert.equal(partial.ticks(), 12, "40% resistance: frozen for 60% of the duration");
});

test("a player is unaffected", () => {
  const player = target({ npc: false, resistance: 100 });
  CombatFactory.freezeTicks(player, 20, null);
  assert.equal(player.ticks(), 20);
});

test("a listener that already models the resistance is not applied twice (Phantom Muspah: 33% = 66% of the duration)", () => {
  PluginManager.createApi("FreezeResistanceExact").onCustomEvent("combat:freeze-duration", (event) => {
    if (event.target.exact) { event.ticks *= 0.5; event.resisted = true; }
  });
  const npc = Object.assign(target({ resistance: 50 }), { exact: true });
  CombatFactory.freezeTicks(npc, 20);
  assert.equal(npc.ticks(), 10, "the listener's 50% only, not 25%");
});

test("the exported data reaches real definitions: Wiki infobox values by NPC id", () => {
  const resistance = (id) => NpcDefinition.forId(id).getFreezeResistance();
  for (const [id, expected, what] of [
    [7221, 50, "Scurrius (public)"], [7222, 50, "Scurrius (private)"],
    [12077, 33, "Phantom Muspah, ranged"], [12079, 33, "Phantom Muspah, shielded"],
    [12377, 50, "Scarred imp"], [12335, 50, "Wighted Leech"],
    [14017, 100, "Hueycoatl body"], [13011, 100, "Blood Moon"], [13013, 100, "Blue Moon"],
    [3129, 0, "K'ril Tsutsaroth (no resistance on the Wiki)"],
  ]) assert.equal(resistance(id), expected, what);
});
