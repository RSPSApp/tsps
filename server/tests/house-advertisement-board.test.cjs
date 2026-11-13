// The house advertisement board: advertising, the listing rows, removal and entering from a row.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
const { StatementDialogue } = require('../dist/game/model/dialogues/entries/impl/StatementDialogue');

const ROW_SCRIPT = 3110;
const YANILLE = 6;
let core, House, api, boardId, boardGroup, advertisingVarbit, locationVarbit;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi('HouseAdvertisementBoardTest');
  require('../plugins/skills/construction/Core.Construction').init(api);
  House = require('../plugins/skills/construction/House.Construction');
  House.attach(api);
  boardId = core.CacheDefinitions.getLocId('poh_board_yanille');
  boardGroup = core.CacheDefinitions.getInterfaceId('poh_board');
  advertisingVarbit = core.CacheDefinitions.getVarbitId('poh_board_advertising');
  locationVarbit = core.CacheDefinitions.getVarbitId('poh_board_last_loc');
});

function actor(t, username, { level = 99, location = YANILLE } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setUsername(username);
  player.setAttribute('bot-skip-persistence', true);
  player.getSkillManager().setMaxLevels(core.Skill.CONSTRUCTION, level, false)
    .setExperiences(core.Skill.CONSTRUCTION, core.SkillManager.getExperienceForLevel(level), false)
    .setCurrentLevel(core.Skill.CONSTRUCTION, level, false);
  const save = require('../plugins/skills/construction/Instance.Construction').createDefaultHouseSave();
  save.location = location;
  player.setAttribute('construction:house', save);
  const sender = player.getPacketSender(), scripts = [], varbits = new Map(), messages = [];
  t.mock.method(sender, 'sendClientScript', (id, ...args) => { scripts.push([id, ...args]); return sender; });
  t.mock.method(sender, 'sendVarbit', (id, value) => { varbits.set(id, value); return sender; });
  t.mock.method(player, 'sendMessage', (text) => { messages.push(text); });
  t.after(() => {
    try { PluginManager.emitPlayerLogout({ player, username: player.getUsername() }); } finally { core.World.getPlayers().remove(player); }
  });
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  return { player, scripts, varbits, messages, connection };
}

function boardClick(player, clickType) {
  const location = new core.Location(2544, 3096, 0);
  const object = new GameObject(boardId, location, 10, 0, null);
  const definition = ObjectDefinition.forPlayer(boardId, player) ?? ObjectDefinition.forId(boardId);
  assert.equal(PluginManager.emitObjectInteraction({ player, object, definition, objectId: boardId,
    clickType, location: { x: 2544, y: 3096, z: 0 }, handled: false }), true);
}

function boardButton(player, componentName) {
  const uid = core.CacheDefinitions.getComponentId(`poh_board:${componentName}`);
  assert.equal(PluginManager.emitInterfaceActionClick({ player, buttonId: uid, groupId: boardGroup, childId: uid & 0xffff,
    action: 1, slot: -1, itemId: -1, handled: false }), true);
}

function question(player) {
  const current = player.getDialogueManager().getCurrent();
  assert.ok(current instanceof OptionDialogue, 'a question is open');
  return [current.getTitle(), current.getOptions().join('|')];
}

function messageBox(player) {
  const current = player.getDialogueManager().getCurrent();
  assert.ok(current instanceof StatementDialogue, 'a message box is open');
  return current.getText();
}

function advertise(who) {
  boardClick(who.player, 2);
  assert.deepEqual(question(who.player), ['Advertise your house on the board?', 'Yes.|No.']);
  who.player.getDialogueManager().handleOption(1);
}

/** The rows of the last board load: [row, text, board location]. */
function rows(who) {
  const sent = who.scripts.filter(([id]) => id === ROW_SCRIPT);
  return sent.slice(-200).map(([, row, text, location]) => [row, text, location]);
}

test('advertising asks first, then lists the house with the recorded row format', (t) => {
  const owner = actor(t, 'advowner');
  advertise(owner);
  assert.equal(owner.varbits.get(advertisingVarbit), 1);
  assert.deepEqual(owner.messages, ['Your house is now being advertised on the noticeboard.']);
  assert.equal(messageBox(owner.player), 'Your house is now being advertised on the noticeboard for the next 30 minutes. If your house is closed or you log off, your advert will be removed.');
  assert.equal(House.houseFor(owner.player), null, 'advertising does not take the owner into the house');

  const viewer = actor(t, 'advviewer');
  boardClick(viewer.player, 1);
  assert.equal(viewer.player.getInterfaceId(), boardGroup);
  assert.equal(viewer.varbits.get(locationVarbit), YANILLE);
  const listed = rows(viewer);
  assert.equal(listed.length, 200);
  assert.deepEqual(listed.map(([row]) => row), Array.from({ length: 200 }, (_, i) => i + 1));
  assert.match(listed[0][1], /^advowner\|6\|99\|N\|0\|0\|0\|0\|N\|\d+\|$/);
  assert.equal(listed[0][2], YANILLE);
  assert.ok(listed.slice(1).every(([, text, location]) => text === '' && location === YANILLE));
});

test('houses from other towns are listed too', (t) => {
  const owner = actor(t, 'rimowner', { location: 1 });
  advertise(owner);
  const viewer = actor(t, 'rimviewer');
  boardClick(viewer.player, 1);
  assert.ok(rows(viewer).some(([, text]) => text.startsWith('rimowner|1|')));
});

test('advertising again within 30 minutes is refused', (t) => {
  const owner = actor(t, 'advagain');
  advertise(owner);
  boardClick(owner.player, 1);
  boardButton(owner.player, 'addremove');
  owner.player.getDialogueManager().handleOption(1); // Remove your advert? Yes.
  boardClick(owner.player, 2);
  assert.equal(messageBox(owner.player), 'You can only advertise once every 30 minutes. You have 30 minutes(s) before you can advertise again.');
});

test('Add/Remove House removes the advert and reopens the board', (t) => {
  const owner = actor(t, 'advremove');
  advertise(owner);
  boardClick(owner.player, 1);
  assert.ok(rows(owner).some(([, text]) => text.startsWith('advremove|')));
  boardButton(owner.player, 'addremove');
  assert.equal(owner.varbits.get(locationVarbit), 0);
  assert.deepEqual(question(owner.player), ['Remove your advert?', 'Yes.|No.']);
  owner.player.getDialogueManager().handleOption(1);
  assert.equal(owner.varbits.get(advertisingVarbit), 0);
  assert.equal(owner.messages.at(-1), 'Your house is no longer being advertised.');
  assert.equal(owner.player.getInterfaceId(), boardGroup);
  assert.equal(owner.varbits.get(locationVarbit), YANILLE);
  assert.ok(rows(owner).every(([, text]) => !text.startsWith('advremove|')));
});

test('Add/Remove House without an advert asks to advertise', (t) => {
  const owner = actor(t, 'advbutton');
  boardClick(owner.player, 1);
  boardButton(owner.player, 'addremove');
  assert.equal(owner.varbits.get(locationVarbit), 0);
  assert.deepEqual(question(owner.player), ['Advertise your house on the board?', 'Yes.|No.']);
  owner.player.getDialogueManager().handleOption(2);
  assert.equal(owner.varbits.get(advertisingVarbit), undefined);
});

test('a Construction level under 50 cannot advertise', (t) => {
  const owner = actor(t, 'advlow', { level: 49 });
  advertise(owner);
  assert.equal(owner.varbits.get(advertisingVarbit), undefined);
  const viewer = actor(t, 'advlowview');
  boardClick(viewer.player, 1);
  assert.ok(rows(viewer).every(([, text]) => !text.startsWith('advlow|')));
});

test('the advert stays while the owner comes and goes, and ends when they log out', (t) => {
  const owner = actor(t, 'advleave');
  advertise(owner);
  House.enterHouse(owner.player, false);
  assert.ok(House.houseFor(owner.player));
  House.releaseHouse(owner.player, true);
  const viewer = actor(t, 'advleaveview');
  boardClick(viewer.player, 1);
  assert.ok(rows(viewer).some(([, text]) => text.startsWith('advleave|')));
  PluginManager.emitPlayerLogout({ player: owner.player, username: owner.player.getUsername() });
  assert.equal(owner.varbits.get(advertisingVarbit), 0);
  boardButton(viewer.player, 'refresh_button');
  assert.ok(rows(viewer).every(([, text]) => !text.startsWith('advleave|')));
});

test('the advert ends after 30 minutes', (t) => {
  const owner = actor(t, 'advexpire');
  advertise(owner);
  for (let tick = 0; tick < 2999; tick++) core.TaskManager.process();
  assert.equal(owner.varbits.get(advertisingVarbit), 1);
  for (let tick = 0; tick < 2; tick++) core.TaskManager.process();
  assert.equal(owner.varbits.get(advertisingVarbit), 0);
});

test('entering from a row visits that house', async (t) => {
  const owner = actor(t, 'advhost');
  advertise(owner);
  House.enterHouse(owner.player, false);
  const house = House.houseFor(owner.player);
  const viewer = actor(t, 'advguest');
  boardClick(viewer.player, 1);
  await viewer.connection.dispatch([{ type: 'dialogue_input', value: 'advhost' }]);
  viewer.connection.processTurnPackets();
  for (let tick = 0; tick < 3; tick++) core.TaskManager.process();
  assert.equal(House.houseFor(viewer.player), house);
});

test('a guest can enter an advertised house its owner has not opened', async (t) => {
  const owner = actor(t, 'advaway');
  advertise(owner);
  assert.equal(House.houseFor(owner.player), null);
  const guest = actor(t, 'advawayguest');
  await enterRow(guest, 'advaway');
  const house = House.houseFor(guest.player);
  assert.ok(house, 'the guest is in a house');
  assert.equal(house.owner, owner.player);
  assert.equal(House.houseFor(owner.player), null, 'the owner stays where they were');
  assert.deepEqual(guest.messages, []);
});

async function enterRow(who, name) {
  boardClick(who.player, 1);
  assert.ok(rows(who).some(([, text]) => text.startsWith(`${name}|`)), `${name} is listed`);
  await who.connection.dispatch([{ type: 'dialogue_input', value: name }]);
  who.connection.processTurnPackets();
  for (let tick = 0; tick < 3; tick++) core.TaskManager.process();
}

function exitPortalClick(player, clickType) {
  const id = core.CacheDefinitions.getLocId('poh_exit_portal');
  const object = new GameObject(id, player.getLocation(), 10, 0, null);
  const definition = ObjectDefinition.forId(id);
  PluginManager.emitObjectInteraction({ player, object, definition, objectId: id, clickType,
    location: { x: player.getLocation().getX(), y: player.getLocation().getY(), z: player.getLocation().getZ() }, handled: false });
}

test('a locked house stays listed but cannot be entered', async (t) => {
  const owner = actor(t, 'advlocked');
  advertise(owner);
  House.enterHouse(owner.player, false);
  const house = House.houseFor(owner.player);
  exitPortalClick(owner.player, 2); // Lock
  assert.equal(house.save.locked, true);
  assert.equal(owner.varbits.get(advertisingVarbit), 1, 'locking keeps the advert');
  const viewer = actor(t, 'advlockview');
  await enterRow(viewer, 'advlocked');
  assert.equal(House.houseFor(viewer.player), null);
  assert.deepEqual(viewer.messages, ['advlocked has locked his house to visitors.']);
});

test("a house whose owner's privacy shuts the viewer out stays listed but cannot be entered", async (t) => {
  const owner = actor(t, 'advprivate');
  advertise(owner);
  House.enterHouse(owner.player, false);
  owner.player.getRelations().setChatModes(0, 2, 0); // private chat off
  const viewer = actor(t, 'advprivview');
  await enterRow(viewer, 'advprivate');
  assert.equal(House.houseFor(viewer.player), null);
  assert.deepEqual(viewer.messages, ['That player is offline, or has privacy mode enabled.']);
});

test('Visit-Last before visiting anyone', (t) => {
  const player = actor(t, 'advnolast');
  boardClick(player.player, 3);
  assert.deepEqual(player.messages, ["You haven't visited anyone this session."]);
});
