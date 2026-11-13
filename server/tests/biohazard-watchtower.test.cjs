// Run after yarn build: node --test tests/biohazard-watchtower.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
let core, quest;
let index = 4600;
const WATCHTOWER = 37328;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2562, 3301);
  PluginManager.emitServerStartup({});
  quest = QuestRuntime.getRegisteredQuests().find(({ key }) => key === "biohazard");
  assert.ok(quest);
});

function actor(stage = 2, x = 2562, y = 3300, z = 0) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++);
  player.setUsername("biohazard" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, z));
  player.setNeedsPlacement(false);
  player.getPacketSender().sendMessage = () => player.getPacketSender();
  quest.setStage(player, stage);
  return player;
}
function supplies(player, feed = 2, cages = 1) {
  if (feed) player.getInventory().adds(core.ItemIdentifiers.BIRD_FEED, feed);
  if (cages) player.getInventory().adds(core.ItemIdentifiers.PIGEON_CAGE, cages);
}
function amount(player, id) { return player.getInventory().getAmount(id); }
function useFeed(player, objectId = WATCHTOWER) {
  const object = core.MapObjects.get(WATCHTOWER, new core.Location(2562, 3301, 0));
  const event = { player, object, itemId: core.ItemIdentifiers.BIRD_FEED, objectId, handled: false };
  PluginManager.emitItemOnObject(event);
  return event;
}
function tick(player, count = 8) {
  for (let i = 0; i < count; i++) {
    player.getMovementQueue().process();
    core.TaskManager.processWalkTo(player.getIndex());
    core.TaskManager.process();
  }
}

test("normal item-on-fence producer reaches the Biohazard transaction", () => {
  const player = actor();
  supplies(player);
  const feed = core.ItemIdentifiers.BIRD_FEED;
  const slot = player.getInventory().getItems().findIndex((item) => item?.getId() === feed);
  // Client packet entry point, actual map object, route and queued action.
  UseItemPacketListener.itemOnObject(player, 149, WATCHTOWER, feed, slot, 2562, 3301);
  tick(player);
  assert.equal(quest.getStage(player), 3);
  assert.equal(amount(player, feed), 1);
  assert.equal(amount(player, core.ItemIdentifiers.PIGEON_CAGE), 1);
  useFeed(player);
  assert.equal(quest.getStage(player), 3);
  assert.equal(amount(player, feed), 1, "repeated use cannot spend more feed");
});

test("feed use preserves items outside the quest stage, place or plane", () => {
  for (const setup of [[0], [1], [3], [4], [16], [2, 3200, 3200, 0], [2, 2562, 3300, 1]]) {
    const player = actor(...setup);
    supplies(player);
    useFeed(player);
    assert.equal(quest.getStage(player), setup[0]);
    assert.equal(amount(player, core.ItemIdentifiers.BIRD_FEED), 2);
    assert.equal(amount(player, core.ItemIdentifiers.PIGEON_CAGE), 1);
  }
});

test("feed on the fence outside stage 2 says Nothing interesting happens", () => {
  for (const stage of [0, 1, 3, 16]) {
    const player = actor(stage);
    supplies(player);
    const messages = [];
    player.sendMessage = (text) => messages.push(text);
    const feed = core.ItemIdentifiers.BIRD_FEED;
    const slot = player.getInventory().getItems().findIndex((item) => item?.getId() === feed);
    UseItemPacketListener.itemOnObject(player, 149, WATCHTOWER, feed, slot, 2562, 3301);
    tick(player);
    assert.deepEqual(messages, ["Nothing interesting happens."], `stage ${stage}`);
    assert.equal(quest.getStage(player), stage);
    assert.equal(amount(player, feed), 2);
  }
});

test("missing feed and unrelated objects cannot advance or consume feed", () => {
  const empty = actor();
  supplies(empty, 0, 1);
  useFeed(empty);
  assert.equal(quest.getStage(empty), 2);
  // Live throws the feed with the cage on the ground (rsprox 20261110T121228-5ab63b4, tick 181).
  const caged = actor();
  supplies(caged, 2, 0);
  useFeed(caged);
  assert.equal(quest.getStage(caged), 3);
  assert.equal(amount(caged, core.ItemIdentifiers.BIRD_FEED), 1);
  const player = actor();
  supplies(player);
  assert.equal(useFeed(player, 2068).handled, false);
  assert.equal(quest.getStage(player), 2);
  assert.equal(amount(player, core.ItemIdentifiers.BIRD_FEED), 2);
});

test("the alternative Investigate action shares the one-time feed transaction", () => {
  const player = actor();
  supplies(player);
  const object = core.MapObjects.get(WATCHTOWER, new core.Location(2562, 3301, 0));
  assert.ok(object);
  PluginManager.emitObjectInteraction({ player, object, objectId: WATCHTOWER,
    definition: core.ObjectDefinition.forId(35947), option: "Investigate", clickType: 1, location: object.getLocation(), handled: false });
  assert.equal(quest.getStage(player), 3);
  useFeed(player);
  assert.equal(amount(player, core.ItemIdentifiers.BIRD_FEED), 1);
});


test("feed use allows the normal cage action once, with plane and repeat protection", () => {
  const player = actor();
  supplies(player, 2, 2);
  const cage = core.ItemIdentifiers.PIGEON_CAGE;
  const empty = core.ItemIdentifiers.PIGEON_CAGE_2;
  const open = () => {
    const slot = player.getInventory().getItems().findIndex((item) => item?.getId() === cage);
    ItemActionPacketListener.handleAction(player, 149, cage, slot, 1, "Open");
  };
  useFeed(player);
  player.setLocation(new core.Location(2562, 3300, 1));
  open();
  assert.equal(quest.getStage(player), 3);
  assert.equal(amount(player, cage), 2);
  player.setLocation(new core.Location(2562, 3300, 0));
  open();
  assert.equal(quest.getStage(player), 4);
  assert.equal(amount(player, cage), 1);
  assert.equal(amount(player, empty), 1);
  open();
  assert.equal(amount(player, cage), 1);
  assert.equal(amount(player, empty), 1);
});

test('Biohazard keeps the HQ back door locked on both sides without claiming other doors', () => {
  for (const y of [3327, 3329]) {
    const player = actor(6, 2551, y, 0);
    player.getEquipment().setItem(core.Equipment.BODY_SLOT, new core.Item(core.ItemIdentifiers.MEDICAL_GOWN));
    const event = { player, objectId: 2036, location: { x: 2551, y: 3328, z: 0 }, handled: false };
    PluginManager.emitCustomEvent('door:toggle', event);
    assert.equal(event.handled, true);
    assert.equal(player.getLocation().getY(), y);
  }
  const player = actor(6, 2551, 3329, 1);
  const event = { player, objectId: 2036, location: { x: 2551, y: 3328, z: 1 }, handled: false };
  PluginManager.emitCustomEvent('door:toggle', event);
  assert.equal(event.handled, false);
});

test('Biohazard refuses the HQ trapdoor only during the quest, leaving it to Mourning\'s End Part I', () => {
  const at = new core.Location(2542, 3327, 0);
  const object = core.MapObjects.get(8783, at, null) ?? new core.GameObject(8783, at, 22, 0, null);
  const open = player => {
    const messages = [];
    player.getPacketSender().sendMessage = text => { messages.push(String(text)); return player.getPacketSender(); };
    const event = { player, object, objectId: 8783, location: { x: 2542, y: 3327, z: 0 }, clickType: 1, handled: false };
    PluginManager.emitObjectInteraction(event);
    return { event, messages };
  };
  const during = actor(6, 2542, 3326, 0);
  assert.equal(open(during).event.handled, true, 'the Biohazard refusal still applies mid-quest');
  const after = actor(6, 2542, 3326, 0);
  quest.complete(after);
  const mournings = QuestRuntime.getRegisteredQuests().find(({ key }) => key === 'mournings_end_part_i');
  mournings.setStage(after, 5);
  const { event, messages } = open(after);
  assert.equal(event.handled, true);
  assert.ok(messages.some(text => /full mourner disguise/.test(text)), 'Mourning\'s End Part I owns the trapdoor once Biohazard is done');
});

test('Biohazard selects the sickest mourner and inside-HQ transcripts and starts the scripted attack', () => {
  const player = actor(6, 2547, 3324, 1);
  const npcId = core.NpcIdentifiers.MOURNER_14;
  const select = id => {
    const result = PluginManager.emitNpcDialogueVariant({ player, npcId: id, pages: [{ page: 'Biohazard' }] });
    return typeof result === 'string' ? result : result?.variant;
  };
  assert.equal(select(npcId), 'infiltrating-the-mourner-hq-talking-to-sickest-mourner-upstairs');
  player.getInventory().adds(core.ItemIdentifiers.KEY_2, 1);
  assert.match(select(npcId), /while-holding-the-key$/);
  assert.match(select(core.NpcIdentifiers.MOURNER_12), /talking-to-mourner-inside-mourner-headquarters$/);
  let attacked = null;
  PluginManager.emitCustomEvent('npc-dialogue:action', {
    player, npcId, stepId: 'DQWtoR', npc: { getCombat: () => ({ attack: target => { attacked = target; } }) },
  });
  assert.equal(attacked, player);
});
