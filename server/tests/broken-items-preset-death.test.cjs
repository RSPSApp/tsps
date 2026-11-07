// Run after `yarn build`: node --test tests/broken-items-preset-death.test.cjs
// A PvP death breaks an unprotected breakable untradeable and pays the killer its repair cost (Wiki: Items Kept
// on Death). A preset copy (untradeable, unbankable, preset, as Presets.PvpMode tags it) was never paid for, so
// it pays nothing: otherwise every free preset fire cape, torso or defender mints coins for the killer. Real
// engine: every plugin loaded, a real victim and killer in the Wilderness, and the real PlayerDeathTask.dropItems.
// An Ironman killer takes no other player's loot, so these death drops (and the downgraded emblem) go to the victim.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9830;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pvp" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
}

function preset(item) {
  item.setMetaValue(core.Item.UNTRADEABLE_META, true);
  item.setMetaValue(core.Item.UNBANKABLE_META, true);
  item.setMetaValue(core.Item.PRESET_META, true);
  return item;
}

const amount = (inv, id, wantPreset) => inv.getItems()
  .filter((item) => item?.getId() === id && item.isPresetItem() === wantPreset)
  .reduce((total, item) => total + item.getAmount(), 0);

const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");

/** The victim's death in level-11 Wilderness to `killer`: the coins it puts on the ground for the killer. */
function die(t, victim, killer) {
  const at = new core.Location(3100, 3600, 0);
  victim.p.setLocation(at);
  killer.p.setLocation(at);
  assert.ok(core.Wilderness.isIn(victim.p));
  // Skulled, so nothing is kept on death and every item reaches the per-item hook.
  core.CombatFactory.skull(victim.p, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  const coins = [];
  const register = core.ItemOnGroundManager.registerLocation;
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (owner, item, location, ...rest) => {
    if (item.getId() === I.COINS) coins.push([owner?.getUsername?.(), item.getAmount()]);
    return register.call(core.ItemOnGroundManager, owner, item, location, ...rest);
  });
  PlayerDeathTask.dropItems(victim.p, killer.p, at);
  return coins;
}

test("preset breakables pay the killer nothing on a PvP death", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  for (const [slot, id] of [I.FIRE_CAPE, I.FIGHTER_TORSO, I.DRAGON_DEFENDER].entries()) {
    victim.inv.setItem(slot, preset(new core.Item(id, 1)));
  }
  assert.deepEqual(die(t, victim, killer), []);
});

test("a real fire cape still pays the killer its repair cost", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  victim.inv.setItem(0, new core.Item(I.FIRE_CAPE, 1));
  assert.deepEqual(die(t, victim, killer), [[killer.p.getUsername(), 150000]]);
});

test("an Ironman killer's repair-cost coins drop for the victim instead (Ironman Mode: no other players' loot)", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  killer.p.setAttribute("ironman:mode", "ironman");
  victim.inv.setItem(0, new core.Item(I.FIRE_CAPE, 1));
  assert.deepEqual(die(t, victim, killer), [[victim.p.getUsername(), 150000]]);
});

test("an Ironman killer's downgraded emblem drops for the victim; a normal killer's for the killer", (t) => {
  for (const ironman of [false, true]) {
    const victim = actor(t);
    const killer = actor(t);
    if (ironman) killer.p.setAttribute("ironman:mode", "ironman");
    victim.inv.setItem(0, new core.Item(12750, 1)); // a tier 4 emblem: drops as tier 3
    const owners = [];
    const register = core.ItemOnGroundManager.registerNonGlobals;
    const mock = t.mock.method(core.ItemOnGroundManager, "registerNonGlobals", (owner, item, ...rest) => {
      if (item.getId() === 12749) owners.push(owner?.getUsername?.());
      return register.call(core.ItemOnGroundManager, owner, item, ...rest);
    });
    die(t, victim, killer);
    mock.mock.restore();
    assert.deepEqual(owners, [(ironman ? victim : killer).p.getUsername()], ironman ? "Ironman killer" : "normal killer");
  }
});

// One owner answer (PlayerDeathTask.lootOwner, answered by Loot.Ironman) covers every death drop a plugin makes, and
// the core's own drop of an item a hook made tradeable. Each case runs the real death order: dropItems, then the
// defeated and death hooks. `owners` maps each dropped item id to the owners it was registered for.
function deathOwners(t, victim, killer, at = new core.Location(3100, 3600, 0)) {
  victim.p.setLocation(at);
  killer.p.setLocation(at);
  core.CombatFactory.skull(victim.p, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  const owners = new Map();
  const note = (owner, item) => owners.set(item.getId(), [...(owners.get(item.getId()) ?? []), owner?.getUsername?.()]);
  for (const name of ["registerLocation", "registerNonGlobals"]) {
    const original = core.ItemOnGroundManager[name];
    t.mock.method(core.ItemOnGroundManager, name, (owner, item, ...rest) => {
      note(owner, item);
      return original.call(core.ItemOnGroundManager, owner, item, ...rest);
    });
  }
  PlayerDeathTask.dropItems(victim.p, killer.p, at);
  PM.emitPlayerDefeated(killer.p, victim.p);
  PM.emitPlayerDeath({ player: victim.p, killer: killer.p });
  return owners;
}

const ETHER = 21820;
const cases = [
  ["the looting bag's contents", (v) => {
    v.inv.setItem(0, new core.Item(22586, 1)); // an open looting bag
    const request = { player: v.p, items: [{ id: I.ABYSSAL_WHIP, amount: 1 }], result: null };
    PM.emitCustomEvent("looting-bag:store", request);
    assert.equal(request.result, "stored");
  }, () => [I.ABYSSAL_WHIP]],
  // Its hook empties the bow into the tradeable Webweaver bow (u) (27652), which the core's drop, after the hooks,
  // then drops: the bow and its ether are both loot.
  ["the emptied Webweaver bow (u) and its ether", (v) => {
    const bow = new core.Item(I.WEBWEAVER_BOW, 1);
    bow.setMetaValue("webweaver-bow:charges", 500);
    v.inv.setItem(0, bow);
  }, () => [I.WEBWEAVER_BOW_U_, ETHER]],
  ["the bracelet of ethereum and its ether", (v) => {
    const bracelet = new core.Item(21816, 1);
    bracelet.setMetaValue("charges", 200);
    v.inv.setItem(0, bracelet);
  }, () => [21817, ETHER]],
  // The ring is untradeable until its hook unimbues it: the core's own drop, after the hooks, asks the owner too.
  ["the ring of wealth (i), unimbued by its hook", (v) => {
    v.inv.setItem(0, new core.Item(12785, 1));
  }, () => [2572]],
];
for (const [name, setup, idsOf] of cases) {
  test(`an Ironman killer's PvP death drops go to the victim: ${name}; a normal killer's to the killer`, (t) => {
    for (const ironman of [false, true]) {
      const victim = actor(t), killer = actor(t);
      if (ironman) killer.p.setAttribute("ironman:mode", "ironman");
      setup(victim);
      const ids = idsOf();
      const owners = deathOwners(t, victim, killer);
      const want = (ironman ? victim : killer).p.getUsername();
      for (const id of ids) assert.deepEqual(owners.get(id), [want], `${ironman ? "Ironman" : "normal"} killer: item ${id}`);
    }
  });
}

// The imbue cost goes straight into a normal killer's pack (forceAdd); an Ironman's goes on the floor for the victim.
test("an Ironman killer doesn't get a ring of wealth (i)'s imbue coins: they drop for the victim", (t) => {
  for (const ironman of [false, true]) {
    const victim = actor(t), killer = actor(t);
    if (ironman) killer.p.setAttribute("ironman:mode", "ironman");
    victim.inv.setItem(0, new core.Item(12785, 1));
    const owners = deathOwners(t, victim, killer);
    assert.equal(killer.inv.getAmount(I.COINS), ironman ? 0 : 50000, `Ironman ${ironman}: coins in the killer's pack`);
    assert.deepEqual(owners.get(I.COINS), ironman ? [victim.p.getUsername()] : undefined, `Ironman ${ironman}: coins on the floor`);
  }
});

test("an Ironman killer's entry fees (Revenant Caves, wilderness boss caves) drop for the victim", (t) => {
  for (const ironman of [false, true]) {
    const caves = actor(t), killer = actor(t);
    if (ironman) killer.p.setAttribute("ironman:mode", "ironman");
    caves.p.setAttribute("revenant-caves:fee-paid", true);
    const inCaves = deathOwners(t, caves, killer, new core.Location(3200, 10100, 0));
    assert.deepEqual(inCaves.get(I.COINS), [(ironman ? caves : killer).p.getUsername()], `Revenant Caves, Ironman ${ironman}`);

    const boss = actor(t), bossKiller = actor(t);
    if (ironman) bossKiller.p.setAttribute("ironman:mode", "ironman");
    boss.p.setAttribute("wilderness-bosses:fee-paid", true);
    boss.p.setAttribute("wilderness-bosses:fee-amount", 50000);
    boss.p.setAttribute("wilderness-bosses:visited", true);
    const atBoss = deathOwners(t, boss, bossKiller);
    assert.deepEqual(atBoss.get(I.COINS), [(ironman ? boss : bossKiller).p.getUsername()], `boss caves, Ironman ${ironman}`);
  }
});
