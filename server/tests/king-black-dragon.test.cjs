// Run with: node --test server/tests/king-black-dragon.test.cjs
// The King Black Dragon's own dragonfire table (Wiki Dragonfire/King_Black_Dragon).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { _test } = require("../plugins/bosses/KingBlackDragon.plugin");

const { breathMax, DragonfireProtectionTier: Tier } = _test;

const PROTECTION = {
  none: { shield: false, prayer: false, tier: Tier.NONE },
  shield: { shield: true, prayer: false, tier: Tier.NONE },
  prayer: { shield: false, prayer: true, tier: Tier.NONE },
  shieldPrayer: { shield: true, prayer: true, tier: Tier.NONE },
  antifire: { shield: false, prayer: false, tier: Tier.ANTIFIRE },
  superAntifire: { shield: false, prayer: false, tier: Tier.SUPER_ANTIFIRE },
  shieldAntifire: { shield: true, prayer: false, tier: Tier.ANTIFIRE },
  shieldSuperAntifire: { shield: true, prayer: false, tier: Tier.SUPER_ANTIFIRE },
  prayerAntifire: { shield: false, prayer: true, tier: Tier.ANTIFIRE },
  prayerSuperAntifire: { shield: false, prayer: true, tier: Tier.SUPER_ANTIFIRE },
  shieldPrayerAntifire: { shield: true, prayer: true, tier: Tier.ANTIFIRE },
  shieldPrayerSuperAntifire: { shield: true, prayer: true, tier: Tier.SUPER_ANTIFIRE },
};

const FIERY = {
  none: 65, shield: 15, prayer: 20, shieldPrayer: 15, antifire: 50, superAntifire: 0,
  shieldAntifire: 0, shieldSuperAntifire: 0, prayerAntifire: 5, prayerSuperAntifire: 0,
  shieldPrayerAntifire: 0, shieldPrayerSuperAntifire: 0,
};
const SPECIAL = {
  none: 50, shield: 10, prayer: 15, shieldPrayer: 10, antifire: 50, superAntifire: 50,
  shieldAntifire: 10, shieldSuperAntifire: 10, prayerAntifire: 15, prayerSuperAntifire: 15,
  shieldPrayerAntifire: 10, shieldPrayerSuperAntifire: 10,
};

test("fiery breath maxima match the Wiki table", () => {
  for (const [key, protection] of Object.entries(PROTECTION)) {
    assert.equal(breathMax(false, protection), FIERY[key], key);
  }
});

test("special breath maxima match the Wiki table", () => {
  for (const [key, protection] of Object.entries(PROTECTION)) {
    assert.equal(breathMax(true, protection), SPECIAL[key], key);
  }
});

// The lair-entry diary credit is covered, with the real Ladders path, in kbd-lair-arrival.test.cjs.
