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
const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
let core, roots, fallenFromGrace, next = 1;
const players = [];
const SIDES = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const bit = name => core.CacheDefinitions.getVarbitId(name);
const id = name => core.ItemIdentifiers[name];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  const quests = require("../plugins/quests/QuestRuntime").getRegisteredQuests()
    .filter(q => q.key === "fallen_from_grace");
  assert.equal(quests.length, 1, "one actual registered Fallen From Grace quest");
  fallenFromGrace = quests[0];
  assert.equal(core.WorldDefinition.isMembersWorld(), true, "activity and item-use controls require the ordinary members world");
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
  player.setUsername(`golemtest${next++}`);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(player), true, "admit actor through the real world player list");
  assert.equal(core.World.getPlayers().get(player.getIndex()), player);
  assert.ok(player.getIndex() > 0 && player.getIndex() <= 2048);
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevels(core.Skill.CRAFTING, level, false)
    .setCurrentLevels(core.Skill.CRAFTING, level + boost, false)
    .setExperiences(core.Skill.CRAFTING, player.getSkillManager().constructor.getExperienceForLevel(level), false);
  fallenFromGrace.setStage(player, quest ? fallenFromGrace.completionValue : 0);
  assert.equal(player.getPacketSender().getVarbit(bit("ffg")), quest ? 20 : 0,
    "canonical quest setter publishes the native client stage too");
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
  AreaManager.process(player);
}
function tick(count = 1) {
  for (let n = 0; n < count; n++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
      AreaManager.process(player);
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}
function click(player, n = 1) {
  const root = roots[n - 1], p = root.getLocation();
  const definition = core.ObjectDefinition.forPlayer(root.getId(), player);
  assert.ok(definition?.getInteractions()?.[0], "cache supplies a normal callable option before the action");
  PluginManager.emitCustomEvent("player:world-input", { player,
    packet: { type: "object_option", clickType: 1, id: definition.id, x: p.getX(), y: p.getY() }, handled: false });
  new ObjectActionPacketListener().executeAction(player, definition.id, p.getX(), p.getY(), 1);
  core.TaskManager.processWalkTo(player.getIndex());
}
const stage = (p, n = 1) => p.getPacketSender().getVarbit(bit(`golem_crafting_station_${n}`));
function combine(player, first, second) {
  const inventory = player.getInventory(), a = inventory.getSlotForItemId(first), b = inventory.getSlotForItemId(second);
  assert.ok(a >= 0 && b >= 0, "real selected inventory slots exist");
  UseItemPacketListener.itemOnItem(player, a, b);
}
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
  combine(f.player, id("CHISEL"), id("SUNSTONE"));
  assert.equal(f.inv.getAmount(id("SUNSTONE_CORE")), 2, "positive existing conversion works before absent plinth target");
  assert.equal(f.inv.getAmount(id("SUNSTONE")), 4);
  assert.ok(f.inv.contains(id("CHISEL")) && f.inv.contains(id("HAMMER")));
  assert.equal(f.player.getSkillManager().getMaxLevel(core.Skill.CRAFTING), 60);
  assert.equal(f.player.busy(), false, "the ordinary action listener accepts this actor state");
  assert.ok(f.player.getHitpoints() > 0, "a live actor reaches the target");
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
test("repeated normal shaping input preserves the pending stroke deadline", t => {
  const f = actor(t); start(f);
  for (let n = 0; n < 20; n++) { click(f.player); tick(); }
  assert.equal(stage(f.player), 2, "spam clicks cannot postpone the first side forever");
});
test("unmet quest, unboostable level, tools and four-stone cost conserve inputs", t => {
  for (const options of [{ quest: false }, { level: 59, boost: 1 }, { remove: "CHISEL" },
    { remove: "HAMMER" }, { remove: "SUNSTONE" }]) {
    const f = actor(t, options);
    if (options.remove) f.inv.deleteNumber(id(options.remove), 1);
    const before = f.inv.getAmount(id("SUNSTONE"));
    // The client suppresses this menu before the quest; ObjectDefinition retains
    // the raw cache action. Send the listener input to verify the server gate too.
    click(f.player);
    if (options.quest === false) assert.ok(f.messages.some(s => /Fallen From Grace/.test(s)));
    assert.equal(stage(f.player), 0); assert.equal(f.inv.getAmount(id("SUNSTONE")), before);
  }
});
test("front-only completion consumes one core and fur, grants Crafting only, and cannot repeat", t => {
  const f = actor(t, { level: 99 }); shaped(f);
  t.mock.method(Math, "random", () => 0.5);
  const skills = f.player.getSkillManager(), crafting = skills.getExperience(core.Skill.CRAFTING),
    hunter = skills.getExperience(core.Skill.HUNTER);
  position(f.player, (front() + 1) % 4); click(f.player);
  assert.equal(stage(f.player), 5); assert.ok(f.inv.contains(id("SUNSTONE_CORE")));
  assert.ok(f.inv.contains(id("WYRMSCRAIG_GOAT_FUR")));
  assert.equal(skills.getExperience(core.Skill.CRAFTING), crafting);
  position(f.player, front()); click(f.player);
  assert.equal(stage(f.player), 0); assert.equal(f.inv.getAmount(id("SUNSTONE_CORE")), 0);
  assert.equal(f.inv.getAmount(id("WYRMSCRAIG_GOAT_FUR")), 0);
  const awarded = skills.getExperience(core.Skill.CRAFTING);
  assert.equal(awarded - crafting, 2440 * core.GameConstants.EXPERIENCE_MULTIPLIER,
    "real earned Crafting XP respects the world multiplier");
  assert.equal(skills.getExperience(core.Skill.HUNTER), hunter, "no Hunter reward");
  const gift = core.ItemOnGroundManager.getGroundItem(f.player.getUsername(), id("UNCUT_SAPPHIRE"),
    f.player.getLocation(), f.player.getPrivateArea());
  assert.ok(gift, "the ordinary reward is a real ground gift");
  assert.equal(gift.getItem().getAmount(), 1);
  click(f.player); assert.equal(stage(f.player), 0); assert.equal(skills.getExperience(core.Skill.CRAFTING), awarded);
  assert.equal(gift.getItem().getAmount(), 1, "repeat input does not duplicate the gift");
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
  restored.inv.setItems(f.inv.getItems().map(item => item.clone()));
  PluginManager.emitPlayerLogin({ player: restored.player });
  assert.equal(stage(restored.player), 1);
  position(restored.player, 0); click(restored.player); tick(12);
  assert.equal(stage(restored.player), 2, "two saved strokes plus three resumed strokes");
  assert.equal(restored.inv.getAmount(id("SUNSTONE")), 0, "recovery does not refund the paid stones");
});
test("tatty fur and a missing core cannot finish or spend another material", t => {
  const f = actor(t, { fur: "TATTY_KYATT_FUR" }); shaped(f); position(f.player, front());
  click(f.player); assert.equal(stage(f.player), 5);
  assert.ok(f.inv.contains(id("SUNSTONE_CORE")) && f.inv.contains(id("TATTY_KYATT_FUR")));
  f.inv.add(new core.Item(id("WYRMSCRAIG_GOAT_FUR"), 1), false);
  f.inv.deleteNumber(id("SUNSTONE_CORE"), 1);
  click(f.player); assert.equal(stage(f.player), 5);
  assert.ok(f.inv.contains(id("WYRMSCRAIG_GOAT_FUR")));
});
test("carried fur pouch debits real stored fur and open gem bag receives the reward", t => {
  const f = actor(t, { level: 99 });
  f.inv.add(new core.Item(id("LARGE_FUR_POUCH")), false);
  const pouch = f.inv.getItems().find(i => i.getId() === id("LARGE_FUR_POUCH"));
  const fur = f.inv.getItems().find(i => i.getId() === id("WYRMSCRAIG_GOAT_FUR"));
  combine(f.player, pouch.getId(), fur.getId());
  assert.equal(f.inv.getAmount(id("WYRMSCRAIG_GOAT_FUR")), 0, "normal pouch fill moved the fur");
  const amount = () => {
    const q = { player: f.player, itemId: id("WYRMSCRAIG_GOAT_FUR"), amount: 0 };
    PluginManager.emitCustomEvent("storage:amount", q); return q.amount;
  };
  assert.equal(amount(), 1);
  f.inv.add(new core.Item(id("OPEN_GEM_BAG")), false);
  shaped(f); position(f.player, front()); t.mock.method(Math, "random", () => 0.5); click(f.player);
  assert.equal(stage(f.player), 0); assert.equal(amount(), 0);
  const q = { player: f.player, item: f.inv.getItems().find(i => i.getId() === id("OPEN_GEM_BAG")), contents: [] };
  PluginManager.emitCustomEvent("storage:contents", q);
  assert.deepEqual(q.contents, [{ id: id("UNCUT_SAPPHIRE"), amount: 1 }]);
});
test("full inventory can finish and retains exactly one ground gift", t => {
  const f = actor(t, { level: 99 }); shaped(f);
  while (f.inv.getFreeSlots()) f.inv.add(new core.Item(id("SPADE")), false);
  assert.equal(f.inv.getFreeSlots(), 0);
  position(f.player, front()); t.mock.method(Math, "random", () => 0.5); click(f.player);
  assert.equal(stage(f.player), 0);
  assert.ok(core.ItemOnGroundManager.getGroundItem(f.player.getUsername(), id("UNCUT_SAPPHIRE"),
    f.player.getLocation(), f.player.getPrivateArea()));
  assert.equal(f.inv.getAmount(id("UNCUT_SAPPHIRE")), 0, "ground gift does not depend on free bag slots");
});
test("existing core producer refuses below sixty and gives boostable core XP", t => {
  const f = actor(t, { level: 59 });
  const use = () => combine(f.player, id("CHISEL"), id("SUNSTONE"));
  const before = f.inv.getAmount(id("SUNSTONE")), skills = f.player.getSkillManager(), xp = skills.getExperience(core.Skill.CRAFTING);
  use(); assert.equal(f.inv.getAmount(id("SUNSTONE")), before);
  skills.setCurrentLevels(core.Skill.CRAFTING, 60, false); use();
  assert.equal(f.inv.getAmount(id("SUNSTONE")), before - 1);
  assert.equal(skills.getExperience(core.Skill.CRAFTING) - xp, 10 * core.GameConstants.EXPERIENCE_MULTIPLIER);
});
test("Jeweller's chisel starts and shapes golems and makes a core", t => {
  const f = actor(t); f.inv.deleteNumber(id("CHISEL"), 1); f.inv.add(new core.Item(id("JEWELLERS_CHISEL")), false);
  f.inv.add(new core.Item(id("SUNSTONE")), false);
  combine(f.player, id("JEWELLERS_CHISEL"), id("SUNSTONE"));
  assert.equal(f.inv.getAmount(id("SUNSTONE_CORE")), 2);
  start(f); carve(f, 0); assert.equal(stage(f.player), 2);
});
test("completed personal NPC retires after thirty area ticks and releases its station", t => {
  const f = actor(t, { level: 99 }); shaped(f); position(f.player, front());
  t.mock.method(Math, "random", () => 0.5); click(f.player);
  const npc = [...core.World.getNpcs()].find(n => n.getId() === core.NpcIdentifiers.GOLEM_4 && n.getOwner() === f.player);
  assert.ok(npc?.isRegistered()); assert.equal(npc.isOwnerOnly(), true);
  tick(29); assert.equal(npc.isRegistered(), true, "not removed a tick early");
  tick(); assert.equal(npc.isRegistered(), false, "actual world NPC membership is removed at thirty ticks");
  f.inv.add(new core.Item(id("SUNSTONE"), 4), false); click(f.player);
  assert.equal(stage(f.player), 1, "the station can start the next paid golem");
});
after(() => {
  if (core) for (const player of players) {
    PluginManager.emitPlayerLogout({ player });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
    core.World.getPlayers().remove(player);
    for (const gift of core.World.getItems().filter(item => item.getOwner() === player.getUsername())) core.ItemOnGroundManager.deregister(gift);
  }
});
