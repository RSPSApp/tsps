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

// The easy Wilderness Diary's "Enter the King Black Dragon's lair." (beneath the Lava Maze).
test("climbing down the Lava Maze ladder into the lair completes the easy Wilderness Diary task", () => {
  const { Server } = require("../dist/Server");
  Server.installProductionPathResolver();
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const events = [];
  const clicks = new Map();
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    emitCustomEvent: (name, payload) => events.push({ name, ...payload }),
    onObjectFirstClick: (id, handler) => clicks.set(id, handler),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require("../plugins/bosses/KingBlackDragon.plugin").register(api);
  const who = {};
  assert.equal(clicks.get(18987)({ player: who }), true);
  assert.deepEqual(events.filter((event) => event.name === "diary:task").map((event) => [event.player, event.diary, event.task]),
    [[who, "wilderness", "enter-the-king-black-dragon-s-lair"]]);
  events.length = 0;
  assert.equal(clicks.get(1817)({ player: who }), true);
  assert.deepEqual(events.filter((event) => event.name === "diary:task"), [], "the lair's own lever leads out");
});
