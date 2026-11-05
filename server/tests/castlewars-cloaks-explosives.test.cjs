const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { ItemActionPacketListener } = require('../dist/net/packet/impl/ItemActionPacketListener');
const { DropItemPacketListener } = require('../dist/net/packet/impl/DropItemPacketListener');
const { GameConstants } = require('../dist/game/GameConstants');
const core = PluginManager.getCoreApi();
const active = new WeakSet();
let game;
let area;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  core.RegionManager.init();
  const api = PluginManager.createApi('CastleWarsCloaksExplosivesTest');
  game = require('../plugins/minigames/castlewars/Game.CastleWars')({ ...api,
    getAreaManager: () => ({ areas: [] }), getBonusManager: () => ({ update() {} }),
    getObjectManager: () => core.ObjectManager, getRegionManager: () => core.RegionManager,
    getTaskManager: () => core.TaskManager, getWorld: () => core.World,
  });
  require('../plugins/minigames/castlewars/Areas.CastleWars')({ ...api, registerArea() {} }, game);
  area = game.gameArea;
  game.isPlaying = (p) => active.has(p);
  require('../plugins/minigames/castlewars/Explosives.CastleWars')(api, game);
  require('../plugins/minigames/castlewars/Cloaks.CastleWars')(api, game);
});

function player(t, { hp = 100, max = 100, team = game.TEAM.SARADOMIN, playing = true } = {}) {
  const p = new Player(null, new core.Location(2400, 3100, 0));
  const messages = [], graphics = [], chat = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket() {} }));
  t.mock.method(p, 'getArea', () => area);
  t.mock.method(p, 'sendMessage', (m) => messages.push(m));
  t.mock.method(p, 'forceChat', (m) => chat.push(m));
  t.mock.method(p.getPacketSender(), 'sendGlobalGraphic', (graphic, location) => { graphics.push({ graphic, location }); return p.getPacketSender(); });
  p.setRegistered(true);
  p.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, max).setCurrentLevels(core.Skill.HITPOINTS, hp);
  p.getSkillManager().setMaxLevels(core.Skill.PRAYER, 70).setCurrentLevels(core.Skill.PRAYER, 3);
  p.setRunEnergy(5);
  game.setTeamId(p, team);
  p.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(game.getTeamData(team).capeId));
  if (playing) active.add(p);
  return { p, messages, graphics, chat };
}

function surrender(p) {
  return ItemActionPacketListener.handleAction(p, core.Equipment.INVENTORY_INTERFACE_ID,
    p.getEquipment().getSlot(core.Equipment.CAPE_SLOT), core.Equipment.CAPE_SLOT, 2, 'Surrender');
}

test('dropping the Castle Wars explosive consumes that slot and hits only its owner for 15 with the cache explosion', (t) => {
  const { p, graphics, chat } = player(t);
  const { p: other } = player(t);
  t.mock.method(core.ItemOnGroundManager, 'registers', () => assert.fail('an explosive must not become a ground item'));
  t.mock.method(core.ItemOnGroundManager, 'registerGlobal', () => assert.fail('an explosive must not become a ground item'));
  p.getInventory().adds(core.ItemIdentifiers.EXPLOSIVE_POTION, 2);
  DropItemPacketListener.drop(p, core.ItemIdentifiers.EXPLOSIVE_POTION, core.Inventory.INTERFACE_ID, 1);
  assert.equal(p.getInventory().getItems()[1].getId(), -1);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.EXPLOSIVE_POTION), 1);
  assert.equal(p.getCombat().getHitQueue().getQueuedDamage(), 15);
  p.getCombat().getHitQueue().process(1000);
  assert.equal(p.getHitpoints(), 85);
  assert.equal(other.getHitpoints(), 100);
  assert.equal(graphics[0].graphic.getId(), core.CacheDefinitions.getSpotanimId('explodingvial'));
  assert.equal(graphics[0].location.equals(p.getLocation()), true);
  assert.deepEqual(chat, ['Ow!']);
});

test('repeated potion drops respawn safely with supplies retained, and leaving still removes them', (t) => {
  const { p } = player(t, { hp: 25 });
  const tasks = [];
  t.mock.method(core.TaskManager, 'submit', (task) => { tasks.push(task); });
  t.mock.method(core.ItemOnGroundManager, 'registerLocation', () => {});
  t.mock.method(GameConstants.PLAYER_PERSISTENCE, 'requestSave', () => {});
  const moves = [];
  t.mock.method(p, 'smartMoves', (bounds) => moves.push(bounds));
  p.getEquipment().setItem(core.Equipment.BODY_SLOT, new core.Item(core.ItemIdentifiers.IRON_PLATEBODY));
  game.carryFlag(p, game.TEAM.ZAMORAK);
  const I = core.ItemIdentifiers;
  const supplies = [I.BANDAGES, I.BRONZE_PICKAXE, I.BARRICADE, I.ROCK_5, I.TINDERBOX,
    I.ROPE, I.TOOLKIT_2, I.BUCKET, I.BUCKET_OF_WATER, game.data.RUNE_POUCH, ...game.data.BREW_DOSES];
  p.getInventory().adds(I.EXPLOSIVE_POTION, 3);
  for (const id of supplies) p.getInventory().adds(id, 1);
  p.getInventory().adds(I.IRON_PLATEBODY, 1);
  for (const [slot, cycle, expected] of [[0, 1001, 10], [1, 1002, 0]]) {
    DropItemPacketListener.drop(p, core.ItemIdentifiers.EXPLOSIVE_POTION, core.Inventory.INTERFACE_ID, slot);
    p.getCombat().getHitQueue().process(cycle);
    assert.equal(p.getHitpoints(), expected);
  }
  assert.equal(p.isDyingReturn(), true);
  const death = tasks.find((task) => task.constructor.name === 'PlayerDeathTask');
  assert.ok(death);
  const inventory = p.getInventory().getItems().map((item) => item.clone());
  for (let tick = 0; tick < 5; tick++) death.execute();
  assert.deepEqual(p.getInventory().getItems(), inventory, 'death retains every unconsumed supply and ordinary item');
  assert.deepEqual(moves, [game.getTeamData(game.TEAM.SARADOMIN).respawnBounds]);
  assert.equal(p.getEquipment().getSlot(core.Equipment.BODY_SLOT), core.ItemIdentifiers.IRON_PLATEBODY);
  assert.equal(game.getCarriedFlagTeam(p), null);
  assert.equal(game.flagStatus[game.TEAM.ZAMORAK], 2);
  assert.equal(p.getHitpoints(), 100);
  assert.equal(p.isDyingReturn(), false);
  game.clearCastleWarsItems(p);
  for (const id of [I.EXPLOSIVE_POTION, ...supplies]) {
    assert.equal(p.getInventory().getAmount(id), 0, 'leaving the game still removes its supplies');
  }
  assert.equal(p.getInventory().getAmount(I.IRON_PLATEBODY), 1);
  assert.equal(p.getEquipment().getSlot(core.Equipment.BODY_SLOT), I.IRON_PLATEBODY);
});

test('explosive drop policy ignores other items and players outside an active game', (t) => {
  for (const [playing, id] of [[false, core.ItemIdentifiers.EXPLOSIVE_POTION], [true, core.ItemIdentifiers.BUCKET]]) {
    const { p } = player(t, { playing });
    p.getInventory().adds(id, 1);
    const event = { player: p, itemId: id, slot: 0, dropToGround: true, handled: false };
    PluginManager.emitItemDropPolicy(event);
    assert.equal(event.handled, false);
    assert.equal(event.dropToGround, true);
    assert.equal(p.getInventory().getAmount(id), 1);
    assert.equal(p.getCombat().getHitQueue().getQueuedDamage(), 0);
  }
});

test('only HP strictly below 15 percent allows surrender, including 99 HP rounding', (t) => {
  const teleports = [];
  t.mock.method(core.TeleportHandler, 'teleport', (...args) => teleports.push(args));
  for (const [maximum, health, allowed] of [[100, 15, false], [100, 14, true], [99, 15, false], [99, 14, true], [10, 2, false], [10, 1, true]]) {
    const { p, messages } = player(t, { hp: health, max: maximum });
    const before = teleports.length;
    assert.equal(surrender(p), true);
    assert.equal(teleports.length > before, allowed, `${health}/${maximum}`);
    if (!allowed) assert.match(messages.at(-1), /below 15%/);
  }
});

test('worn cloak surrender uses the animated internal return, restores resources on arrival and drops the carried flag', (t) => {
  const { p } = player(t, { hp: 14, team: game.TEAM.ZAMORAK });
  game.carryFlag(p, game.TEAM.SARADOMIN);
  const drop = p.getLocation().clone();
  const tasks = [], moves = [];
  t.mock.method(core.TaskManager, 'submit', (task) => { tasks.push(task); task.setRunning(true); });
  t.mock.method(p, 'moveTo', (to) => { moves.push(to); p.setLocation(to); });
  p.getInventory().adds(core.ItemIdentifiers.BANDAGES, 1);
  assert.equal(surrender(p), true);
  assert.equal(game.getCarriedFlagTeam(p), null);
  assert.equal(game.getDroppedFlagObject(game.TEAM.SARADOMIN).getLocation().equals(drop), true);
  assert.equal(p.getHitpoints(), 14, 'the restore happens on arrival');
  assert.equal(p.isTeleportingReturn(), true);
  assert.equal(p.getAnimation().getId(), core.TeleportType.NORMAL.getStartAnimation().getId());
  for (let tick = 0; tick <= 3; tick++) tasks[0].execute();
  assert.equal(moves[0].equals(game.getTeamData(game.TEAM.ZAMORAK).startRoom), true);
  assert.equal(p.getHitpoints(), 100);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 70);
  assert.equal(p.getRunEnergy(), 100);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BANDAGES), 1);
  assert.equal(p.isTeleportingReturn(), false);
});

test('the team cloaks expose the Surrender worn action in the active cache', () => {
  for (const team of Object.values(game.TEAM)) {
    assert.equal(core.CacheDefinitions.getItem(game.getTeamData(team).capeId).params.get(451), 'Surrender');
  }
  assert.equal(core.CacheDefinitions.getSeqName(core.TeleportType.NORMAL.getStartAnimation().getId()), 'human_castteleport');
});

test('surrender ignores inventory spoofing, the wrong cloak, inactive games and repeated in-flight clicks', (t) => {
  const teleports = [];
  t.mock.method(core.TeleportHandler, 'teleport', (...args) => teleports.push(args));
  const { p } = player(t, { hp: 1 });
  p.getInventory().adds(game.getTeamData(game.TEAM.SARADOMIN).capeId, 1);
  ItemActionPacketListener.handleAction(p, core.Inventory.INTERFACE_ID, game.getTeamData(game.TEAM.SARADOMIN).capeId, 0, 2, 'Surrender');
  p.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(game.getTeamData(game.TEAM.ZAMORAK).capeId));
  surrender(p);
  p.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(game.getTeamData(game.TEAM.SARADOMIN).capeId));
  p.setTeleporting(true);
  surrender(p);
  p.setTeleporting(false);
  active.delete(p);
  surrender(p);
  assert.equal(teleports.length, 0);
});
