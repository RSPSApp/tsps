// Run after `yarn build`: node --test tests/grand-tree-watchtower-agility.test.cjs
// Wiki (The Grand Tree): the watchtower tree in Glough's house "requires 25 Agility to climb", boostable. The climb
// had no check at all (the quest-start one was the wrong place, and #3161 removed it), so any level climbed it. Real
// engine: every plugin loaded, a real Player, the tree's own Climb-up option.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function climb(t, agility) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9100 + agility); p.setUsername("climber" + agility); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2484, 3464, 1));
  t.after(() => p.setRegistered(false));
  p.getSkillManager().setCurrentLevels(core.Skill.AGILITY, agility, false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  const climbs = [];
  const emit = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, "emitCustomEvent", (name, event) => (name === "ladders:climbUp" ? (climbs.push(event), event) : emit(name, event)));
  const id = core.ObjectIdentifiers.TREE_13;
  const actions = core.ObjectDefinition.forId(id).getInteractions?.() ?? core.ObjectDefinition.forId(id).interactions ?? [];
  const object = new GameObject(id, new core.Location(2484, 3465, 1), 10, 0, null);
  PM.emitObjectInteraction({ player: p, object, objectId: id, clickType: actions.indexOf("Climb-up") + 1, location: object.getLocation(), handled: false });
  return { climbs, messages };
}

test("below 25 Agility the watchtower tree refuses", (t) => {
  const { climbs, messages } = climb(t, 24);
  assert.equal(climbs.length, 0, "no climb");
  assert.ok(messages.includes("You need an Agility level of 25 to climb this tree."), messages.join(" | "));
});

test("at 25 (boosted counts) it climbs", (t) => {
  const { climbs } = climb(t, 25);
  assert.equal(climbs.length, 1);
});

test("placed twigs display on the owner's pillars and restore from saved progress", (t) => {
  const { ItemIdentifiers: I, ItemOnGroundManager: ground, Location, ObjectIdentifiers: O } = core;
  const quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "grand_tree");
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  function player(name) {
    const p = new Player(new PlayerSession(channel));
    p.setUsername(name);
    p.setAttribute("bot-skip-persistence", true);
    p.setLocation(new Location(2485, 3466, 2));
    p.setRegistered(true);
    t.after(() => {
      PM.emitPlayerLogout({ player: p, username: name });
      p.setRegistered(false);
    });
    return p;
  }
  const owner = player("pillar owner");
  const other = player("pillar visitor");
  const twig = I.TWIGS;
  const tile = new Location(2485, 3467, 2);
  const pillar = new GameObject(O.PILLAR_2, tile, 10, 0, null);
  const stack = () => ground.getGroundItem(owner.getUsername(), twig, tile, null);
  const place = () => PM.emitItemOnObject({
    player: owner, object: pillar, objectId: pillar.getId(), itemId: twig, location: { x: 2485, y: 3467, z: 2 }, handled: false,
  });
  assert.equal(CacheDefinitions.getObject(pillar.getId()).supportItems, 1);
  quest.setStage(owner, 120);
  assert.equal(place(), true);
  assert.equal(stack(), null, "a stale use cannot place a missing item");
  owner.getInventory().adds(twig, 1);
  assert.equal(owner.getInventory().getAmount(twig), 1);
  assert.equal(place(), true);
  assert.equal(owner.getInventory().getAmount(twig), 0);
  const placed = stack();
  assert.ok(placed);
  assert.equal(ground.canSee(owner, placed), true);
  assert.equal(ground.canSee(other, placed), false);
  assert.equal(ground.canInteract(owner, placed, "pickup"), false);
  assert.equal(ground.canInteract(owner, placed, "telegrab"), false);
  assert.equal(placed.getTiming().expiresTick, 0);

  PM.emitPlayerLogout({ player: owner, username: owner.getUsername() });
  assert.equal(stack(), null);
  PM.emitPlayerLogin({ player: owner, username: owner.getUsername(), isNewAccount: false });
  assert.ok(stack());
  assert.notEqual(stack(), placed);
  owner.setLocation(new Location(2485, 3466, 1));
  assert.equal(stack(), null);
  owner.setLocation(new Location(2485, 3466, 2));
  assert.ok(stack());
});
