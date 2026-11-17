const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
before(() => CachePipeline.initialize());

const { ArceuusSpells } = require("../dist/game/content/combat/magic/ArceuusSpells");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");

function fakePlayer(attributes = new Map()) {
  return {
    attributes,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendVarbit() {} }),
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
  ]);
  ArceuusSpells.clearStatuses(fakePlayer(attributes));

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
  assert.equal(attributes.get("arceuus:death-charge-token"), 8);
});

test("Lunar death/logout cleanup removes imbue, Heal Group and Spellbook Swap timers", () => {
  const attributes = new Map([
    ["lunar:magic-imbue-until", 100],
    ["lunar:magic-imbue-ready-at", 100],
    ["lunar:heal-group-ready-at", 100],
    ["lunar:spellbook-swap", { expiresAt: 100 }],
  ]);
  LunarSpells.clearStatuses(fakePlayer(attributes));
  for (const key of [
    "lunar:magic-imbue-until",
    "lunar:magic-imbue-ready-at",
    "lunar:heal-group-ready-at",
    "lunar:spellbook-swap",
  ]) {
    assert.equal(attributes.get(key), null, `${key} must be cleared`);
  }
});
