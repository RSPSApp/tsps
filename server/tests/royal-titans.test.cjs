// node --test tests/royal-titans.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Shared = require("../plugins/bosses/royaltitans/Shared.RoyalTitans");
const CombatAchievements = require("../plugins/bosses/royaltitans/CombatAchievements.RoyalTitans");
const Minions = require("../plugins/bosses/royaltitans/Minions.RoyalTitans");
const Specials = require("../plugins/bosses/royaltitans/Specials.RoyalTitans");
const Corpse = require("../plugins/bosses/royaltitans/Corpse.RoyalTitans");
const Combat = require("../plugins/bosses/royaltitans/Combat.RoyalTitans");
const Area = require("../plugins/bosses/royaltitans/Area.RoyalTitans");

let now = 1000;
const completed = [];
const kills = [];
const queuedHits = [];
const fakeApi = {
  core: {
    World: { getProcessCycle: () => now },
    Skill: { PRAYER: 5 },
    ItemIdentifiers: { VOID_MAGE_HELM: 11663, VOID_MAGE_HELM_OR_: 26473 },
    CombatSpells: {},
    NpcIdentifiers: { FIRE_ELEMENTAL_2: 14150, ICE_ELEMENTAL: 14151 },
    Equipment: { HEAD_SLOT: 0 },
    CombatMethod: class {},
    CombatType: { MAGIC: "MAGIC", MELEE: "MELEE" },
    CombatFactory: { addPendingHit: (hit) => queuedHits.push(hit) },
  },
  onAttackSpeed() {},
  getBonusManager: () => ({ ATTACK_MAGIC: 3 }),
  onCombatHitRoll() {},
  registerMagicHitModifier() { assert.fail('general weakness belongs to the shared elemental plugin'); },
  registerMagicAttackAccuracyModifier() { assert.fail('general weakness belongs to the shared elemental plugin'); },
  getPrayerHandler: () => ({ PROTECT_FROM_MELEE: 1, PROTECT_FROM_MISSILES: 2, PROTECT_FROM_MAGIC: 3 }),
  persistAttribute() {},
  onCombatHitResolved(handler) { fakeApi.hitResolved = handler; },
  onNpcDeath() {},
  onNpcHitModify() {},
  onNpcInteraction() {},
  onNpcsInteraction() {},
  onObjectInteraction() {},
  onPlayerLogin() {},
  onPlayerDeath() {},
  onPlayerDeathItemDrop() {},
  onCustomEvent() {},
  emitCustomEvent(name, payload) {
    if (name === "combat-achievements:complete") completed.push(payload.task);
    if (name === "combat-achievements:kill") {
      kills.push(payload);
      payload.total = (payload.count ?? 0) + 100;
      payload.announce?.(payload.total);
    }
  },
  registerNpcCombatMethodProvider() {},
  sendMultiChatboxPrompt() {},
  getItemOnGroundManager: () => ({ registerLocation() {} }),
};
Shared.init(fakeApi);
CombatAchievements.attach(fakeApi);
Minions.attach(fakeApi);

function fakePlayer(prayer = 10) {
  const store = new Map();
  return {
    getAttribute: (key) => store.get(key),
    setAttribute: (key, value) => store.set(key, value),
    getSkillManager: () => ({ getCurrentLevel: () => prayer }),
    sendMessage() {},
    isRegistered: () => true,
  };
}

function fakeTitan(id, hp = 600) {
  const store = new Map();
  return {
    getId: () => id,
    getHitpoints: () => hp,
    isRegistered: () => true,
    getAttribute: (key) => store.get(key),
    setAttribute: (key, value) => store.set(key, value),
  };
}

test("shared helpers: edges, tiles, durations, ids", () => {
  assert.equal(Shared.edgeDistance(3, 2910, 9571, 2915, 9576), 3);
  assert.equal(Shared.edgeDistance(3, 2910, 9571, 2911, 9573), 0);
  assert.equal(Shared.tileKey(2911, 9567), "2911,9567");
  assert.equal(Shared.formatTicks(534), "5:20.40");
  assert.equal(Shared.formatTicks(90), "0:54.00");
  assert.ok(Shared.isTitanNpc(12596) && Shared.isTitanNpc(14152) && !Shared.isTitanNpc(2085));
});

test("blast safe tile: anywhere in the area, or the row farthest from a lone survivor", () => {
  const both = { branda: fakeTitan(12596), eldric: fakeTitan(14147) };
  for (let i = 0; i < 50; i++) {
    const tile = Specials.blastSafeTile(both);
    assert.ok(tile.x >= 2909 && tile.x <= 2913 && tile.y >= 9564 && tile.y <= 9570);
  }
  const brandaDown = { branda: fakeTitan(12596, 0), eldric: fakeTitan(14147) };
  brandaDown.branda.isRegistered = () => false;
  assert.equal(Specials.blastSafeTile(brandaDown).y, 9570);
  const eldricDown = { branda: fakeTitan(12596), eldric: fakeTitan(14147, 0) };
  assert.equal(Specials.blastSafeTile(eldricDown).y, 9564);
});

test("blast safe tile: never on a live wall tile, any tile if all covered", () => {
  const row = fakeRowNpc(14152, 2911, 9566);
  row.setAttribute(Shared.ROW_ATTRIBUTE, { kind: "fire", x: 2911, y: 9566 });
  const withRow = { branda: fakeTitan(12596), eldric: fakeTitan(14147), rows: new Set([row]) };
  for (let i = 0; i < 50; i++) {
    const tile = Specials.blastSafeTile(withRow);
    assert.ok(!(tile.x === 2911 && tile.y === 9566), "safe tile avoids the live wall tile");
    assert.ok(tile.x >= 2909 && tile.x <= 2913 && tile.y >= 9564 && tile.y <= 9570);
  }
  const covered = new Set();
  for (let x = 2909; x <= 2913; x++) {
    for (let y = 9564; y <= 9570; y++) {
      const tile = fakeRowNpc(14152, x, y);
      tile.setAttribute(Shared.ROW_ATTRIBUTE, { kind: "fire", x, y });
      covered.add(tile);
    }
  }
  const tile = Specials.blastSafeTile({ branda: fakeTitan(12596), eldric: fakeTitan(14147), rows: covered });
  assert.ok(tile.x >= 2909 && tile.x <= 2913 && tile.y >= 9564 && tile.y <= 9570);
});

test("blast safe tile: steers clear of rows still forming", () => {
  const pending = { tiles: [[2911, 9566]] };
  const session = { branda: fakeTitan(12596), eldric: fakeTitan(14147), rows: new Set(), pendingRows: [pending] };
  for (let i = 0; i < 50; i++) {
    const tile = Specials.blastSafeTile(session);
    assert.ok(!(tile.x === 2911 && tile.y === 9566), "safe tile avoids targeted tiles");
  }
});

test("formation blocking: occupants of targeted tiles take the hit", () => {
  const at = (x, y, hp = 99) => ({
    getLocation: () => ({ getX: () => x, getY: () => y }),
    isRegistered: () => true,
    getHitpoints: () => hp,
  });
  const spots = [[2909, 9566], [2910, 9566], [2911, 9566], [2912, 9566], [2913, 9566]];
  const session = { players: [at(2911, 9566), at(2911, 9566), at(2913, 9566), at(2900, 9500)] };
  const occupants = Specials.occupantsByTile(session, spots);
  assert.deepEqual([...occupants.keys()], ["2911,9566", "2913,9566"]);
  assert.equal(occupants.get("2911,9566").length, 2);
  assert.equal(occupants.get("2913,9566").length, 1);
  const withCorpse = { players: [at(2911, 9566, 0)] };
  assert.equal(Specials.occupantsByTile(withCorpse, spots).size, 0);
});

test("mobile attacks follow the spot: stomps from the edge, never from the back", () => {
  const { pickSpecial } = Combat._test;
  const titan = fakeTitan(12596);
  const edge = new Set(); const back = new Set(); const busy = new Set();
  for (let i = 0; i < 400; i++) {
    edge.add(pickSpecial(titan, "edge", false));
    back.add(pickSpecial(titan, "back", false));
    busy.add(pickSpecial(titan, "back", true));
  }
  assert.ok(edge.has("melee"));
  assert.ok(!back.has("melee") && back.has("row") && back.has("minions"));
  assert.ok(!busy.has("minions"), "never a second trio while its own is up");
});

test("minion spell helpers: tiers and elements", () => {
  assert.equal(Minions._test.spellTier("WATER_SURGE"), "surge");
  assert.equal(Minions._test.spellTier("FIRE_WAVE"), "wave");
  assert.equal(Minions._test.spellTier("FIRE_BLAST"), "blast");
  assert.equal(Minions._test.spellElement("WATER_WAVE"), "water");
  assert.equal(Minions._test.spellElement("ICE_BARRAGE"), "water");
  assert.equal(Minions._test.spellElement("FIRE_SURGE"), "fire");
});

function fakeRowNpc(id, x, y) {
  const store = new Map();
  return {
    getId: () => id,
    getLocation: () => ({ getX: () => x, getY: () => y }),
    getAttribute: (key) => store.get(key),
    setAttribute: (key, value) => store.set(key, value),
    isRegistered: () => true,
  };
}

function fakeCaster(spell, bonus = 70) {
  return {
    isPlayer: () => true,
    getAsPlayer: function () { return this; },
    getCombat: () => ({ getSelectedSpell: () => spell, getPreviousCast: () => null }),
    getBonusManager: () => ({ getAttackBonus: () => [0, 0, 0, bonus] }),
    getEquipment: () => ({ get: () => ({ getId: () => -1 }) }),
    sendMessage() {},
    messages: [],
  };
}

function fakeSpellHit(attacker, damage = 24) {
  const parts = [{ damage, setDamage(value) { this.damage = value; }, getDamage() { return this.damage; } }];
  return {
    getAttacker: () => attacker,
    getHits: () => parts,
    updateTotalDamage() {},
  };
}

test("row clearing: water surge clears a fire tile", () => {
  const npc = fakeRowNpc(14152, 2911, 9566);
  const attacker = fakeCaster("WATER_SURGE");
  attacker.sendMessage = function (text) { this.messages.push(text); };
  const hit = fakeSpellHit(attacker);
  Minions._test.rowClearingHit({ npc, hit });
  assert.equal(hit.getHits()[0].getDamage(), 1);
  assert.deepEqual(attacker.messages, []);
});

test("row clearing: blast-tier water and any ice spell clear fire, weaker hints", () => {
  for (const spell of ["WATER_SURGE", "WATER_WAVE", "WATER_BLAST", "ICE_RUSH", "ICE_BURST", "ICE_BLITZ", "ICE_BARRAGE"]) {
    const npc = fakeRowNpc(14152, 2911, 9566);
    const attacker = fakeCaster(spell);
    attacker.sendMessage = function (text) { this.messages.push(text); };
    const hit = fakeSpellHit(attacker);
    Minions._test.rowClearingHit({ npc, hit });
    assert.equal(hit.getHits()[0].getDamage(), 1, spell);
    assert.deepEqual(attacker.messages, []);
  }
  for (const spell of ["WATER_STRIKE", "WATER_BOLT", "FIRE_SURGE", "WIND_STRIKE", null]) {
    const npc = fakeRowNpc(14152, 2911, 9566);
    const attacker = fakeCaster(spell);
    attacker.sendMessage = function (text) { this.messages.push(text); };
    const hit = fakeSpellHit(attacker);
    Minions._test.rowClearingHit({ npc, hit });
    assert.equal(hit.getHits()[0].getDamage(), 0);
    assert.ok(attacker.messages.some((text) => /strong enough/.test(text)));
  }
});

test("row clearing: fire surge clears an ice tile", () => {
  const npc = fakeRowNpc(14153, 2911, 9566);
  const attacker = fakeCaster("FIRE_SURGE");
  attacker.sendMessage = function (text) { this.messages.push(text); };
  const hit = fakeSpellHit(attacker);
  Minions._test.rowClearingHit({ npc, hit });
  assert.equal(hit.getHits()[0].getDamage(), 1);
  assert.deepEqual(attacker.messages, []);
});

test("row clearing: weak fire hints on ice, blast-tier clears", () => {
  for (const spell of ["FIRE_BLAST", "FIRE_WAVE"]) {
    const npc = fakeRowNpc(14153, 2911, 9566);
    const attacker = fakeCaster(spell);
    attacker.sendMessage = function (text) { this.messages.push(text); };
    const hit = fakeSpellHit(attacker);
    Minions._test.rowClearingHit({ npc, hit });
    assert.equal(hit.getHits()[0].getDamage(), 1, spell);
    assert.deepEqual(attacker.messages, []);
  }
  for (const spell of ["FIRE_STRIKE", "FIRE_BOLT", "WATER_SURGE"]) {
    const npc = fakeRowNpc(14153, 2911, 9566);
    const attacker = fakeCaster(spell);
    attacker.sendMessage = function (text) { this.messages.push(text); };
    const hit = fakeSpellHit(attacker);
    Minions._test.rowClearingHit({ npc, hit });
    assert.equal(hit.getHits()[0].getDamage(), 0);
    assert.ok(attacker.messages.some((text) => /strong enough/.test(text)));
  }
});

test("row accuracy: the right element always lands on row tiles", () => {
  for (const [spell, row, lands] of [
    ["WATER_SURGE", 14152, true], ["WATER_STRIKE", 14152, true],
    ["FIRE_SURGE", 14153, true], ["FIRE_SURGE", 14152, false],
    ["WATER_SURGE", 14153, false],
  ]) {
    const roll = { attacker: fakeCaster(spell), target: { isNpc: () => true, getId: () => row } };
    Minions._test.elementalAccuracy(roll);
    assert.equal(roll.forceAccurate === true, lands, `${spell} on ${row}`);
  }
});

test("contribution shares are whole percents of combined damage", () => {
  const me = fakePlayer();
  me.getUsername = () => "me";
  const other = fakePlayer();
  other.getUsername = () => "other";
  const branda = fakeTitan(12596);
  const eldric = fakeTitan(14147);
  branda.setAttribute(Shared.DAMAGE_DEALT_ATTRIBUTE, { me: 300, other: 300 });
  eldric.setAttribute(Shared.DAMAGE_DEALT_ATTRIBUTE, { me: 300, other: 300 });
  assert.equal(Corpse._test.shareOf({ branda, eldric }, me), 0.5);
  const bystander = fakePlayer();
  bystander.getUsername = () => "bystander";
  assert.equal(Corpse._test.shareOf({ branda, eldric }, bystander), 0);
});

test("loot scaling: linear above 1%, pet/clues untouched, pages stripped", () => {
  const drops = [
    { itemId: 30640, amount: 14, name: "Desiccated page" },
    { itemId: 12345, amount: 300, name: "Coal" },
    { itemId: 30622, amount: 1, name: "Bran" },
    { itemId: 2722, amount: 1, name: "Clue scroll (hard)" },
  ];
  const half = Corpse._test.scaleDrops(drops, 0.5, false);
  assert.equal(half.find((d) => d.itemId === 12345).amount, 150);
  assert.equal(half.find((d) => d.itemId === 30622).amount, 1);
  assert.ok(!half.some((d) => d.itemId === 30640));
  const tiny = Corpse._test.scaleDrops(drops, 0.005, false);
  assert.equal(tiny.find((d) => d.itemId === 12345).amount, 1);
  const none = Corpse._test.scaleDrops(drops, 0, false);
  assert.deepEqual(none, []);
});

test("loot that doesn't fit lands at the corpse that was claimed, Eldric's as well as Branda's (#1595)", () => {
  const floor = [];
  Corpse.attach({
    ...fakeApi,
    core: {
      ...fakeApi.core,
      Item: class { constructor(id, amount) { this.id = id; this.amount = amount; } },
      ItemDefinition: { forId: () => ({ getNoteId: () => -1, isStackable: () => true }) },
    },
    getItemOnGroundManager: () => ({ registerLocation: (owner, item, where) => floor.push(where) }),
  });
  const corpse = (x) => ({ isRegistered: () => true, getLocation: () => ({ x }) });
  const branda = corpse(2905), eldric = corpse(2915);
  const full = { getLocation: () => ({ x: 0 }), getInventory: () => ({ contains: () => false, getFreeSlots: () => 0 }) };
  const session = { branda, eldric, area: null };
  Corpse._test.spawnDrops(full, session, eldric, [{ itemId: 571, amount: 34 }]);
  Corpse._test.spawnDrops(full, session, branda, [{ itemId: 569, amount: 34 }]);
  assert.deepEqual(floor.map((where) => where.x), [2915, 2905]);
});

test("a clean kill completes Perfect, No time to pray and counts the streak", () => {
  completed.length = 0;
  const player = fakePlayer();
  CombatAchievements.spawned(player, { players: [player] });
  now += 100;
  const total = CombatAchievements.killed(player, { players: [player] }, 1, () => {});
  assert.equal(total, 101);
  assert.ok(completed.includes("Perfect Royal Titans"));
  assert.ok(completed.includes("No time to pray"));
  assert.equal(player.getAttribute(Shared.STREAK_ATTRIBUTE), 1);
});

test("avoidable damage blocks Perfect but nothing else", () => {
  completed.length = 0;
  const player = fakePlayer();
  CombatAchievements.spawned(player, { players: [player] });
  CombatAchievements.avoidableDamage(player, 12, "blast");
  now += 100;
  CombatAchievements.killed(player, { players: [player] }, 2, () => {});
  assert.ok(!completed.includes("Perfect Royal Titans"));
  assert.ok(completed.includes("No time to pray"));
});

test("dying inside one charge phase completes It takes too long", () => {
  completed.length = 0;
  const player = fakePlayer();
  const session = { players: [player] };
  CombatAchievements.spawned(player, session);
  CombatAchievements.blastCharged(session, 7);
  now += 100;
  CombatAchievements.killed(player, session, 3, () => {});
  assert.ok(completed.includes("It takes too long"));
});

test("fifteen kills in one instance complete Titan Killer; leaving fails it", () => {
  completed.length = 0;
  const player = fakePlayer();
  const session = { players: [player] };
  for (let kill = 0; kill < 15; kill++) {
    CombatAchievements.spawned(player, session);
    now += 100;
    CombatAchievements.killed(player, session, kill + 1, () => {});
  }
  assert.ok(completed.includes("Titan Killer"));
  completed.length = 0;
  CombatAchievements.left(player, session);
  // A new instance restarts the streak (CombatAchievements.joined resets both attributes).
  player.setAttribute(Shared.STREAK_ATTRIBUTE, 0);
  player.setAttribute(Shared.STREAK_FAILED_ATTRIBUTE, null);
  const fresh = { players: [player] };
  CombatAchievements.spawned(player, fresh);
  now += 100;
  CombatAchievements.killed(player, fresh, 16, () => {});
  assert.equal(player.getAttribute(Shared.STREAK_ATTRIBUTE), 1);
  assert.ok(!completed.includes("Titan Killer"));
});

test("one-sided damage completes One by one; minion attacks fail Elemental Company", () => {
  completed.length = 0;
  const player = fakePlayer();
  const session = { players: [player] };
  CombatAchievements.spawned(player, session);
  CombatAchievements.hitResolved({
    attacker: { isPlayer: () => true, getAsPlayer: () => player },
    target: { isNpc: () => true, getId: () => 12596, getAttribute: () => undefined },
    hit: { getTotalDamage: () => 50 },
  });
  CombatAchievements.minionAttacked(player, session);
  now += 100;
  CombatAchievements.killed(player, session, 4, () => {});
  assert.ok(completed.includes("One by one"));
  assert.ok(!completed.includes("Elemental Company"));
});

test("a blast pulse that kills an elemental counts toward Let them fight", () => {
  completed.length = 0;
  const player = fakePlayer();
  const session = { players: [player] };
  CombatAchievements.spawned(player, session);
  const minion = { getHitpoints: () => 20 };
  CombatAchievements.minionHitByTitan(session, minion, 19);
  for (let kill = 0; kill < 10; kill++) CombatAchievements.minionHitByTitan(session, minion, 20);
  now += 100;
  CombatAchievements.killed(player, session, 5, () => {});
  assert.ok(completed.includes("Let them fight"));
});

test("join is open only while both titans are fresh", () => {
  const { joinable } = Area._test;
  assert.equal(joinable({ branda: null, eldric: null }), true);
  assert.equal(joinable({ branda: fakeTitan(12596, 600), eldric: fakeTitan(14147, 450) }), true);
  assert.equal(joinable({ branda: fakeTitan(12596, 600), eldric: fakeTitan(14147, 449) }), false);
  const teleported = fakeTitan(12596, 500);
  teleported.setAttribute(Shared.TELEPORTED_ATTRIBUTE, true);
  assert.equal(joinable({ branda: teleported, eldric: fakeTitan(14147, 600) }), false);
});

test("a correct spell clears its row tile and the ones either side", () => {
  const removed = [];
  const fakeCore = Object.assign({}, fakeApi.core, {
    ObjectManager: { deregister() {}, register() {} },
    World: { getProcessCycle: () => now, getRemoveNPCQueue: () => ({ push: (npc) => removed.push(npc) }) },
    Sounds: { playAreaSound() {} },
    GameObject: class {}, Location: class {}, Graphic: class {},
    Task: class {}, TaskManager: { submit() {} },
  });
  Specials.attach({ core: fakeCore, onNpcInteraction() {}, registerNpcCombatOption() {}, onCustomEvent() {} });
  const cast = {};
  const session = { rows: new Set(), players: [], staticLocs: [], area: { isDestroyed: () => true, add() {} } };
  const tiles = [2909, 2910, 2911, 2912, 2913].map((x) => {
    const npc = fakeRowNpc(14152, x, 9566);
    npc.setAttribute(Shared.ROW_ATTRIBUTE, { kind: "fire", x, y: 9566, cast, vfx: null });
    session.rows.add(npc);
    return npc;
  });
  Specials.clearRowTile(session, tiles[2], true);
  assert.deepEqual([...session.rows].map((npc) => npc.getAttribute(Shared.ROW_ATTRIBUTE).x), [2909, 2913]);
  assert.equal(removed.length, 3);
});

// --- Custom pacing: row clears, elemental splash, kills shortening the attack delay ---------

function fakeElemental(id, x, y, session, hp = 20) {
  const store = new Map([[Shared.ENCOUNTER_ATTRIBUTE, session]]);
  const npc = {
    hp,
    queued: 0,
    getId: () => id,
    isNpc: () => true,
    isRegistered: () => true,
    getHitpoints: () => npc.hp,
    getLocation: () => ({ getX: () => x, getY: () => y }),
    getAttribute: (key) => store.get(key),
    setAttribute: (key, value) => store.set(key, value),
    pending: [],
    getCombat: () => ({ getHitQueue: () => ({ getPendingHitsFrom: (attacker) => npc.pending.filter((hit) => hit.attacker === attacker) }) }),
  };
  return npc;
}

function fakeSpellCaster(spell) {
  let next = 0;
  let cast = spell;
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getCombat: () => ({
      getSelectedSpell: () => cast,
      getPreviousCast: () => spell,
      getCastSpell: () => cast,
      setCastSpell: (value) => { cast = value; },
      getAttackDelay: () => Math.max(0, next - now),
      setAttackDelay: (ticks) => { next = now + ticks; },
    }),
    dropCast() { cast = null; },
  };
}

test("a spell that clears a row tile delays the next attack by 1 tick, not 5", () => {
  const session = { rows: new Set(), minions: new Set() };
  const fireRow = fakeElemental(Shared.FIRE_ROW_ID, 2911, 9566, session);
  const speed = (caster, target, combatType = "MAGIC") => {
    const event = { attacker: caster, target, combatType, speed: 5 };
    Minions._test.rowClearAttackSpeed(event);
    return event.speed;
  };
  assert.equal(speed(fakeSpellCaster("WATER_SURGE"), fireRow), 1, "water surge douses fire");
  assert.equal(speed(fakeSpellCaster("FIRE_SURGE"), fireRow), 5, "the wrong element keeps its delay");
  assert.equal(speed(fakeSpellCaster("WATER_BOLT"), fireRow), 5, "too weak keeps its delay");
  assert.equal(speed(fakeSpellCaster("WATER_SURGE"), fireRow, "MELEE"), 5, "not a spell");
  const iceRow = fakeElemental(Shared.ICE_ROW_ID, 2911, 9566, session);
  assert.equal(speed(fakeSpellCaster("FIRE_BLAST"), iceRow), 1, "fire blast melts ice");
  const elemental = fakeElemental(Shared.ICE_MINION_ID, 2911, 9566, session);
  assert.equal(speed(fakeSpellCaster("FIRE_SURGE"), elemental), 5, "an elemental isn't a row");
});

function spellHit(attacker, damage, accurate = true, type = "MAGIC") {
  return { attacker, getCombatType: () => type, isAccurate: () => accurate, getTotalDamage: () => damage };
}

test("a spell on an elemental also hits the elementals on the 3x3 around it", () => {
  const session = { minions: new Set() };
  const target = fakeElemental(Shared.ICE_MINION_ID, 2910, 9570, session);
  const beside = fakeElemental(Shared.ICE_MINION_ID, 2911, 9570, session);
  const corner = fakeElemental(Shared.ICE_MINION_ID, 2909, 9571, session);
  const far = fakeElemental(Shared.ICE_MINION_ID, 2912, 9570, session);
  const dead = fakeElemental(Shared.ICE_MINION_ID, 2910, 9569, session, 0);
  for (const npc of [target, beside, corner, far, dead]) session.minions.add(npc);
  assert.deepEqual(Minions._test.splashTargets(session, target), [beside, corner]);

  const caster = fakeSpellCaster({ spellId: () => 1 });
  caster.dropCast(); // a hand cast is torn down by the time the attack finishes
  const struck = [];
  const method = {
    type: () => "MAGIC",
    hits: (player, other) => {
      assert.ok(player.getCombat().getSelectedSpell(), "the spell is back in hand for the extra hits");
      struck.push(other);
      return [{ other }];
    },
  };
  queuedHits.length = 0;
  Minions._test.spellOnElemental({ attacker: caster, target, method });
  assert.deepEqual(struck, [beside, corner]);
  assert.equal(queuedHits.length, 2);
  assert.equal(caster.getCombat().getCastSpell(), null, "the cast is torn down again");

  struck.length = 0;
  Minions._test.spellOnElemental({ attacker: caster, target, method: { ...method, type: () => "MELEE" } });
  assert.deepEqual(struck, [], "only spells splash");
  const burst = fakeSpellCaster({ spellId: () => 2, spellRadius: () => 1 });
  Minions._test.spellOnElemental({ attacker: burst, target, method });
  assert.deepEqual(struck, [], "bursts and barrages spread on their own");
});

test("each elemental a cast will kill takes 1 tick off the attack delay at once: a whole trio leaves 2", () => {
  const session = { minions: new Set() };
  const trio = [0, 1, 2].map((dx) => fakeElemental(Shared.ICE_MINION_ID, 2910 + dx, 9570, session));
  for (const npc of trio) session.minions.add(npc);
  const caster = fakeSpellCaster("FIRE_SURGE");
  const method = { type: () => "MAGIC", hits: () => [] };
  caster.getCombat().setAttackDelay(5);
  // The rolls are made at the cast: every hit on its way is known before it lands.
  for (const npc of trio) npc.pending = [spellHit(caster, 20)];
  Minions._test.spellOnElemental({ attacker: caster, target: trio[1], method });
  assert.equal(caster.getCombat().getAttackDelay(), 2);
  caster.getCombat().setAttackDelay(5);
  Minions._test.spellOnElemental({ attacker: caster, target: trio[1], method });
  assert.equal(caster.getCombat().getAttackDelay(), 5, "an elemental counts once");

  const pair = [0, 1].map((dx) => fakeElemental(Shared.FIRE_MINION_ID, 2920 + dx, 9570, session));
  for (const npc of pair) session.minions.add(npc);
  const other = fakeSpellCaster("WATER_SURGE");
  other.getCombat().setAttackDelay(5);
  pair[0].pending = [spellHit(other, 10), spellHit(caster, 30)];
  pair[1].pending = [spellHit(other, 20, false)];
  Minions._test.spellOnElemental({ attacker: other, target: pair[0], method });
  assert.equal(other.getCombat().getAttackDelay(), 5, "too little damage, a splash, or someone else's hit");
  pair[0].pending.push(spellHit(other, 10));
  Minions._test.spellOnElemental({ attacker: other, target: pair[0], method });
  assert.equal(other.getCombat().getAttackDelay(), 4, "two hits in flight that add up to a kill");
});

test("a cast that will clear a row tile ends the attack, and its tiles take no second cast", () => {
  const magic = { type: () => "MAGIC" };
  const cast = {};
  const session = { rows: new Set() };
  const tiles = [2909, 2910, 2911, 2912, 2913].map((x) => {
    const npc = fakeRowNpc(Shared.FIRE_ROW_ID, x, 9566);
    npc.isNpc = () => true;
    npc.setAttribute(Shared.ENCOUNTER_ATTRIBUTE, session);
    npc.setAttribute(Shared.ROW_ATTRIBUTE, { kind: "fire", x, y: 9566, cast });
    session.rows.add(npc);
    return npc;
  });
  const caster = (spell) => {
    const player = fakeSpellCaster(spell);
    const combat = player.getCombat();
    player.resets = 0;
    player.getCombat = () => Object.assign(combat, { reset: () => { player.resets += 1; } });
    player.setPositionToFace = () => {};
    player.sendMessage = () => {};
    return player;
  };

  const wrong = caster("FIRE_SURGE");
  Minions._test.rowCastFinished({ attacker: wrong, target: tiles[2], method: magic });
  assert.equal(wrong.resets, 0, "a spell that can't clear it leaves the attack alone");
  assert.equal(Specials.rowAttackAllowed(wrong, tiles[2], magic), null);

  const player = caster("WATER_SURGE");
  Minions._test.rowCastFinished({ attacker: player, target: tiles[2], method: magic });
  assert.equal(player.resets, 1, "the attack ends, as a hand cast's does (an autocaster moves on)");
  for (const tile of tiles.slice(1, 4)) {
    assert.equal(Specials.rowAttackAllowed(player, tile, magic), false, "the spell is already taking this tile");
  }
  assert.equal(Specials.rowAttackAllowed(player, tiles[0], magic), null, "two tiles along is still open");
  assert.equal(Specials.rowAttackAllowed(player, tiles[4], magic), null);
  now += 10;
  assert.equal(Specials.rowAttackAllowed(player, tiles[2], magic), null, "a spell that never landed frees the tile");
});

test("a row tile is judged by the spell its hit carries, not the one selected as it lands", () => {
  const withSpell = (attacker, spell) => Object.assign(fakeSpellHit(attacker), { getSpell: () => spell });
  // Hand-cast Water Wave with Fire Wave on autocast: the selection is Fire Wave by the time it lands.
  const autocastFire = fakeCaster("FIRE_WAVE");
  autocastFire.sendMessage = function (text) { this.messages.push(text); };
  const doused = withSpell(autocastFire, "WATER_WAVE");
  Minions._test.rowClearingHit({ npc: fakeRowNpc(Shared.FIRE_ROW_ID, 2911, 9566), hit: doused });
  assert.equal(doused.getHits()[0].getDamage(), 1, "Water Wave douses the fire wall");
  assert.deepEqual(autocastFire.messages, [], "no 'not powerful enough' hint");

  // The other way round: Fire Wave cast at a fire wall never clears it, whatever is selected.
  const autocastWater = fakeCaster("WATER_WAVE");
  autocastWater.sendMessage = function (text) { this.messages.push(text); };
  const wrong = withSpell(autocastWater, "FIRE_WAVE");
  Minions._test.rowClearingHit({ npc: fakeRowNpc(Shared.FIRE_ROW_ID, 2912, 9566), hit: wrong });
  assert.equal(wrong.getHits()[0].getDamage(), 0, "fire doesn't douse fire");
  const melted = withSpell(autocastWater, "FIRE_WAVE");
  Minions._test.rowClearingHit({ npc: fakeRowNpc(Shared.ICE_ROW_ID, 2913, 9566), hit: melted });
  assert.equal(melted.getHits()[0].getDamage(), 1, "Fire Wave melts the ice wall");
  const frozen = withSpell(autocastWater, "WATER_WAVE");
  Minions._test.rowClearingHit({ npc: fakeRowNpc(Shared.ICE_ROW_ID, 2914, 9566), hit: frozen });
  assert.equal(frozen.getHits()[0].getDamage(), 0, "water doesn't melt ice");
});

test("the 3x3 splash around a struck elemental always lands its maximum", () => {
  const session = { minions: new Set() };
  const target = fakeElemental(Shared.FIRE_MINION_ID, 2910, 9570, session);
  const beside = fakeElemental(Shared.FIRE_MINION_ID, 2911, 9570, session);
  for (const npc of [target, beside]) session.minions.add(npc);
  const caster = fakeSpellCaster("WIND_WAVE");
  caster.getBonusManager = () => ({ getAttackBonus: () => [0, 0, 0, -50] });
  caster.getEquipment = () => ({ get: () => null });
  const rolls = [];
  const method = {
    type: () => "MAGIC",
    hits: (player, other) => {
      const roll = { attacker: player, target: other, forceAccurate: false, forceMaxHit: false };
      Minions._test.elementalAccuracy(roll);
      rolls.push(roll);
      return [];
    },
  };
  Minions._test.spellOnElemental({ attacker: caster, target, method });
  assert.equal(rolls.length, 1);
  assert.ok(rolls[0].forceAccurate && rolls[0].forceMaxHit, "accurate and at its maximum, even from a weak caster");
  const after = { attacker: caster, target: beside, forceAccurate: false, forceMaxHit: false };
  Minions._test.elementalAccuracy(after);
  assert.equal(after.forceMaxHit, false, "an ordinary cast rolls as usual again");
});

// --- One by one, Let them fight, Titan Killer through a whole fight ---------------------------

function liveTitan(id, session) {
  const store = new Map([[Shared.ENCOUNTER_ATTRIBUTE, session]]);
  const npc = {
    hp: 600,
    getId: () => id,
    isNpc: () => true,
    isRegistered: () => true,
    getHitpoints: () => npc.hp,
    getAttribute: (key) => store.get(key),
    setAttribute: (key, value) => store.set(key, value),
  };
  return npc;
}

function titanFight() {
  const player = fakePlayer();
  const session = { players: [player] };
  session.branda = liveTitan(Shared.BRANDA_ID, session);
  session.eldric = liveTitan(Shared.ELDRIC_ID, session);
  CombatAchievements.spawned(player, session);
  const attacker = { isPlayer: () => true, getAsPlayer: () => player };
  const hit = (titan, damage = 30) => CombatAchievements.hitResolved({ attacker, target: titan, hit: { getTotalDamage: () => damage } });
  const finish = () => { now += 100; CombatAchievements.killed(player, session, 1, () => {}); };
  return { player, session, hit, finish };
}

test("One by one: kill Branda, then Eldric, completes it", () => {
  completed.length = 0;
  const { session, hit, finish } = titanFight();
  hit(session.branda); hit(session.branda, 0); // a miss is still attacking her
  session.branda.hp = 0; // she dies before Eldric is touched
  hit(session.eldric); hit(session.eldric);
  session.eldric.hp = 0;
  finish();
  assert.ok(completed.includes("One by one"));
});

test("One by one: Eldric first works the same way", () => {
  completed.length = 0;
  const { session, hit, finish } = titanFight();
  hit(session.eldric);
  session.eldric.setAttribute(Shared.DYING_ATTRIBUTE, true); // in his death: no longer fighting
  hit(session.branda);
  finish();
  assert.ok(completed.includes("One by one"));
});

test("One by one: attacking the other titan while the first still fights fails it", () => {
  completed.length = 0;
  const { session, hit, finish } = titanFight();
  hit(session.branda);
  hit(session.eldric); // Branda is still up
  session.branda.hp = 0;
  hit(session.eldric);
  finish();
  assert.ok(!completed.includes("One by one"));
  // Even a splash on the other one counts as attacking it.
  completed.length = 0;
  const second = titanFight();
  second.hit(second.session.eldric, 30);
  second.hit(second.session.branda, 0);
  second.finish();
  assert.ok(!completed.includes("One by one"));
});

test("Let them fight: walls and blasts destroy elementals of the other element outright, each counted once", () => {
  completed.length = 0;
  const HitDamage = class { constructor(damage) { this.damage = damage; } };
  Specials.attach({ core: Object.assign({}, fakeApi.core, { HitDamage, HitMask: { RED: 0 }, Task: class {}, TaskManager: { submit() {} } }),
    onNpcInteraction() {}, registerNpcCombatOption() {}, onCustomEvent() {} });
  const { player, session, finish } = titanFight();
  const elemental = (hp = 40) => {
    const npc = { hp, dealt: 0, isRegistered: () => true, getHitpoints: () => npc.hp,
      getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => { npc.dealt += hits[0].damage; npc.hp = 0; } }) }) };
    return npc;
  };
  for (let i = 0; i < 10; i++) {
    const minion = elemental(i % 2 ? 40 : 17); // some already hurt by the player
    Specials._test.destroyElemental(session, minion);
    assert.equal(minion.hp, 0, "destroyed outright");
    Specials._test.destroyElemental(session, minion); // a second pulse on the same tick
  }
  finish();
  assert.ok(completed.includes("Let them fight"), "ten destroyed elementals");
  void player;
});

test("Titan Killer: a join restarts the streak, a death or a partner leaving fails it", () => {
  completed.length = 0;
  const player = fakePlayer();
  const partner = fakePlayer();
  const session = { players: [player, partner] };
  CombatAchievements.joined(player, session);
  for (let kill = 0; kill < 14; kill++) {
    CombatAchievements.spawned(player, session);
    now += 100;
    CombatAchievements.killed(player, session, kill + 1, () => {});
  }
  assert.equal(player.getAttribute(Shared.STREAK_ATTRIBUTE), 14);
  CombatAchievements.left(partner, session); // the partner leaves: the stayer's streak is lost
  assert.equal(player.getAttribute(Shared.STREAK_ATTRIBUTE), 0);
  CombatAchievements.spawned(player, session);
  now += 100;
  CombatAchievements.killed(player, session, 15, () => {});
  assert.ok(!completed.includes("Titan Killer"));

  CombatAchievements.died(player);
  for (let kill = 0; kill < 15; kill++) {
    CombatAchievements.spawned(player, session);
    now += 100;
    CombatAchievements.killed(player, session, kill + 16, () => {});
  }
  assert.ok(!completed.includes("Titan Killer"), "after a death the streak can't continue");
  CombatAchievements.joined(player, session); // a new instance
  for (let kill = 0; kill < 15; kill++) {
    CombatAchievements.spawned(player, session);
    now += 100;
    CombatAchievements.killed(player, session, kill + 31, () => {});
  }
  assert.ok(completed.includes("Titan Killer"), "fifteen in a fresh instance");
});

test("a player on a titan's landing grid is knocked to the arena centre for 15-30 damage, counted against Perfect", () => {
  completed.length = 0;
  const HitDamage = class { constructor(damage) { this.damage = damage; } };
  const Location = class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } };
  let roll = 0;
  Specials.attach({ core: Object.assign({}, fakeApi.core, { HitDamage, HitMask: { RED: 0 }, Location, Misc: { getRandom: (max) => Math.min(max, roll) },
    Task: class {}, TaskManager: { submit() {} } }), onNpcInteraction() {}, registerNpcCombatOption() {}, onCustomEvent() {} });
  const mover = (x, y) => {
    const store = new Map();
    const player = {
      x, y, taken: 0,
      isRegistered: () => true,
      getHitpoints: () => 99,
      getLocation: () => ({ getX: () => player.x, getY: () => player.y, getZ: () => 0 }),
      moveTo: (to) => { player.x = to.x; player.y = to.y; },
      getMovementQueue: () => ({ reset() {} }),
      getCombat: () => ({ reset() {}, getHitQueue: () => ({ addPendingDamage: (hits) => { player.taken += hits[0].damage; } }) }),
      getAttribute: (key) => store.get(key), setAttribute: (key, value) => store.set(key, value),
      getSkillManager: () => ({ getCurrentLevel: () => 10 }),
    };
    return player;
  };
  // No area base: authored tiles are the instance's own (instanceTile's fallback).
  const underBranda = mover(2911, 9573); // the arena entry, under Branda's static spot
  const besideLane = mover(2909, 9572); // the lane's edge, still on her grid
  const clear = mover(2911, 9570);
  const session = { area: {}, players: [underBranda, besideLane, clear] };
  for (const player of session.players) CombatAchievements.spawned(player, session);
  roll = 0;
  Specials._test.knockBackFromLanding(session, Shared.BRANDA_STATIC);
  assert.deepEqual([underBranda.x, underBranda.y], [2911, 9567], "thrown to the centre");
  assert.deepEqual([besideLane.x, besideLane.y], [2911, 9567]);
  assert.deepEqual([clear.x, clear.y], [2911, 9570], "off the grid: untouched");
  assert.equal(underBranda.taken, 15, "at least 15");
  assert.equal(clear.taken, 0);
  roll = 99;
  const again = mover(2912, 9561);
  session.players.push(again);
  CombatAchievements.spawned(again, session);
  Specials._test.knockBackFromLanding(session, Shared.ELDRIC_STATIC);
  assert.equal(again.taken, 30, "at most 30");
  assert.deepEqual([again.x, again.y], [2911, 9567], "Eldric's grid too");
  now += 100;
  CombatAchievements.killed(underBranda, session, 1, () => {});
  assert.ok(!completed.includes("Perfect Royal Titans"), "a jump attack is avoidable damage");
  completed.length = 0;
  CombatAchievements.killed(clear, session, 1, () => {});
  assert.ok(completed.includes("Perfect Royal Titans"), "the player who stepped off keeps Perfect");
});

test("both titans dying stops an Elemental Blast in progress: no pulse lands after the fight ends", () => {
  const removed = [];
  const hits = [];
  const fakeCore = Object.assign({}, fakeApi.core, {
    ObjectManager: { deregister() {}, register() {} },
    World: { getProcessCycle: () => now, getRemoveNPCQueue: () => ({ push: (npc) => removed.push(npc) }) },
    Sounds: { playAreaSound() {} },
    GameObject: class {}, Location: class {}, Graphic: class {},
    HitDamage: class { constructor(damage) { this.damage = damage; } }, HitMask: { RED: 0 },
    Misc: { getRandom: () => 20 },
    Task: class {}, TaskManager: { submit() {} },
  });
  Specials.attach({ core: fakeCore, onNpcInteraction() {}, registerNpcCombatOption() {}, onCustomEvent() {} });
  const player = {
    isRegistered: () => true, getHitpoints: () => 99,
    getLocation: () => ({ getX: () => 2910, getY: () => 9566, getZ: () => 0 }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (h) => hits.push(h[0].damage) }) }),
    getPacketSender: () => ({ sendGlobalGraphic() {} }),
    getAttribute: () => undefined, setAttribute() {},
  };
  const session = {
    area: { isDestroyed: () => false }, players: [player], rows: new Set(), minions: new Set(),
    staticLocs: [], tileLocs: new Map(), pendingRows: [], blastId: 3, blastSafe: { x: 2911, y: 9567 },
  };
  const ids = new Set([Shared.BRANDA_ID, Shared.ELDRIC_ID]);
  Specials._test.blastPulse(session, 3, ids);
  assert.equal(hits.length, 1, "a pulse lands while the fight is on");
  Specials.endFight(session); // both titans down
  Specials._test.blastPulse(session, 3, ids);
  Specials._test.blastPulse(session, 3, ids);
  assert.equal(hits.length, 1, "the rest of that blast never lands");
  assert.equal(session.titanTiles, null, "the landed titans' tiles are free for the next fight");
});
