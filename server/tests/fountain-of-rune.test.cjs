// Run after `yarn build`: node --test tests/fountain-of-rune.test.cjs
//
// The Fountain of Rune (#2567, after #2529; OSRS Wiki: Fountain of Rune): near it spells cost no runes and
// give no Magic XP, Low Level Alchemy cast there is the easy Wilderness Diary task, and the spellbook lights
// up. Evidence for the spellbook: the client's own script [proc,magic_runecount] (rev 234, Joshua-F/osrs-dumps
// commit 4dc71e50, script 19) returns an unlimited count for any rune when `%fountain_of_rune_active = 1`
// (varbit 4145) on a members world, so the server must send varbit 4145. NO RSProx capture of the Fountain was
// found (searches for its object ids, the varbit and its name hit nothing but dialogue and journal text).
// Real engine: every plugin loaded, the real map around the Fountain (RegionManager.loadMapFiles), a real
// Player, Low Level Alchemy through the "widget_target" packet via ClientConnection.dispatch, and Charge
// (3 fire, 3 blood, 3 air) through the combat spells' own self-cast entry. The Fountain is found the way
// Recharge.Jewellery does: the loc in the map whose definition, as a player sees it, is "Fountain of Rune"
// (the map holds the morph parent, not the 31941/31942 child that the plugin looked for).
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
const { Skill } = require("../dist/game/model/Skill");
const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const FOUNTAIN_AREA = [3377, 3893];
const AWAY = [3222, 3218];
const VARBIT = 4145;
const ALCHEMY_TASK = "cast-low-alchemy-at-the-fountain-of-rune";
const NATURE = 561;
const FIRE = 554;
const BLOOD = 565;
const AIR = 556;
const COINS = 995;
const RUNE_PLATELEGS = 1079;
let core;
let next = 8200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...FOUNTAIN_AREA);
  core.RegionManager.loadMapFiles(...AWAY);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, at, { magic = 99 } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("fountain" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  p.getSkillManager().setMaxLevel(Skill.MAGIC, magic).setCurrentLevel(Skill.MAGIC, magic, false);
  const messages = [];
  const varbits = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), "sendVarbit", (id, value) => { varbits.push([id, value]); return p.getPacketSender(); });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), messages, varbits };
}

/** The map's Fountain locs, found by what a player sees them as. */
function fountainLocs(probe) {
  const found = [];
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const at = object.getLocation();
      if (at.getX() < 3200 || at.getX() > 3392 || at.getY() < 3840 || at.getY() > 3967) continue;
      if (core.ObjectDefinition.forPlayer(object.getId(), probe)?.getName() === "Fountain of Rune") found.push(object);
    }
  }
  return found;
}

/** A free tile beside the Fountain loc, close enough that nothing can be in the way. */
function tileBeside(object) {
  const at = object.getLocation();
  for (let ring = 1; ring <= 4; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = at.getX() + dx;
        const y = at.getY() + dy;
        if (core.RegionManager.getClipping(x, y, 0, null) === 0) return [x, y];
      }
    }
  }
  assert.fail("no free tile near the Fountain");
}

let standAt;

// First, before anything has found the Fountain: the plugin's cache is empty, so a tick for a player who is in
// the Wilderness but nowhere near the Fountain must not walk the loaded map's locs looking for it.
test("a player in the deep Wilderness but away from the Fountain's ruin never makes the plugin scan the map", (t) => {
  const f = actor(t, [3300, 3900]);
  const values = t.mock.method(core.MapObjects.mapObjects, "values");
  for (let i = 0; i < 3; i++) PM.emitPlayerProcess({ player: f.p });
  assert.equal(values.mock.callCount(), 0, "no scan of the map's locs");
  assert.deepEqual(f.varbits.filter(([id, value]) => id === VARBIT && value === 1), []);
});

test("the loaded map holds the Fountain of Rune loc, and where we stand beside it is in the Wilderness", (t) => {
  const probe = actor(t, AWAY).p;
  const objects = fountainLocs(probe);
  assert.equal(objects.length, 1, "exactly one loc that players see as the Fountain of Rune is in the map");
  t.diagnostic(`fountain loc ids ${objects.map((object) => object.getId()).join(",")} at ${objects.map((o) => `${o.getLocation().getX()},${o.getLocation().getY()}`).join(" ")}`);
  standAt = tileBeside(objects[0]);
  assert.ok(core.Wilderness.levelAt(standAt[0], standAt[1]) > 0, "a Wilderness tile");
});

const give = (f, ...items) => items.forEach(([id, amount]) => f.inv.add(new core.Item(id, amount), false));
const held = (f, id) => f.inv.getAmount(id);
const credited = (f) => DiaryProgress.doneTasks(f.p, Diaries.BY_KEY.get("wilderness")).has(ALCHEMY_TASK);
const xp = (f) => f.p.getSkillManager().getExperience(Skill.MAGIC);

/** Low Level Alchemy on the item in slot 0, as the client sends it. */
async function lowAlchemy(f) {
  const spell = core.CacheDefinitions.getSpellByName("Low Level Alchemy");
  assert.ok(spell, "Low Level Alchemy is in the cache");
  await f.c.dispatch([{
    type: "widget_target", sourceWidgetId: spell.widgetId, sourceItemId: spell.itemId,
    targetItemId: f.inv.getItems()[0].getId(), targetSlot: 0, targetWidgetId: 0,
  }]);
  f.c.processTurnPackets();
  for (let i = 0; i < 6; i++) core.TaskManager.process();
}

test("Low Level Alchemy beside the Fountain: no runes taken, no Magic XP, the diary task credited", async (t) => {
  const f = actor(t, standAt);
  give(f, [RUNE_PLATELEGS, 1], [NATURE, 1], [FIRE, 3]);
  const before = xp(f);
  await lowAlchemy(f);
  assert.ok(held(f, COINS) > 0, "the alchemy happened: coins");
  assert.equal(held(f, NATURE), 1, "the nature rune was not taken");
  assert.equal(held(f, FIRE), 3, "nor the fire runes");
  assert.equal(xp(f), before, "no Magic XP at the Fountain");
  assert.equal(credited(f), true, "the Wilderness diary task");
});

test("Low Level Alchemy away from the Fountain takes its runes, pays XP and credits nothing", async (t) => {
  const f = actor(t, AWAY);
  give(f, [RUNE_PLATELEGS, 1], [NATURE, 1], [FIRE, 3]);
  const before = xp(f);
  await lowAlchemy(f);
  assert.ok(held(f, COINS) > 0);
  assert.equal(held(f, NATURE), 0, "the nature rune went");
  assert.equal(held(f, FIRE), 0, "and the fire runes");
  assert.ok(xp(f) > before, "XP is paid");
  assert.equal(credited(f), false);
});

test("Charge beside the Fountain costs no runes and gives no Magic XP; away it does", async (t) => {
  const near = actor(t, standAt);
  give(near, [FIRE, 3], [BLOOD, 3], [AIR, 3]);
  const before = xp(near);
  CombatSpells.handleSelf(near.p, "Charge");
  assert.deepEqual([held(near, FIRE), held(near, BLOOD), held(near, AIR)], [3, 3, 3], "no runes taken");
  assert.equal(xp(near), before, "no XP");
  const away = actor(t, AWAY);
  give(away, [FIRE, 3], [BLOOD, 3], [AIR, 3]);
  CombatSpells.handleSelf(away.p, "Charge");
  assert.deepEqual([held(away, FIRE), held(away, BLOOD), held(away, AIR)], [0, 0, 0], "away: the runes went");
});

const tick = (f) => PM.emitPlayerProcess({ player: f.p });
const fountainVarbit = (f) => f.varbits.filter(([id]) => id === VARBIT);

test("the spellbook lights up: varbit 4145 is 1 beside the Fountain and 0 when the player leaves", (t) => {
  const f = actor(t, AWAY);
  tick(f);
  assert.deepEqual(fountainVarbit(f).filter(([, value]) => value === 1), [], "not lit away from it");
  f.p.setLocation(new core.Location(standAt[0], standAt[1], 0));
  tick(f);
  assert.deepEqual(fountainVarbit(f).at(-1), [VARBIT, 1], "lit beside it");
  const sent = fountainVarbit(f).length;
  tick(f);
  assert.equal(fountainVarbit(f).length, sent, "sent once, not every tick");
  f.p.setLocation(new core.Location(AWAY[0], AWAY[1], 0));
  tick(f);
  assert.deepEqual(fountainVarbit(f).at(-1), [VARBIT, 0], "dark again away from it");
});

test("a player who logs in beside the Fountain, or is teleported there, is lit by the next tick", (t) => {
  const f = actor(t, standAt);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  tick(f);
  assert.deepEqual(fountainVarbit(f).at(-1), [VARBIT, 1]);
});

test("a private area is not the Fountain: no light there", (t) => {
  const f = actor(t, standAt);
  f.p.getPrivateArea = () => ({});
  tick(f);
  assert.deepEqual(fountainVarbit(f).filter(([, value]) => value === 1), []);
});

test("Low Level Alchemy beside the Fountain with no runes at all: it casts, and away from it it does not", async (t) => {
  const near = actor(t, standAt);
  give(near, [RUNE_PLATELEGS, 1]);
  assert.equal(held(near, NATURE) + held(near, FIRE), 0, "no runes held");
  await lowAlchemy(near);
  assert.ok(held(near, COINS) > 0, "cast without a single rune");
  assert.equal(credited(near), true);
  const away = actor(t, AWAY);
  give(away, [RUNE_PLATELEGS, 1]);
  await lowAlchemy(away);
  assert.equal(held(away, COINS), 0, "away: no runes, no cast");
  assert.equal(held(away, RUNE_PLATELEGS), 1);
});

test("the Fountain's features are members-only (Wiki): on a free world nothing is waived, credited or lit", async (t) => {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => false);
  const f = actor(t, standAt);
  give(f, [RUNE_PLATELEGS, 1], [NATURE, 1], [FIRE, 3]);
  await lowAlchemy(f);
  assert.equal(held(f, NATURE), 0, "the runes went");
  assert.equal(held(f, FIRE), 0);
  assert.equal(credited(f), false, "no diary credit");
  tick(f);
  assert.deepEqual(fountainVarbit(f).filter(([, value]) => value === 1), [], "and the spellbook stays dark");
});
