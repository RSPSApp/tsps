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
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
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
  core.RegionManager.loadMapFiles(2551, 3325); // Mourner Headquarters
  core.RegionManager.loadMapFiles(2556, 3267); // the rope-ladder wall
  core.RegionManager.loadMapFiles(2571, 3295); // Ardougne Castle
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

test("missing supplies and unrelated objects cannot advance or consume feed", () => {
  for (const [feed, cages] of [[0, 1], [2, 0]]) {
    const player = actor();
    supplies(player, feed, cages);
    useFeed(player);
    assert.equal(quest.getStage(player), 2);
    assert.equal(amount(player, core.ItemIdentifiers.BIRD_FEED), feed);
  }
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

/** Clicks an object's first option the way the client packet does, then runs the world for a few ticks. */
function click(player, id, x, y, ticks = 6) {
  new ObjectActionPacketListener().executeAction(player, id, x, y, 1);
  tick(player, ticks);
}
function at(player) { const l = player.getLocation(); return [l.getX(), l.getY(), l.getZ()]; }
function messages(player) {
  const sent = [];
  player.getPacketSender().sendMessage = text => { sent.push(String(text)); return player.getPacketSender(); };
  return sent;
}
function wearGown(player) {
  player.getEquipment().setItem(core.Equipment.BODY_SLOT, new core.Item(core.ItemIdentifiers.MEDICAL_GOWN));
}
function idsAt(x, y, z) {
  return core.MapObjects.getObjectsAt(new core.Location(x, y, z), null).map(object => object.getId());
}

test('opening the pigeon cage launches three biopigeon_launch projectiles at the watchtower', () => {
  const player = actor(3, 2562, 3300, 0);
  supplies(player, 0, 1);
  const sent = [];
  const original = core.Projectile.prototype.sendProjectile;
  core.Projectile.prototype.sendProjectile = function () { sent.push(this); };
  try {
    const cage = core.ItemIdentifiers.PIGEON_CAGE;
    const slot = player.getInventory().getItems().findIndex(item => item?.getId() === cage);
    ItemActionPacketListener.handleAction(player, 149, cage, slot, 1, "Open");
  } finally { core.Projectile.prototype.sendProjectile = original; }
  assert.equal(quest.getStage(player), 4);
  assert.deepEqual(sent.map(p => [p.projectileId, p.end.getX(), p.end.getY(), p.delay, p.startHeight, p.endHeight]),
    [[72, 2559, 3303, 25, 16, 130], [72, 2560, 3304, 15, 16, 130], [72, 2561, 3305, 5, 16, 130]]);
  // flight = delay + length + 20 cycles per tile from 2562,3300
  assert.deepEqual(sent.map(p => p.speed), [25 + 21 + 60, 15 + 31 + 80, 5 + 41 + 100]);
  assert.ok(sent.every(p => p.start.getX() === 2562 && p.start.getY() === 3300));
});

test('the pigeons stay put, with no projectiles, before the feed is thrown', () => {
  const player = actor(2, 2562, 3300, 0);
  supplies(player, 0, 1);
  const sent = [];
  const original = core.Projectile.prototype.sendProjectile;
  core.Projectile.prototype.sendProjectile = function () { sent.push(this); };
  try {
    const cage = core.ItemIdentifiers.PIGEON_CAGE;
    const slot = player.getInventory().getItems().findIndex(item => item?.getId() === cage);
    ItemActionPacketListener.handleAction(player, 149, cage, slot, 1, "Open");
  } finally { core.Projectile.prototype.sendProjectile = original; }
  assert.equal(sent.length, 0);
});

test("Omart's and Kilron's rope ladder drops the player on the tile beside the wall", () => {
  const player = actor(4, 2559, 3266, 0);
  PluginManager.emitCustomEvent("npc-dialogue:action", { player, npcId: core.NpcIdentifiers.OMART, stepId: "v1MvBF" });
  assert.deepEqual(at(player), [2556, 3267, 0]);
  assert.equal(quest.getStage(player), 5);
  PluginManager.emitCustomEvent("npc-dialogue:action", { player, npcId: core.NpcIdentifiers.KILRON, stepId: "PIRzeQ" });
  assert.deepEqual(at(player), [2559, 3267, 0]);
});

test('squeezing through the Mourner HQ fence is a forced walk across its edge, both ways', () => {
  for (const [from, start, end] of [[[2540, 3331], [2541, 3331], [2542, 3331]], [[2541, 3331], [2541, 3331], [2542, 3331]],
    [[2542, 3331], [2542, 3331], [2541, 3331]]]) {
    const player = actor(5, from[0], from[1], 0);
    new ObjectActionPacketListener().executeAction(player, 2068, 2541, 3331, 1);
    let movement = null;
    for (let i = 0; i < 4 && !movement; i++) { tick(player, 1); movement = player.getForceMovement(); }
    assert.ok(movement, `a forced movement plays from ${from}`);
    assert.deepEqual([movement.getStart().getX(), movement.getStart().getY()], start);
    assert.equal(movement.getEnd().getX(), end[0] - start[0]);
    assert.equal(movement.getAnimation(), 819);
    tick(player, 3);
    assert.deepEqual(at(player), [...end, 0]);
  }
});

test('the Mourner HQ front door lets a gowned player through after the stew, and stays shut otherwise', () => {
  const gowned = actor(6, 2551, 3319, 0);
  wearGown(gowned);
  click(gowned, 2036, 2551, 3320);
  assert.deepEqual(at(gowned), [2551, 3321, 0], 'the gown opens the door and the player walks in');
  assert.ok(idsAt(2551, 3320, 0).includes(2036), 'the door is shut again behind them');
  click(gowned, 2036, 2551, 3320);
  assert.deepEqual(at(gowned), [2551, 3320, 0], 'and they can walk back out');

  const plain = actor(6, 2551, 3319, 0);
  const sent = messages(plain);
  click(plain, 2036, 2551, 3320);
  assert.deepEqual(at(plain), [2551, 3320, 0]);
  assert.ok(sent.some(text => /medical gown/.test(text)));
});

test('the upstairs Mourner HQ door opens both ways', () => {
  const player = actor(7, 2546, 3325, 1);
  wearGown(player);
  click(player, 2034, 2547, 3325);
  assert.deepEqual(at(player), [2547, 3325, 1]);
  click(player, 2034, 2547, 3325);
  assert.deepEqual(at(player), [2546, 3325, 1]);
  assert.ok(idsAt(2547, 3325, 1).includes(2034));
});

test('the upstairs cage gate opens with the key carried or used on it, and always lets the player out', () => {
  const keyed = actor(6, 2550, 3325, 1);
  wearGown(keyed);
  keyed.getInventory().adds(core.ItemIdentifiers.KEY_2, 1);
  const sent = messages(keyed);
  click(keyed, 2060, 2551, 3325);
  assert.deepEqual(at(keyed), [2552, 3325, 1]);
  assert.deepEqual(sent, ['You use the key to open the gate.']);
  assert.ok(idsAt(2551, 3325, 1).includes(2060) && idsAt(2551, 3326, 1).includes(2058), 'both leaves shut again');

  const locked = actor(6, 2550, 3326, 1);
  const refused = messages(locked);
  click(locked, 2058, 2551, 3326);
  assert.deepEqual(at(locked), [2551, 3326, 1]);
  assert.deepEqual(refused, ['The gate is locked. You need a key.']);

  const inside = actor(6, 2552, 3326, 1);
  click(inside, 2058, 2551, 3326);
  assert.deepEqual(at(inside), [2551, 3326, 1], 'leaving the cage needs no key');

  const user = actor(6, 2551, 3325, 1);
  user.getInventory().adds(core.ItemIdentifiers.KEY_2, 1);
  const gate = core.MapObjects.get(2060, new core.Location(2551, 3325, 1), null);
  const event = { player: user, object: gate, itemId: core.ItemIdentifiers.KEY_2, objectId: 2060, handled: false };
  PluginManager.emitItemOnObject(event);
  tick(user, 4);
  assert.equal(event.handled, true);
  assert.deepEqual(at(user), [2552, 3325, 1], 'using the key on the gate opens it too');
});

test('Ardougne Castle main staircase climbs from its north foot to the landing upstairs and back', () => {
  const player = actor(0, 2571, 3300, 0);
  click(player, 15645, 2571, 3295);
  assert.deepEqual(at(player), [2571, 3294, 1]);
  const upstairs = actor(0, 2571, 3294, 1);
  click(upstairs, 15648, 2571, 3295);
  assert.deepEqual(at(upstairs), [2571, 3298, 0]);
  const behind = actor(0, 2569, 3293, 0);
  click(behind, 15645, 2571, 3295);
  assert.equal(at(behind)[2], 0, 'the staircase cannot be climbed through the castle wall');
});
