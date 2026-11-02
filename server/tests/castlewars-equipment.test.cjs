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

test('an observer gets fresh flag, weapon and movement appearance when a player re-enters view', (t) => {
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { createPlayerSyncState } = require('../dist/net/protocol/ClientProtocol');
  const observer = new PlayerSession(null), p = player(t, [core.ItemIdentifiers.VERACS_FLAIL]);
  p.setIndex(2); p.setUsername("cwappearance");
  observer.playerSyncState = createPlayerSyncState(1, { x: 2400, y: 3100, level: 0 });
  observer.playerSyncState.lastTiles.set(2, { x: 2401, y: 3100, level: 0 });
  const first = observer.createPlayerView(p).appearance;
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.SARADOMIN_BANNER));
  p.getUpdateFlag().reset();
  assert.equal(observer.createPlayerView(p).appearance, first, 'known unchanged players reuse the cached payload');
  observer.playerSyncState.lastTiles.delete(2);
  const returned = observer.createPlayerView(p);
  assert.equal(returned.appearanceDirty, true);
  assert.notDeepEqual(returned.appearance, first, 'newly visible players encode current gear and stance');
});

test('Lanthus accepts noted bracelets with confirmation, persists charges, and consumes one per match', (t) => {
  let use, choice;
  const defaults = new Map(), countdowns = [];
  const api = {
    ...PluginManager.createApi('CastleWarsBraceletTest'),
    getAreaManager: () => ({ areas: [] }), getBonusManager: () => ({ update() {} }),
    getObjectManager: () => ({ register() {}, deregister() {} }), getRegionManager: () => core.RegionManager,
    getTaskManager: () => ({ submit(task) { if (task.onComplete) countdowns.push(task); }, cancelTasks() {} }), getWorld: () => core.World,
    emitCustomEvent() {}, persistAttribute: (key, value) => defaults.set(key, value),
    onItemOnNpc: handler => { use = handler; },
    sendMultiChatboxPrompt: (_p, _title, ...pairs) => { choice = pairs; },
  };
  const match = Game(api);
  require('../plugins/minigames/castlewars/Bracelet.CastleWars')(api, match);
  const p = player(t, [core.ItemIdentifiers.CASTLE_WARS_BRACELET_3_]), opponent = player(t);
  const noted = core.ItemDefinition.forId(core.ItemIdentifiers.CASTLE_WARS_BRACELET_3_).getNoteId();
  p.getInventory().adds(noted, 2);
  const event = { player: p, target: { getCurrentDefinition: () => ({ getName: () => 'Lanthus' }) }, itemId: noted };
  use(event);
  assert.equal(event.handled, true);
  assert.equal(p.getInventory().getAmount(noted), 2, 'prompt has not consumed anything');
  choice[1]();
  assert.equal(p.getInventory().getAmount(noted), 0);
  assert.equal(p.getAttribute('castlewars:bracelet-charges'), 6);
  assert.equal(defaults.get('castlewars:bracelet-charges'), 0);
  assert.equal(defaults.get('castlewars:bracelet-auto-charge'), true);
  t.mock.method(p, 'smartMove', () => {}); t.mock.method(opponent, 'smartMove', () => {});
  match.waitingAreas = {
    [match.TEAM.SARADOMIN]: { getPlayers: () => [p] },
    [match.TEAM.ZAMORAK]: { getPlayers: () => [opponent] },
  };
  match.gameArea = { getPlayers: () => [] }; match.lobbyArea = { getPlayers: () => [] };
  match.beginStartCountdown(); countdowns.at(-1).execute();
  assert.equal(p.getAttribute('castlewars:bracelet-charges'), 5);
  assert.equal(match.hasBraceletEffect(p), true);
  assert.equal(p.getEquipment().getSlot(core.Equipment.HANDS_SLOT), core.ItemIdentifiers.CASTLE_WARS_BRACELET_3_, 'only one charge source is spent');
  // Issue 1929: the game start says the bracelet took effect.
  assert.deepEqual(p.messages.slice(-2), [
    "Your Castle wars bracelet is active for this game: you deal 20% more damage to whoever carries your team's standard.",
    'Lanthus used one of your stored bracelet charges. 5 charges left.',
  ]);
  assert.equal(opponent.messages.some((line) => /bracelet/.test(line)), false, 'no bracelet, no message');
  match.showBraceletCharges(p); choice[1]();
  match.clearBraceletEffect(p); countdowns[0].onComplete();
  assert.equal(p.getAttribute('castlewars:bracelet-charges'), 5, 'disabled stored charges remain');
  assert.equal(p.getEquipment().getSlot(core.Equipment.HANDS_SLOT), core.ItemIdentifiers.CASTLE_WARS_BRACELET_2_);
  assert.equal(match.hasBraceletEffect(p), true, 'a worn bracelet still works');
  assert.equal(p.messages.at(-1), 'Your Castle wars bracelet has 2 charges left.');
});

test('a worn bracelet on its last charge crumbles at the game start, with a message', (t) => {
  const countdowns = [];
  const api = {
    ...PluginManager.createApi('CastleWarsBraceletCrumbleTest'),
    getAreaManager: () => ({ areas: [] }), getBonusManager: () => ({ update() {} }),
    getObjectManager: () => ({ register() {}, deregister() {} }), getRegionManager: () => core.RegionManager,
    getTaskManager: () => ({ submit(task) { if (task.onComplete) countdowns.push(task); }, cancelTasks() {} }), getWorld: () => core.World,
    emitCustomEvent() {},
  };
  const match = Game(api);
  const p = player(t, [core.ItemIdentifiers.CASTLE_WARS_BRACELET_1_]), opponent = player(t);
  t.mock.method(p, 'smartMove', () => {}); t.mock.method(opponent, 'smartMove', () => {});
  match.waitingAreas = {
    [match.TEAM.SARADOMIN]: { getPlayers: () => [p] },
    [match.TEAM.ZAMORAK]: { getPlayers: () => [opponent] },
  };
  match.gameArea = { getPlayers: () => [] }; match.lobbyArea = { getPlayers: () => [] };
  match.endGame(); // the match phase is module state, left running by the test above
  match.beginStartCountdown(); countdowns.at(-1).execute();
  assert.equal(p.getEquipment().getSlot(core.Equipment.HANDS_SLOT), -1);
  assert.equal(match.hasBraceletEffect(p), true);
  assert.equal(p.messages.at(-1), 'Your Castle wars bracelet crumbles to dust.');
});

test('bandages heal 10%, restore 30% run, and apply the patient bracelet bonus once before rounding', (t) => {
  let heal, teammate;
  const healer = player(t), patient = player(t);
  const match = { isPlaying: () => true, getTeamId: () => 'sara', hasBraceletEffect: p => p === patient };
  const api = { core, onItemAction: (_name, actions) => { heal = actions.Heal; }, onItemOnPlayer: fn => { teammate = fn; } };
  require('../plugins/minigames/castlewars/Bandages.CastleWars')(api, match);
  for (const p of [healer, patient]) {
    p.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, 99).setCurrentLevels(core.Skill.HITPOINTS, 40);
    p.setRunEnergy(25); p.setPoisonDamage(6);
  }
  healer.getInventory().adds(core.ItemIdentifiers.BANDAGES, 2);
  assert.equal(heal({ player: healer, itemId: 25730 }), false, 'Theatre of Blood bandages belong to their own handler');
  assert.equal(healer.getHitpoints(), 40);
  assert.equal(healer.getInventory().getAmount(core.ItemIdentifiers.BANDAGES), 2);
  heal({ player: healer, itemId: core.ItemIdentifiers.BANDAGES });
  assert.equal(healer.getHitpoints(), 49); assert.equal(healer.getRunEnergy(), 55);
  assert.equal(healer.getPoisonDamage(), 0);
  teammate({ player: healer, target: patient, itemId: core.ItemIdentifiers.BANDAGES });
  assert.equal(patient.getHitpoints(), 54, 'the bracelet belongs to the recipient');
  assert.equal(patient.getRunEnergy(), 55); assert.equal(patient.getPoisonDamage(), 0);
});

test('native Castle Wars supplies work with production plugin ordering and the canonical Lanthus morph', async (t) => {
  const path = require('node:path');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const modulePath = require.resolve('../plugins/minigames/castlewars/Game.CastleWars');
  let match;
  require.cache[modulePath].exports = (api) => (match = Game(api));
  const bots = process.env.DISABLE_PLAYER_BOTS;
  process.env.DISABLE_PLAYER_BOTS = '1';
  try {
    // Preserve production content ordering without spawning unrelated background bots.
    PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  } finally {
    require.cache[modulePath].exports = Game;
    if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = bots;
  }
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2441, 3089);
  core.RegionManager.loadMapFiles(2426, 3076);
  match.endGame();
  const actors = [];
  function actor() {
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel);
    const p = new Player(session, new core.Location(2440, 3089, 0));
    session.setPlayer(p);
    p.setIndex(1900 + actors.length);
    p.setUsername(`cwsupply${actors.length}`);
    p.setRegistered(true);
    const connection = new ClientConnection(channel);
    connection.player = p;
    const h = { p, async send(packet) { await connection.dispatch([packet]); connection.processTurnPackets(); } };
    actors.push(h);
    return h;
  }
  const lanthus = PluginManager.spawnNpc({ id: 5721, x: 2441, y: 3089, z: 0, wanderRadius: 0 });
  t.after(() => {
    for (const { p } of actors) {
      p.setRegistered(false);
      core.TaskManager.cancelTasks(p.getIndex());
    }
    PluginManager.removeNpc(lanthus);
  });
  assert.equal(lanthus.getDefinition().getName(), 'null', 'the canonical spawn is a nameless parent');
  async function choose(h, text) {
    const prompt = core.MultiChatboxPrompt.getPending(h.p);
    assert.ok(prompt, text);
    const option = prompt.options.indexOf(text);
    assert.ok(option >= 0, `${text} in ${prompt.options}`);
    await h.send({ type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: option + 1 });
  }

  for (const [itemId, amount] of [[11079, 1], [11080, 2]]) {
    const h = actor(), inventory = h.p.getInventory();
    inventory.adds(itemId, amount);
    const use = async () => {
      await h.send({ type: 'item_on_npc', targetIndex: lanthus.getIndex(), itemId,
        slot: inventory.getSlotForItemId(itemId), widgetId: 149 << 16 });
      for (let i = 0; i < 3; i++) {
        h.p.getMovementQueue().process();
        core.TaskManager.processWalkTo(h.p.getIndex());
      }
    };
    assert.equal(lanthus.getCurrentDefinition(h.p).getName(), 'Lanthus');
    await use();
    assert.match(core.MultiChatboxPrompt.getPending(h.p)?.title ?? '', /Deposit/);
    assert.equal(inventory.getAmount(itemId), amount, 'confirmation does not take bracelets');
    await choose(h, 'Cancel');
    assert.equal(inventory.getAmount(itemId), amount);
    await use();
    await choose(h, 'Deposit');
    assert.equal(inventory.getAmount(itemId), 0);
    assert.equal(h.p.getAttribute('castlewars:bracelet-charges'), amount * 3);
    assert.match(core.MultiChatboxPrompt.getPending(h.p).title, new RegExp(`${amount * 3} stored charges`));
    const saved = PlayerSave.fromPlayer(h.p);
    assert.equal(saved.attributes['castlewars:bracelet-charges'], amount * 3);
    await choose(h, 'Done');
  }

  const healer = actor(), opponent = actors[1];
  match.waitingAreas = {
    [match.TEAM.SARADOMIN]: { getPlayers: () => [healer.p] },
    [match.TEAM.ZAMORAK]: { getPlayers: () => [opponent.p] },
  };
  match.gameArea = { getPlayers: () => [healer.p, opponent.p] };
  match.lobbyArea = { getPlayers: () => [] };
  match.setTeamId(healer.p, match.TEAM.SARADOMIN);
  match.setTeamId(opponent.p, match.TEAM.ZAMORAK);
  const submit = core.TaskManager.submit;
  let countdown;
  core.TaskManager.submit = (task) => { if (task.onComplete) countdown = task; };
  try { match.beginStartCountdown(); } finally { core.TaskManager.submit = submit; }
  assert.ok(countdown);
  countdown.execute();
  assert.equal(match.hasBraceletEffect(opponent.p), true);
  assert.equal(opponent.p.getAttribute('castlewars:bracelet-charges'), 5, 'one deposited charge is spent at match start');
  healer.p.getMovementQueue().reset();
  healer.p.setLocation(new core.Location(2426, 3076, 1));
  healer.p.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, 99, false).setCurrentLevels(core.Skill.HITPOINTS, 40);
  healer.p.setRunEnergy(25);
  healer.p.setPoisonDamage(6);
  const inventory = healer.p.getInventory();
  inventory.adds(core.ItemIdentifiers.BANDAGES, 1);
  await healer.send({ type: 'widget_action', widgetId: 149 << 16, groupId: 149, childId: 0,
    buttonNum: 2, itemId: core.ItemIdentifiers.BANDAGES, slot: inventory.getSlotForItemId(core.ItemIdentifiers.BANDAGES) });
  assert.equal(healer.p.getHitpoints(), 49, 'the earlier Theatre of Blood handler must fall through');
  assert.equal(healer.p.getRunEnergy(), 55);
  assert.equal(healer.p.getPoisonDamage(), 0);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.BANDAGES), 0);
});
