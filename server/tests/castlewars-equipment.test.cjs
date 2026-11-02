const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const Game = require('../plugins/minigames/castlewars/Game.CastleWars');
const Areas = require('../plugins/minigames/castlewars/Areas.CastleWars');
const Lobby = require('../plugins/minigames/castlewars/Lobby.CastleWars');
const WaitingRoom = require('../plugins/minigames/castlewars/WaitingRoom.CastleWars');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let game, hooks, areas, prompt, lobbyObject;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  hooks = {};
  const nativeApi = PluginManager.createApi('CastleWarsEquipmentNativeTest');
  const api = {
    core,
    emitCustomEvent() {},
    getAreaManager: () => ({ areas: [], inside: (location, area) => area.getBoundaries().some((b) => b.inside(location)) }),
    getBonusManager: () => ({ update() {} }),
    getObjectManager: () => ({ register() {}, deregister() {} }),
    getRegionManager: () => core.RegionManager,
    getTaskManager: () => ({ submit() {}, cancelTasks() {} }),
    getWorld: () => core.World,
    getPluginConfig: (key, fallback) => fallback,
    onPlayerLogout: (handler) => { hooks.logout = handler; },
    onCanEquip: (handler) => { (hooks.equip ??= []).push(handler); },
    onCanUnequip: (handler) => { (hooks.unequip ??= []).push(handler); },
    onCanUseItem: (handler) => { hooks.item = handler; },
    onCanEat() {}, onCanDrink() {},
    onSpellDisabled: (handler) => { nativeApi.onSpellDisabled(handler); },
    onBeforeObjectInteraction: (handler) => { hooks.object = handler; },
    onBeforeNpcInteraction: (handler) => { hooks.npc = handler; },
    onButtonClick: (handler) => { hooks.button = handler; },
    onInterfaceActionClick() {},
    onCustomEvent: (name, handler) => { nativeApi.onCustomEvent(name, handler); },
    onServerStartup() {}, onPlayerLogin() {}, onPlayerDeath() {}, onShouldDropItemsOnDeath() {},
    registerArea: (area) => areas.push(area),
    onObjectInteraction: (handler) => { lobbyObject = handler; },
    onNpcInteraction() {},
    sendMultiChatboxPrompt: (player, title, ...pairs) => { prompt = { title, pairs }; },
  };
  game = Game(api);
  WaitingRoom(api, game);
  areas = [];
  Areas(api, game);
  Lobby(api, game);
});

function player(t, itemIds = []) {
  const p = new Player(null);
  const messages = [], hidden = [], restored = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write() {} }));
  t.mock.method(p, 'sendMessage', (line) => messages.push(line));
  t.mock.method(p.getPacketSender(), 'closeSubInterface', (uid) => { hidden.push(uid); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), 'sendTabInterface', (tab, group) => { restored.push([tab, group]); return p.getPacketSender(); });
  for (const id of itemIds) {
    const cached = core.CacheDefinitions.getItem(id);
    assert.ok(cached.wearPos >= 0, `${id} is wearable`);
    p.getEquipment().setItem(cached.wearPos, new core.Item(id, 1));
  }
  p.messages = messages;
  p.hidden = hidden;
  p.restored = restored;
  return p;
}

test('cache god-affiliation flags select the correct opposing portal form', (t) => {
  const I = core.ItemIdentifiers;
  for (const [portal, item, wanted] of [
    ['saradomin', I.ZAMORAK_FULL_HELM, 'castlewars_rabbit'],
    ['saradomin', I.GUTHIX_FULL_HELM, 'castlewars_rabbit'],
    ['zamorak', I.SARADOMIN_FULL_HELM, 'castlewars_imp'],
    ['zamorak', I.GUTHIX_FULL_HELM, 'castlewars_imp'],
    ['guthix', I.SARADOMIN_FULL_HELM, 'castlewars_sheep'],
    ['guthix', I.ZAMORAK_FULL_HELM, 'castlewars_sheep'],
  ]) {
    const p = player(t, [item]);
    game.prepareWaitingForm(p, portal);
    assert.equal(p.getNpcTransformationId(), -1, 'the lobby remains human');
    game.applyWaitingForm(p);
    assert.equal(p.getNpcTransformationId(), core.CacheDefinitions.getNpcId(wanted));
    assert.equal(game.isWaitingTransformed(p), true);
    assert.match(p.messages.at(-1), /item of another god/);
    assert.ok(p.hidden.includes((161 << 16) | 79), 'inventory is unavailable');
    assert.ok(!p.hidden.includes((161 << 16) | 89), 'music stays available');
    assert.ok(!p.hidden.includes((161 << 16) | 87), 'settings stay available');
    assert.ok(!p.hidden.includes((161 << 16) | 85), 'friends stay available for private chat');
    game.clearWaitingForm(p);
    assert.equal(p.getNpcTransformationId(), -1);
    assert.ok(p.restored.some(([tab, group]) => tab === 79 && group === 149), 'inventory is restored');
  }
});

test('same-god gear, neutral gear and god equipment only carried in inventory do not transform', (t) => {
  const I = core.ItemIdentifiers;
  for (const [portal, item] of [['saradomin', I.SARADOMIN_FULL_HELM], ['zamorak', I.ZAMORAK_FULL_HELM], ['guthix', I.GUTHIX_FULL_HELM], ['saradomin', I.RUNE_FULL_HELM]]) {
    const p = player(t, [item]);
    p.getInventory().adds(I.ZAMORAK_KITESHIELD, 1);
    game.prepareWaitingForm(p, portal);
    game.applyWaitingForm(p);
    assert.equal(p.getNpcTransformationId(), -1);
  }
});

test('the Guthix portal retains its god through the empty-lobby bot prompt', (t) => {
  const p = player(t, [core.ItemIdentifiers.SARADOMIN_FULL_HELM]);
  t.mock.method(p, 'smartMove', () => {});
  const id = core.ObjectIdentifiers.GUTHIX_PORTAL;
  lobbyObject({ player: p, object: { getId: () => id, getLocation: () => game.data.LOBBY_TELEPORT }, clickType: 1 });
  assert.ok(prompt);
  const none = prompt.pairs.indexOf('None');
  prompt.pairs[none + 1]();
  assert.equal(game.getTeamId(p), game.TEAM.ZAMORAK, 'balanced selection assigns a team');
  game.applyWaitingForm(p);
  assert.equal(p.getNpcTransformationId(), core.CacheDefinitions.getNpcId('castlewars_sheep'), 'the entry portal controls the animal');
  game.clearWaitingForm(p);
});

test('helmets and reward hoods survive team colours, death and game cleanup', (t) => {
  for (const id of [core.ItemIdentifiers.RUNE_FULL_HELM, core.ItemIdentifiers.CASTLEWARS_HOOD, core.ItemIdentifiers.CASTLEWARS_HOOD_2]) {
    const p = player(t, [id]);
    p.getInventory().adds(id, 1);
    game.equipTeamColours(p, game.TEAM.SARADOMIN);
    assert.equal(p.getEquipment().getSlot(core.Equipment.HEAD_SLOT), id);
    for (const ids of [game.data.DEATH_REMOVE_ITEM_IDS, game.data.CLEANUP_ITEM_IDS]) game.clearCastleWarsItems(p, ids);
    assert.equal(p.getEquipment().getSlot(core.Equipment.HEAD_SLOT), id);
    assert.equal(p.getInventory().getAmount(id), 1);
    assert.equal(game.data.TEAM_COLOUR_SLOTS.has(core.Equipment.HEAD_SLOT), false);
  }
});

test('transformed players cannot use items, equipment or activity buttons, but may leave by portal', (t) => {
  const p = player(t, [core.ItemIdentifiers.ZAMORAK_FULL_HELM]);
  game.prepareWaitingForm(p, 'saradomin');
  game.applyWaitingForm(p);
  for (const handler of [hooks.item, hooks.equip[0], hooks.unequip[0]]) {
    const event = { player: p, action: 'action', allow: null };
    handler(event);
    assert.equal(event.allow, false);
  }
  for (const handler of [hooks.npc, hooks.button]) {
    const event = { player: p, buttonId: (541 << 16) | 1, handled: false };
    handler(event);
    assert.equal(event.handled, true);
  }
  const exit = { player: p, object: { getId: () => [...game.data.WAITING_EXIT_IDS][0] }, handled: false };
  hooks.object(exit);
  assert.equal(exit.handled, false);
  game.clearWaitingForm(p);
  const normal = { player: p, action: 'action', allow: null };
  hooks.item(normal);
  assert.equal(normal.allow, null);
});

test('waiting-area transitions and logout clear only Castle Wars transformations', (t) => {
  const room = Object.values(game.waitingAreas)[0];
  for (const logout of [false, true]) {
    const p = player(t, [core.ItemIdentifiers.ZAMORAK_FULL_HELM]);
    game.prepareWaitingForm(p, 'saradomin');
    game.applyWaitingForm(p);
    p.setAttribute(game.TRANSITION_KEY, true);
    t.mock.method(p, 'smartMove', () => {});
    room.postLeave(p, logout);
    assert.equal(p.getNpcTransformationId(), -1);
    assert.equal(game.isWaitingTransformed(p), false);
  }
  const p = player(t, [core.ItemIdentifiers.SARADOMIN_FULL_HELM]);
  game.prepareWaitingForm(p, 'zamorak');
  game.applyWaitingForm(p);
  hooks.logout({ player: p });
  assert.equal(p.getNpcTransformationId(), -1);
  p.setNpcTransformationId(core.NpcIdentifiers.GOBLIN);
  game.clearWaitingForm(p);
  assert.equal(p.getNpcTransformationId(), core.NpcIdentifiers.GOBLIN, 'unrelated transformations are not cleared');
});

test('native widget dispatch blocks prayer, orbs and combat controls before their handlers until the transformation ends', async (t) => {
  const p = player(t, [core.ItemIdentifiers.ZAMORAK_FULL_HELM]);
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const connection = new ClientConnection(channel);
  connection.player = p;
  const input = async (packet) => connection.dispatch([packet], true);
  const widget = (uid, buttonNum = 1) => ({ type: 'widget_action', widgetId: uid, groupId: uid >>> 16, childId: uid & 65535, buttonNum });
  let quickPrayers = 0, prayers = 0, maps = 0;
  t.mock.method(p.getQuickPrayers(), 'handleWidgetAction', () => { quickPrayers++; return false; });
  t.mock.method(core.PrayerHandler, 'togglePrayer', () => { prayers++; return true; });
  t.mock.method(p.getPacketSender(), 'toggleWorldMap', () => { maps++; });
  const prayer = widget((541 << 16) | 1);
  const autoRetaliate = widget((593 << 16) | 32);
  const orbs = ['orbs:prayerbutton', 'orbs_osm:prayerbutton', 'orbs:worldmap', 'orbs_osm:worldmap']
    .map((name) => { const id = core.CacheDefinitions.getComponentId(name); assert.ok(Number.isInteger(id), name); return widget(id, 2); });
  game.prepareWaitingForm(p, 'saradomin');
  game.applyWaitingForm(p);
  p.setAutoRetaliate(false);
  for (const packet of [prayer, autoRetaliate, ...orbs, { type: 'varp_transmit', varpId: 172, value: 0 }]) await input(packet);
  assert.equal(quickPrayers, 0);
  assert.equal(prayers, 0);
  assert.equal(maps, 0);
  assert.equal(p.autoRetaliateReturn(), false);
  game.clearWaitingForm(p);
  quickPrayers = 0;
  await input(prayer);
  await input(autoRetaliate);
  await input(orbs[2]);
  assert.equal(prayers, 1, 'native prayer actions resume after leaving');
  assert.equal(p.autoRetaliateReturn(), true, 'native combat controls resume after leaving');
  assert.equal(maps, 1, 'the world map opens normally after leaving');
});

test('targeted Lunar magic cannot consume items or grant XP while transformed and resumes after leaving', async (t) => {
  const p = player(t, [core.ItemIdentifiers.ZAMORAK_FULL_HELM]);
  p.setSpellbook(core.MagicSpellbook.LUNAR);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99).setCurrentLevels(core.Skill.MAGIC, 99);
  p.getSkillManager().setMaxLevels(core.Skill.DEFENCE, 99).setCurrentLevels(core.Skill.DEFENCE, 99);
  for (const [id, amount] of [[1635, 1], [9075, 2], [556, 5], [563, 1]]) p.getInventory().adds(id, amount);
  const spell = core.CacheDefinitions.getSpellByName('String Jewellery');
  assert.ok(spell);
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const connection = new ClientConnection(channel);
  connection.player = p;
  const packet = { type: 'widget_target', sourceWidgetId: spell.widgetId, sourceItemId: spell.itemId,
    sourceSlot: -1, targetWidgetId: 149 << 16, targetItemId: 1635, targetSlot: 0 };
  const amounts = () => [1635, 1656, 9075, 556, 563].map((id) => p.getInventory().getAmount(id));
  const xp = p.getSkillManager().getExperience(core.Skill.MAGIC);
  game.prepareWaitingForm(p, 'saradomin');
  game.applyWaitingForm(p);
  await connection.dispatch([packet], true);
  assert.deepEqual(amounts(), [1, 0, 2, 5, 1]);
  assert.equal(p.getSkillManager().getExperience(core.Skill.MAGIC), xp);
  assert.match(p.messages.at(-1), /transformed/);
  game.clearWaitingForm(p);
  await connection.dispatch([packet], true);
  assert.deepEqual(amounts(), [0, 1, 0, 0, 0]);
  assert.equal(p.getSkillManager().getExperience(core.Skill.MAGIC), xp + 83);
});
