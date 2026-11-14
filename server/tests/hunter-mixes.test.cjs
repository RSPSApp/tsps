// Run after `yarn build`: node --test tests/hunter-mixes.test.cjs
//
// Hunter's mixes (Wiki "Hunter's mix" and each mix's page): two doses, each giving its jarred
// butterfly's or moth's bonus (Attack/Defence/Strength 4 + 15%, 8 Hitpoints, the sunlight moth's
// restore and 8 Hitpoints, 22 Prayer); in a multicombat area up to three other players within two
// tiles of the drinker who accept aid get it too. They used to do nothing when drunk.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");

const HOME = [3222, 3218];
let core;
let I;
let S;
let next = 7900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  S = core.Skill;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, dx = 0, level = 50) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("mixqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0] + dx, HOME[1], 0));
  p.needsPlacement = false;
  for (const skill of S.values()) p.getSkillManager().setMaxLevels(skill, level, false).setCurrentLevels(skill, level, false);
  const c = new ClientConnection(channel);
  c.player = p;
  const spam = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", () => sender);
  t.mock.method(sender, "sendTypedMessage", (type, message) => { if (type === core.ChatType.SPAM) spam.push(message); return sender; });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), spam, level: (skill) => p.getSkillManager().getCurrentLevel(skill) };
}

async function drink(f, slot = 0) {
  await f.c.dispatch([{ type: "inventory_action", slot, itemId: f.inv.getItems()[slot].getId(), widgetId: 3214, option: "Drink" }]);
  f.c.processTurnPackets();
}

function setLevel(f, skill, value) { f.p.getSkillManager().setCurrentLevels(skill, value, false); }
function clearDelay(f) { f.p.getTimers().cancel(core.TimerKey.POTION); f.p.getTimers().cancel(core.TimerKey.FOOD); }

test("each dose gives the mix's bonus; the second leaves the butterfly jar", async (t) => {
  const f = actor(t);
  f.inv.adds(I.RUBY_HARVEST_MIX_2_, 1);
  await drink(f);
  assert.equal(f.level(S.ATTACK), 50 + 4 + 7, "Attack 4 + 15% of 50");
  assert.equal(f.inv.getItems()[0].getId(), I.RUBY_HARVEST_MIX_1_);
  // Only the moonlight moth mix has a recorded drink (rev 241 900128); the ruby harvest mix has
  // none, so no drink line (data/potion-drink-lines.json), only the doses left.
  assert.deepEqual(f.spam, ["You have 1 dose of potion left."]);
  clearDelay(f);
  await drink(f);
  assert.equal(f.inv.getItems()[0].getId(), I.BUTTERFLY_JAR);
  assert.equal(f.spam.at(-1), "You have finished your potion.");
});

test("Defence, Strength, Hitpoints, restore and Prayer mixes", async (t) => {
  const f = actor(t);
  for (const key of ["SAPPHIRE_GLACIALIS_MIX_1_", "BLACK_WARLOCK_MIX_1_", "SNOWY_KNIGHT_MIX_1_", "SUNLIGHT_MOTH_MIX_1_", "MOONLIGHT_MOTH_MIX_1_"])
    f.inv.adds(I[key], 1);
  await drink(f, 0);
  assert.equal(f.level(S.DEFENCE), 61);
  clearDelay(f);
  await drink(f, 1);
  assert.equal(f.level(S.STRENGTH), 61);
  clearDelay(f);
  setLevel(f, S.HITPOINTS, 30);
  await drink(f, 2);
  assert.equal(f.level(S.HITPOINTS), 38, "8 Hitpoints a dose");
  clearDelay(f);
  setLevel(f, S.HITPOINTS, 30);
  setLevel(f, S.RANGED, 20);
  setLevel(f, S.PRAYER, 10);
  await drink(f, 3);
  assert.equal(f.level(S.RANGED), 20 + 6 + 6, "6 + 20% of the 30 drained");
  assert.equal(f.level(S.HITPOINTS), 38);
  assert.equal(f.level(S.PRAYER), 10, "the sunlight moth mix leaves Prayer alone");
  clearDelay(f);
  await drink(f, 4);
  assert.equal(f.level(S.PRAYER), 32, "22 Prayer points");
});

test("shares the 3-tick potion delay", async (t) => {
  const f = actor(t);
  f.inv.adds(I.SAPPHIRE_GLACIALIS_MIX_2_, 1);
  await drink(f);
  await drink(f);
  assert.equal(f.inv.getItems()[0].getId(), I.SAPPHIRE_GLACIALIS_MIX_1_, "the second click inside the delay does nothing");
  assert.equal(f.level(S.DEFENCE), 61);
});

test("no eating delay, unlike a potion (Wiki: Hunter's mix)", async (t) => {
  const f = actor(t);
  f.inv.adds(I.RUBY_HARVEST_MIX_2_, 1);
  f.inv.adds(I.ATTACK_POTION_4_, 1);
  await drink(f, 0);
  assert.equal(f.inv.getItems()[0].getId(), I.RUBY_HARVEST_MIX_1_);
  assert.ok(f.p.getTimers().has(core.TimerKey.POTION), "the 3-tick potion delay");
  assert.ok(!f.p.getTimers().has(core.TimerKey.FOOD), "food can be eaten straight after");
  clearDelay(f);
  await drink(f, 1);
  assert.ok(f.p.getTimers().has(core.TimerKey.FOOD), "a potion still holds up eating");
});

test("the chugging barrel refuses them, as it does the Hunting mix (Wiki: Chugging barrel)", async (t) => {
  const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
  for (const [itemId, stored] of [[I.RUBY_HARVEST_MIX_2_, false], [I.MOONLIGHT_MOTH_MIX_1_, false], [I.ATTACK_POTION_4_, true]]) {
    const f = actor(t);
    // Lumbridge castle's top-floor bank, so only what is used on the barrel decides.
    f.p.setLocation(new core.Location(3208, 3220, 2));
    f.inv.adds(itemId, 1);
    f.inv.adds(I.CHUGGING_BARREL, 1);
    const messages = [];
    t.mock.method(f.p, "sendMessage", (message) => messages.push(message));
    UseItemPacketListener.itemOnItem(f.p, 0, 1);
    assert.equal(f.inv.getItems()[0].getId() !== itemId, stored, `item ${itemId} ${stored ? "stored" : "kept"}`);
    if (!stored) assert.ok(messages.includes("You can't store that in the chugging barrel."), messages.join(" | "));
  }
});

test("in multicombat, up to three players within two tiles who accept aid get the bonus", async (t) => {
  const f = actor(t);
  const near = [1, 2, -2].map((dx) => actor(t, dx));
  const fourth = actor(t, -1);
  const declined = actor(t, 1);
  declined.p.setAttribute("accept-aid", false);
  const far = actor(t, 3);
  const everyone = [f, ...near, fourth, declined, far].map((a) => a.p);
  const { AreaManager: areas } = require("../dist/game/model/areas/AreaManager");
  t.mock.method(core.World, "getNearbyPlayersForUpdate", () => everyone);
  t.mock.method(areas, "inMulti", () => true);
  f.inv.adds(I.BLACK_WARLOCK_MIX_2_, 1);
  await drink(f);
  assert.equal(f.level(S.STRENGTH), 61);
  const boosted = [...near, fourth].filter((a) => a.level(S.STRENGTH) === 61).length;
  assert.equal(boosted, 3, "three of the four players in reach");
  assert.equal(declined.level(S.STRENGTH), 50);
  assert.equal(far.level(S.STRENGTH), 50);
});

test("outside multicombat only the drinker gets it", async (t) => {
  const f = actor(t);
  const other = actor(t, 1);
  t.mock.method(core.World, "getNearbyPlayersForUpdate", () => [f.p, other.p]);
  f.inv.adds(I.BLACK_WARLOCK_MIX_2_, 1);
  await drink(f);
  assert.equal(f.level(S.STRENGTH), 61);
  assert.equal(other.level(S.STRENGTH), 50);
});

test("the moonlight moth mix sends the recorded drink line before the doses left", async (t) => {
  // rsprox_transcripts/241/900128.txt ticks 12 and 15: op2 on hunter_mix_moonmoth_2dose, then
  // spam "You drink some of your potion." and the doses-left / finished line.
  const f = actor(t);
  f.inv.adds(I.MOONLIGHT_MOTH_MIX_2_, 1);
  await drink(f);
  assert.deepEqual(f.spam, ["You drink some of your potion.", "You have 1 dose of potion left."]);
  clearDelay(f);
  await drink(f);
  assert.deepEqual(f.spam.slice(2), ["You drink some of your potion.", "You have finished your potion."]);
  assert.equal(f.inv.getItems()[0].getId(), I.BUTTERFLY_JAR);
});
