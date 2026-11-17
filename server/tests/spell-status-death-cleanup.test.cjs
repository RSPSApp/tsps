const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
before(() => CachePipeline.initialize());

const { ArceuusSpells } = require("../dist/game/content/combat/magic/ArceuusSpells");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");

function fakePlayer(attributes = new Map(), sent = []) {
  return {
    attributes,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendVarbit: (id, value) => sent.push([id, value]) }),
  };
}

test("Arceuus death/logout cleanup removes every buff, cooldown and pending task token", () => {
  const attributes = new Map([
    [ArceuusSpells.WARD_UNTIL, 100],
    [ArceuusSpells.DEATH_CHARGE_UNTIL, 100],
    [ArceuusSpells.SHADOW_VEIL_UNTIL, 100],
    [ArceuusSpells.MARK_UNTIL, 100],
    [ArceuusSpells.DARK_LURE_UNTIL, 100],
    ["arceuus:ward-cooldown", 100],
    ["arceuus:offering-until", 100],
    ["arceuus:shadow-veil-cooldown", 100],
    ["arceuus:vile-vigour-cooldown", 100],
    ["arceuus:corruption", 3],
    ["arceuus:corruption-marked", true],
    ["arceuus:corruption-cooldown", 100],
    ["arceuus:mark-token", 4],
    ["arceuus:death-charge-token", 7],
    [ArceuusSpells.DEATH_CHARGE_COOLDOWN_ATTRIBUTE, 100],
  ]);
  const sent = [];
  ArceuusSpells.clearStatuses(fakePlayer(attributes, sent));

  for (const key of [
    ArceuusSpells.WARD_UNTIL,
    ArceuusSpells.DEATH_CHARGE_UNTIL,
    ArceuusSpells.SHADOW_VEIL_UNTIL,
    ArceuusSpells.MARK_UNTIL,
    ArceuusSpells.DARK_LURE_UNTIL,
    "arceuus:ward-cooldown",
    "arceuus:offering-until",
    "arceuus:shadow-veil-cooldown",
    "arceuus:vile-vigour-cooldown",
    "arceuus:corruption",
    "arceuus:corruption-marked",
    "arceuus:corruption-cooldown",
  ]) {
    assert.equal(attributes.get(key), null, `${key} must be cleared`);
  }
  assert.equal(attributes.get("arceuus:mark-token"), 5);
  assert.equal(attributes.get("arceuus:death-charge-token"), 7,
    "the cooldown's expiry task is not retired");
  assert.equal(attributes.get(ArceuusSpells.DEATH_CHARGE_COOLDOWN_ATTRIBUTE), 100,
    "the Death Charge cooldown keeps running");
  const cooldownVarbit = require("../dist/game/cache/CacheDefinitions").CacheDefinitions.getVarbitId("arceuus_death_charge_cooldown");
  const activeVarbit = require("../dist/game/cache/CacheDefinitions").CacheDefinitions.getVarbitId("arceuus_death_charge_active");
  assert.deepEqual(sent, [[activeVarbit, 0]], "only the active indicator is retired");
  assert.ok(!sent.some(([id, value]) => id === cooldownVarbit && value === 0),
    "the cooldown indicator is not cleared early");
});

test("Lunar death/logout cleanup removes imbue and Heal Group timers and restores the swapped book", () => {
  const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
  const attributes = new Map([
    ["lunar:magic-imbue-until", 100],
    ["lunar:magic-imbue-ready-at", 100],
    ["lunar:heal-group-ready-at", 100],
    ["lunar:spellbook-swap", { expiresAt: 100 }],
  ]);
  const restored = [];
  const original = MagicSpellbook.changeSpellbook;
  MagicSpellbook.changeSpellbook = (_player, book) => { restored.push(book); return true; };
  try {
    LunarSpells.clearStatuses(fakePlayer(attributes));
  } finally {
    MagicSpellbook.changeSpellbook = original;
  }
  for (const key of [
    "lunar:magic-imbue-until",
    "lunar:magic-imbue-ready-at",
    "lunar:heal-group-ready-at",
    "lunar:spellbook-swap",
  ]) {
    assert.equal(attributes.get(key), null, `${key} must be cleared`);
  }
  assert.deepEqual(restored, [MagicSpellbook.LUNAR], "the temporary book returns to Lunar");
});

test("Death Charge login resync keeps the remaining cooldown indicator", () => {
  const { World } = require("../dist/game/World");
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  const attributes = new Map([[ArceuusSpells.DEATH_CHARGE_COOLDOWN_ATTRIBUTE, 50]]);
  const sent = [];
  ArceuusSpells.syncDeathCharge(fakePlayer(attributes, sent));
  const cooldownVarbit = CacheDefinitions.getVarbitId("arceuus_death_charge_cooldown");
  assert.deepEqual(sent, [[CacheDefinitions.getVarbitId("arceuus_death_charge_active"), 0], [cooldownVarbit, 1]]);
});

test("death keeps the Vengeance cooldown while removing the active rebound", () => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null);
  player.setRegistered(true);
  player.getSession = () => ({ sendClientPacket: () => true });
  player.getVengeanceTimer().start(30);
  player.resetAttributes();
  assert.equal(player.getVengeanceTimer().finished(), false, "the 30-second cooldown survives death");
  player.setRegistered(false);
});
