// Native engine/cache regression. Run after yarn build: node --test tests/golem-crafting.test.cjs
// Setup supplies quest completion, levels, items and side positions; it does not claim a quest playthrough.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test, after } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
let core, roots, next = 5800;
const players = [];
const SIDES = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const bit = name => core.CacheDefinitions.getVarbitId(name);
const id = name => core.ItemIdentifiers[name];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init(); core.RegionManager.init();
  core.RegionManager.loadMapFiles(2596, 2257);
  roots = [1, 2].map(n => {
    const loc = core.CacheDefinitions.getLocId(`golem_station_${n}`);
    const found = [...core.MapObjects.mapObjects.values()].flat().filter(o => o.getId() === loc);
    assert.equal(found.length, 1, `one real cache station ${n}`);
    return found[0];
  });
  console.log("GOLEM_CACHE_CONTROLS", JSON.stringify(roots.map(o => ({ id: o.getId(),
    x: o.getLocation().getX(), y: o.getLocation().getY(), face: o.getFace() }))));
  PluginManager.emitServerStartup({});
});
function actor(t, { level = 60, boost = 0, quest = true, fur = "WYRMSCRAIG_GOAT_FUR" } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername(`golem${player.getIndex()}`); player.setRegistered(true);
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevels(core.Skill.CRAFTING, level, false)
    .setCurrentLevels(core.Skill.CRAFTING, level + boost, false);
  player.getPacketSender().sendVarbit(bit("ffg"), quest ? 20 : 0);
  const query = { player, key: "fallen_from_grace", complete: false };
  PluginManager.emitCustomEvent("quest:is-complete", query);
  assert.equal(query.complete, quest, "actual quest completion consumer agrees with setup");
  const inv = player.getInventory();
  for (const [name, amount] of [["CHISEL", 1], ["HAMMER", 1], ["SUNSTONE", 4], ["SUNSTONE_CORE", 1], [fur, 1]]) {
    if (name) inv.add(new core.Item(id(name), amount), false);
  }
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", message => { messages.push(message); return player.getPacketSender(); });
  players.push(player);
  position(player, 0);
  return { player, inv, messages };
}
function position(player, side, n = 1) {
  const p = roots[n - 1].getLocation(), [dx, dy] = SIDES[side];
  player.setLocation(new core.Location(p.getX() + dx, p.getY() + dy, 0));
  core.AreaManager.process(player);
}
function tick(count = 1) {
  for (let n = 0; n < count; n++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
      core.AreaManager.process(player);
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}
function click(player, n = 1) {
  const root = roots[n - 1], p = root.getLocation();
  const definition = core.ObjectDefinition.forPlayer(root.getId(), player);
  assert.ok(definition?.getInteractions()?.[0], "cache supplies a normal callable option before the action");
  new ObjectActionPacketListener().executeAction(player, definition.getId(), p.getX(), p.getY(), 1);
  core.TaskManager.processWalkTo(player.getIndex());
}
const stage = (p, n = 1) => p.getPacketSender().getVarbit(bit(`golem_crafting_station_${n}`));
function start(f) { click(f.player); assert.equal(stage(f.player), 1); }
function carve(f, side) {
  position(f.player, side); click(f.player); tick(20);
  assert.equal(f.player.getPacketSender().getVarbit(bit(`golem_1_${["north", "east", "south", "west"][side]}_progress`)), 5);
}
function shaped(f) { start(f); for (let s = 0; s < 4; s++) carve(f, s); assert.equal(stage(f.player), 5); }
const front = () => [2, 3, 0, 1][roots[0].getFace() & 3];

test("starts a reachable plinth after positive quest/cache/tool/material controls", t => {
  const f = actor(t);
  f.inv.add(new core.Item(id("SUNSTONE"), 1), false);
  assert.equal(PluginManager.emitItemOnItem({ player: f.player, usedItemId: id("CHISEL"),
    usedWithItemId: id("SUNSTONE"), handled: false }), true, "existing registered core producer handles valid input");
  assert.equal(f.inv.getAmount(id("SUNSTONE_CORE")), 2, "positive existing conversion works before absent plinth target");
  assert.equal(f.inv.getAmount(id("SUNSTONE")), 4);
  assert.ok(f.inv.contains(id("CHISEL")) && f.inv.contains(id("HAMMER")));
  assert.equal(f.player.getSkillManager().getMaxLevel(core.Skill.CRAFTING), 60);
  assert.equal(stage(f.player), 0);
  click(f.player);
  assert.equal(stage(f.player), 1, "FEATURE_ABSENCE_TARGET: ordinary Start-golem must create the player's paid base");
  assert.equal(f.inv.getAmount(id("SUNSTONE")), 0, "exactly four sunstones paid once");
  assert.ok(f.inv.contains(id("SUNSTONE_CORE")), "starting preserves the core");
});
test("four unique cardinal sides each take twenty area ticks; repetition cannot finish", t => {
  const f = actor(t); start(f); click(f.player); tick(19);
  assert.equal(stage(f.player), 1, "nineteen ticks do not finish the first side");
  tick(); assert.equal(stage(f.player), 2);
  click(f.player); tick(20); assert.equal(stage(f.player), 2);
  assert.ok(f.messages.some(s => /already shaped/.test(s)));
  for (const s of [1, 2, 3]) carve(f, s);
  assert.equal(stage(f.player), 5);
  assert.ok(f.inv.contains(id("SUNSTONE_CORE")), "shaping never spends the core");
});
test("unmet quest, unboostable level, tools and four-stone cost conserve inputs", t => {
  for (const options of [{ quest: false }, { level: 59, boost: 1 }, { remove: "CHISEL" },
    { remove: "HAMMER" }, { remove: "SUNSTONE" }]) {
    const f = actor(t, options);
    if (options.remove) f.inv.deleteNumber(id(options.remove), 1);
    const before = f.inv.getAmount(id("SUNSTONE"));
    // Below-quest cache deliberately suppresses Start-golem; dispatch only when an option exists.
    if (options.quest === false) {
      const def = core.ObjectDefinition.forPlayer(roots[0].getId(), f.player);
      assert.equal(def.getInteractions()?.[0] ?? null, null);
    } else click(f.player);
    assert.equal(stage(f.player), 0); assert.equal(f.inv.getAmount(id("SUNSTONE")), before);
  }
});
test("front-only completion consumes one core and fur, grants Crafting only, and cannot repeat", t => {
  const f = actor(t); shaped(f);
  const xp = [], skills = f.player.getSkillManager();
  t.mock.method(skills, "addExperiences", (skill, amount) => { xp.push([skill, amount]); return skills; });
  position(f.player, (front() + 1) % 4); click(f.player);
  assert.equal(stage(f.player), 5); assert.ok(f.inv.contains(id("SUNSTONE_CORE")));
  assert.ok(f.inv.contains(id("WYRMSCRAIG_GOAT_FUR"))); assert.deepEqual(xp, []);
  position(f.player, front()); click(f.player);
  assert.equal(stage(f.player), 0); assert.equal(f.inv.getAmount(id("SUNSTONE_CORE")), 0);
  assert.equal(f.inv.getAmount(id("WYRMSCRAIG_GOAT_FUR")), 0);
  assert.deepEqual(xp, [[core.Skill.CRAFTING, 2440]], "published aggregate; no Hunter reward");
  click(f.player); assert.equal(stage(f.player), 0); assert.equal(xp.length, 1);
  assert.ok(f.messages.some(s => /previous golem/.test(s)), "completed NPC holds station while active");
});
test("two players' private station transforms and progress stay independent", t => {
  const a = actor(t), b = actor(t); start(a);
  assert.equal(stage(b.player), 0); start(b); carve(a, 0);
  assert.equal(stage(a.player), 2); assert.equal(stage(b.player), 1);
});
test("movement and logout interrupt carving while paid progress survives a fresh actor", t => {
  const f = actor(t); start(f); click(f.player); tick(8);
  const saved = JSON.parse(JSON.stringify(f.player.getAttribute("golem-crafting:stations")));
  position(f.player, 1); tick(20); assert.equal(stage(f.player), 1);
  PluginManager.emitPlayerLogout({ player: f.player });
  const restored = actor(t); restored.player.setAttribute("golem-crafting:stations", saved);
  PluginManager.emitPlayerLogin({ player: restored.player });
  assert.equal(stage(restored.player), 1);
  position(restored.player, 0); click(restored.player); tick(12);
  assert.equal(stage(restored.player), 2, "two saved strokes plus three resumed strokes");
});
after(() => {
  if (core) for (const player of players) PluginManager.emitPlayerLogout({ player });
});
