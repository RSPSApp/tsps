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
  let quickPrayers = 0, prayers = 0, maps = 0, specials = 0;
  t.mock.method(core.CombatSpecial, 'activate', () => { specials++; });
  t.mock.method(p.getQuickPrayers(), 'handleWidgetAction', () => { quickPrayers++; return false; });
  t.mock.method(core.PrayerHandler, 'togglePrayer', () => { prayers++; return true; });
  t.mock.method(p.getPacketSender(), 'toggleWorldMap', () => { maps++; });
  const prayer = widget((541 << 16) | 1);
  const autoRetaliate = widget((593 << 16) | 32);
  const orbs = ['orbs:prayerbutton', 'orbs_osm:prayerbutton', 'orbs:worldmap', 'orbs_osm:worldmap']
    .map((name) => { const id = core.CacheDefinitions.getComponentId(name); assert.ok(Number.isInteger(id), name); return widget(id, 2); });
  const specialOrbs = ['orbs:specbutton', 'orbs_nomap:specbutton', 'orbs_osm:specbutton', 'orbs_osm_nomap:specbutton']
    .map(name => { const id = core.CacheDefinitions.getComponentId(name); assert.ok(Number.isInteger(id), name); return widget(id); });
  game.prepareWaitingForm(p, 'saradomin');
  game.applyWaitingForm(p);
  p.setAutoRetaliate(false);
  for (const packet of [prayer, autoRetaliate, ...orbs, ...specialOrbs, { type: 'varp_transmit', varpId: 172, value: 0 }]) await input(packet);
  assert.equal(quickPrayers, 0);
  assert.equal(prayers, 0);
  assert.equal(maps, 0);
  assert.equal(specials, 0, 'every native special orb is blocked while transformed');
  assert.equal(p.autoRetaliateReturn(), false);
  game.clearWaitingForm(p);
  quickPrayers = 0;
  await input(prayer);
  await input(autoRetaliate);
  await input(orbs[2]);
  for (const packet of specialOrbs) await input(packet);
  assert.equal(specials, 4, 'all four native special orbs resume after leaving');
  assert.equal(prayers, 1, 'native prayer actions resume after leaving');
  assert.equal(p.autoRetaliateReturn(), true, 'native combat controls resume after leaving');
  assert.equal(maps, 1, 'the world map opens normally after leaving');
});

test('native Lunar String Jewellery spends nothing while transformed and resumes after leaving', async (t) => {
  const p = player(t, [core.ItemIdentifiers.ZAMORAK_FULL_HELM]);
  t.after(() => game.clearWaitingForm(p));
  p.setSpellbook(core.MagicSpellbook.LUNAR);
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99).setCurrentLevels(core.Skill.MAGIC, 99);
  p.getSkillManager().setMaxLevels(core.Skill.DEFENCE, 99).setCurrentLevels(core.Skill.DEFENCE, 99);
  assert.equal(core.ItemDefinition.forId(1673).getName(), 'Gold amulet (u)');
  assert.equal(core.ItemDefinition.forId(1692).getName(), 'Gold amulet');
  for (const [id, amount] of [[1673, 1], [9075, 2], [557, 10], [555, 5]]) p.getInventory().adds(id, amount);
  const spell = core.CacheDefinitions.getSpellByName('String Jewellery');
  const requirements = core.CacheDefinitions.getSpellRequirements('String Jewellery');
  assert.ok(spell && requirements);
  assert.equal(requirements.level, 80);
  assert.deepEqual([...requirements.runes].sort((a, b) => a.id - b.id), [
    { id: 555, amount: 5 }, { id: 557, amount: 10 }, { id: 9075, amount: 2 },
  ]);
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const connection = new ClientConnection(channel);
  connection.player = p;
  const packet = { type: 'widget_action', widgetId: spell.widgetId, groupId: spell.widgetId >>> 16,
    childId: spell.widgetId & 0xffff, buttonNum: 1, itemId: spell.itemId };
  const amounts = () => [1673, 1692, 9075, 557, 555].map((id) => p.getInventory().getAmount(id));
  const xp = p.getSkillManager().getExperience(core.Skill.MAGIC);
  const craftingXp = p.getSkillManager().getExperience(core.Skill.CRAFTING);
  game.prepareWaitingForm(p, 'saradomin');
  game.applyWaitingForm(p);
  await connection.dispatch([packet], true);
  assert.deepEqual(amounts(), [1, 0, 2, 10, 5]);
  assert.equal(p.getSkillManager().getExperience(core.Skill.MAGIC), xp);
  assert.equal(p.getSkillManager().getExperience(core.Skill.CRAFTING), craftingXp);
  assert.match(p.messages.at(-1), /transformed/);
  game.clearWaitingForm(p);
  await connection.dispatch([packet], true);
  assert.deepEqual(amounts(), [0, 1, 0, 0, 0]);
  assert.equal(p.getSkillManager().getExperience(core.Skill.MAGIC), xp + 83);
  assert.equal(p.getSkillManager().getExperience(core.Skill.CRAFTING), craftingXp + 4);
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
  const fs = require('node:fs');
  const scratch = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cw-native-rewards-'));
  require('../plugins/minigames/castlewars/Scoreboard.CastleWars')._useFile(path.join(scratch, 'scoreboard.json'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const routeScenario = process.env.CW_SHOP_ROUTE_SCENARIO;
  if (routeScenario?.endsWith('-disabled')) {
    const world = require('../dist/game/definition/WorldDefinition');
    const read = world.readWorldConfig;
    t.mock.method(world, 'readWorldConfig', () => {
      const config = read();
      return { ...config, plugins: { ...config.plugins, [routeScenario.replace('-disabled', '')]: false } };
    });
  } else if (routeScenario === 'custom') {
    const read = fs.readFileSync;
    t.mock.method(fs, 'readFileSync', function (file, ...args) {
      const content = read.call(this, file, ...args);
      if (typeof file !== 'string' || path.basename(file) !== 'custom-shops.json') return content;
      return JSON.stringify([...JSON.parse(content), { id: 99999, name: 'Explicit Lanthus shop', currency: 'COINS',
        originalStock: [{ id: 995, amount: 1 }], npcInteractions: [{ npcIds: [11650], optionSlot: 4 }] }]);
    });
  }
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
  // Registration alone leaves these native event consumers without their startup context.
  for (const hook of PluginManager.serverStartupHooks) {
    if (['Hunter', 'WarpedSceptre', 'CastleWars'].includes(hook.pluginName)) hook.handler({});
  }
  // GameBuilder loads these definitions after registering plugins.
  new (require('../dist/game/definition/loader/impl/NpcInteractionDefinitionLoader').NpcInteractionDefinitionLoader)().load();
  new (require('../dist/game/definition/loader/impl/ShopDefinitionLoader').ShopDefinitionLoader)().load();
  core.ShopManager.initialize();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2441, 3089);
  core.RegionManager.loadMapFiles(2426, 3076);
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
  if (routeScenario) {
    const h = actor();
    await h.send({ type: 'npc_option', index: lanthus.getIndex(), clickType: 4 });
    for (let i = 0; i < 3; i++) { h.p.getMovementQueue().process(); core.TaskManager.processWalkTo(h.p.getIndex()); }
    assert.equal(h.p.getInterfaceId(), 300, routeScenario);
    assert.equal(core.ShopManager.getOpenShop(h.p)?.name, routeScenario === 'custom' ? 'Explicit Lanthus shop' : 'Castle Wars Ticket Exchange');
    assert.equal(PluginManager.loadedPlugins.includes('CastleWars'), routeScenario === 'custom');
    return;
  }
  match.endGame();
  const nativeGameArea = match.gameArea;
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


  // Reuse this one production-order registration and canonical NPC for native Trade too.
  const PLAUDITS = 'castlewars:plaudits';
  const { ATTR_SKIP_PERSISTENCE } = require('../plugins/bots/runtime/PersistenceConstants.PlayerBots');
  function shopActor(subtest) {
    let h;
    const errors = [];
    const error = console.error;
    subtest.mock.method(console, 'error', (...args) => { errors.push(args); error.apply(console, args); });
    subtest.after(() => {
      try {
        if (h) {
          core.GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(h.p);
          core.TaskManager.cancelTasks(h.p.getIndex());
          core.TaskManager.cancelTasks(h.p);
          h.p.getMovementQueue().reset();
          h.p.setRegistered(false);
          assert.equal(h.p.isRegistered(), false);
        }
      } finally {
        assert.equal(errors.length, 0, 'caught hook failures must fail the case');
      }
    });
    h = actor();
    // No disk writer is part of this fixture. PlayerSave serialization/hydration is real.
    h.p.setAttribute(ATTR_SKIP_PERSISTENCE, true);
    return h;
  }
  async function trade(h, npc = lanthus) {
    const actions = npc.getCurrentDefinition(h.p).getActions();
    const option = actions.findIndex((action) => action?.toLowerCase() === 'trade');
    assert.ok(option >= 0, 'the visible Lanthus morph offers Trade');
    await h.send({ type: 'npc_option', index: npc.getIndex(), clickType: option + 1 });
    for (let i = 0; i < 3; i++) {
      h.p.getMovementQueue().process();
      core.TaskManager.processWalkTo(h.p.getIndex());
    }
    assert.equal(h.p.getInterfaceId(), 819);
    assert.equal(h.p.getPacketSender().getVarp(3874), 5063);
  }
  async function shopClick(h, component, slot, itemId) {
    const widgetId = core.CacheDefinitions.getComponentId(component);
    assert.ok(widgetId > 0);
    await h.send({ type: 'widget_action', widgetId, groupId: widgetId >>> 16,
      childId: widgetId & 0xffff, buttonNum: 2, itemId, slot });
  }
  function restoreAttributes(save, h) {
    const restored = Object.assign(new PlayerSave(), save);
    restored.attributes = JSON.parse(JSON.stringify(save.attributes));
    restored.applyToPlayer(h.p);
    h.p.setLocation(new core.Location(2440, 3089, 0));
    h.p.setNeedsPlacement(false);
  }

  await t.test('every cache Lanthus form routes Trade through the native reward owner', async (subtest) => {
    const ids = [];
    for (let id = 0; id < core.CacheDefinitions.getCounts().npcs; id++) {
      if (core.CacheDefinitions.getNpc(id).name === 'Lanthus') ids.push(id);
    }
    assert.ok(ids.includes(lanthus.getContentId(shopActor(subtest).p)), 'includes the canonical resolved morph');
    for (const id of ids) {
      const npc = PluginManager.spawnNpc({ id, x: 2441, y: 3089, z: 0, wanderRadius: 0 });
      try { await trade(shopActor(subtest), npc); } finally { PluginManager.removeNpc(npc); }
    }
  });

  await t.test('Lanthus Trade opens both native panels and preserves ticket prices and full refunds', async (subtest) => {
    const h = shopActor(subtest), sender = h.p.getPacketSender(), opens = [], scripts = [];
    const sendSubInterface = sender.sendSubInterface, sendInterfaceScript = sender.sendInterfaceScript;
    subtest.mock.method(sender, 'sendSubInterface', function (...args) {
      opens.push(args); return sendSubInterface.apply(this, args);
    });
    subtest.mock.method(sender, 'sendInterfaceScript', function (...args) {
      scripts.push(args); return sendInterfaceScript.apply(this, args);
    });
    await trade(h);
    assert.equal(opens.filter((args) => args[1] === 819).length, 1);
    assert.ok(opens.some((args) => args[0] === ((161 << 16) | 16) && args[1] === 819 && args[2] === 0));
    assert.ok(opens.some((args) => args[0] === ((161 << 16) | 74) && args[1] === 806 && args[2] === 3));
    assert.deepEqual(scripts.find((args) => args[0] === 7140)?.[1], [5063, -1, -1]);
    assert.deepEqual(scripts.find((args) => args[0] === 7246)?.[1], [5063]);
    assert.equal(h.p.getAttribute(PLAUDITS), 0);
    assert.equal(sender.getVarp(4693), 0);
    await h.send({ type: 'varp_transmit', varpId: 4693, value: 1 });
    await shopClick(h, 'omnishop_main:list', 0, 30690);
    assert.equal(h.p.getInventory().getAmount(30690), 0, 'a client varp is not a plaudit wallet');
    assert.equal(h.p.getAttribute(PLAUDITS), 0);
    h.p.getInventory().adds(4067, 4);
    await shopClick(h, 'omnishop_main:list', 12, 4071);
    assert.equal(h.p.getInventory().getAmount(4067), 0);
    assert.equal(h.p.getInventory().getAmount(4071), 1);
    await shopClick(h, 'omnishop_side:items', h.p.getInventory().getSlotForItemId(4071), 4071);
    assert.equal(h.p.getInventory().getAmount(4071), 0);
    assert.equal(h.p.getInventory().getAmount(4067), 4, 'the cache refunds all four tickets');
  });

  await t.test('ticket payment frees its last stack slot but a remaining stack cannot hide a full inventory', async (subtest) => {
    for (const [tickets, helm, remaining] of [[4, 1, 0], [5, 0, 5]]) {
      const h = shopActor(subtest), inventory = h.p.getInventory();
      inventory.setItem(0, new core.Item(4067, tickets));
      for (let slot = 1; slot < 28; slot++) inventory.setItem(slot, new core.Item(1277, 1));
      await trade(h);
      await shopClick(h, 'omnishop_main:list', 12, 4071);
      assert.equal(inventory.getAmount(4071), helm);
      assert.equal(inventory.getAmount(4067), remaining);
      assert.equal(inventory.getAmount(1277), 27);
    }
  });

  await t.test('a saved plaudit synchronizes on Trade and pays for exactly one unsellable crate', async (subtest) => {
    const seed = shopActor(subtest);
    seed.p.setAttribute(PLAUDITS, 1); // Controlled saved input; this test does not award a match.
    const saved = PlayerSave.fromPlayer(seed.p);
    assert.equal(saved.attributes[PLAUDITS], 1);
    const h = shopActor(subtest);
    restoreAttributes(saved, h);
    assert.equal(h.p.getAttribute(PLAUDITS), 1);
    await trade(h);
    assert.equal(h.p.getPacketSender().getVarp(4693), 1);
    h.p.getInventory().adds(4067, 4);
    await shopClick(h, 'omnishop_main:list', 0, 30690);
    assert.equal(h.p.getInventory().getAmount(30690), 1);
    assert.equal(h.p.getInventory().getAmount(4067), 4);
    assert.equal(h.p.getAttribute(PLAUDITS), 0);
    assert.equal(h.p.getPacketSender().getVarp(4693), 0);
    await shopClick(h, 'omnishop_main:list', 0, 30690);
    await shopClick(h, 'omnishop_side:items', h.p.getInventory().getSlotForItemId(30690), 30690);
    assert.equal(h.p.getInventory().getAmount(30690), 1, 'neither a second buy nor Sell creates currency');
    assert.equal(h.p.getAttribute(PLAUDITS), 0);
    const spent = PlayerSave.fromPlayer(h.p);
    assert.equal(Object.hasOwn(spent.attributes, PLAUDITS), false, 'zero uses the registered save default');
    const reloaded = shopActor(subtest);
    restoreAttributes(spent, reloaded);
    assert.equal(reloaded.p.getAttribute(PLAUDITS), 0);
    assert.equal(reloaded.p.getInventory().getAmount(30690), 1);
    await trade(reloaded);
    assert.equal(reloaded.p.getPacketSender().getVarp(4693), 0);
  });

  await t.test('crate refusals preserve the saved balance for a full inventory or a members-only item on a free world', async (subtest) => {
    const h = shopActor(subtest), inventory = h.p.getInventory();
    h.p.setAttribute(PLAUDITS, 1);
    for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new core.Item(1277, 1));
    await trade(h);
    await shopClick(h, 'omnishop_main:list', 0, 30690);
    assert.equal(inventory.getAmount(30690), 0);
    assert.equal(inventory.getAmount(1277), 28);
    assert.equal(h.p.getAttribute(PLAUDITS), 1);
    assert.equal(h.p.getPacketSender().getVarp(4693), 1);
    const free = shopActor(subtest);
    free.p.setAttribute(PLAUDITS, 1);
    assert.equal(core.CacheDefinitions.getItem(30690).isMembers, true, 'cache membership is an input precondition');
    subtest.mock.method(core.WorldDefinition, 'isMembersWorld', () => false);
    await trade(free);
    await shopClick(free, 'omnishop_main:list', 0, 30690);
    assert.equal(free.p.getInventory().getAmount(30690), 0);
    assert.equal(free.p.getAttribute(PLAUDITS), 1);
    assert.equal(free.p.getPacketSender().getVarp(4693), 1);
    // This fixture booted a members world. Install only the real free-world item-use gate here.
    const previousUseHooks = PluginManager.canUseItemHooks;
    PluginManager.canUseItemHooks = [...previousUseHooks];
    subtest.after(() => { PluginManager.canUseItemHooks = previousUseHooks; });
    const freeApi = PluginManager.createApi('CastleWarsFreeWorldItemUse');
    require('../plugins/modes/FreeToPlay.plugin').register(new Proxy({ core, onCanUseItem: freeApi.onCanUseItem },
      { get: (target, key) => target[key] ?? (() => {}) }));
    free.p.getInventory().adds(30690, 1);
    free.p.getPacketSender().sendInterfaceRemoval();
    await free.send({ type: 'widget_action', widgetId: 149 << 16, groupId: 149, childId: 0,
      buttonNum: 2, itemId: 30690, slot: free.p.getInventory().getSlotForItemId(30690) });
    assert.equal(free.p.getInventory().getAmount(30690), 1, 'the normal free-world item-use gate also refuses Open');
  });

  let cycle = core.World.getProcessCycle();
  t.mock.method(core.World, 'getProcessCycle', () => cycle);
  match.endGame();
  function startRewardMatch(first, second, subtest, delayTicks = 0) {
    for (const [h, team] of [[first, match.TEAM.SARADOMIN], [second, match.TEAM.ZAMORAK]]) {
      h.p.setLocation(new core.Location(2426, 3076, 1));
      subtest.mock.method(h.p, 'getArea', () => match.gameArea);
      subtest.mock.method(h.p, 'smartMove', () => {});
      match.setTeamId(h.p, team);
    }
    match.waitingAreas = {
      [match.TEAM.SARADOMIN]: { getPlayers: () => [first.p] },
      [match.TEAM.ZAMORAK]: { getPlayers: () => [second.p] },
    };
    match.gameArea = { getPlayers: () => [first.p, second.p] };
    let start;
    const submit = core.TaskManager.submit;
    core.TaskManager.submit = task => { if (task.onComplete) start = task; };
    try { match.beginStartCountdown(); } finally { core.TaskManager.submit = submit; }
    assert.ok(start);
    start.execute();
    assert.equal(match.getPhase(), match.PHASE.ACTIVE);
    cycle += delayTicks;
    nativeGameArea.postEnter(first.p);
    nativeGameArea.postEnter(second.p);
    subtest.after(() => { match.endGame(); match.gameArea = { getPlayers: () => [] }; });
  }

  await t.test('completed members games deliver tickets and saved plaudits exactly once, then Trade and Open work natively', async (subtest) => {
    const first = shopActor(subtest), second = shopActor(subtest);
    startRewardMatch(first, second, subtest);
    cycle += 1500; // Fifteen minutes of native game cycles; no wall-clock sleeps.
    match.endGame();
    assert.equal(first.p.getInventory().getAmount(4067), 1);
    assert.equal(first.p.getAttribute(PLAUDITS), 1);
    assert.equal(first.p.getPacketSender().getVarp(4693), 1);
    match.endGame();
    assert.equal(first.p.getAttribute(PLAUDITS), 1, 'a duplicate end cannot award twice');
    const saved = PlayerSave.fromPlayer(first.p);
    const reloaded = shopActor(subtest);
    restoreAttributes(saved, reloaded);
    assert.equal(reloaded.p.getAttribute(PLAUDITS), 1);
    await trade(reloaded);
    await shopClick(reloaded, 'omnishop_main:list', 0, 30690);
    assert.equal(reloaded.p.getAttribute(PLAUDITS), 0);
    assert.equal(reloaded.p.getInventory().getAmount(30690), 1);
    reloaded.p.getPacketSender().sendInterfaceRemoval();
    const slot = reloaded.p.getInventory().getSlotForItemId(30690);
    subtest.mock.method(Math, 'random', () => 0); // Three minimum noted manta-ray rewards.
    const packet = { type: 'widget_action', widgetId: 149 << 16, groupId: 149, childId: 0,
      buttonNum: 2, itemId: 30690, slot };
    await reloaded.send(packet);
    await reloaded.send(packet);
    assert.equal(reloaded.p.getInventory().getAmount(30690), 0);
    assert.equal(reloaded.p.getInventory().getAmount(24590), 45, 'three duplicate rolls merge exactly once');
    assert.equal(reloaded.p.getInventory().getAmount(4067), 1, 'the earned ticket is not spent on a plaudit crate');
  });

  await t.test('early games, full bags and free worlds cannot create plaudits without delivered tickets', (subtest) => {
    for (const scenario of ['early', 'late-entry', 'full', 'full-stack', 'free', 'bot', 'other-bot', 'unregistered']) {
      const first = shopActor(subtest), second = shopActor(subtest);
      startRewardMatch(first, second, subtest, scenario === 'late-entry' ? 1400 : 0);
      if (scenario !== 'early') cycle += scenario === 'late-entry' ? 100 : 1500;
      if (scenario.startsWith('full')) for (let slot = 0; slot < 28; slot++) first.p.getInventory().setItem(slot, new core.Item(1277, 1));
      if (scenario === 'full-stack') first.p.getInventory().setItem(0, new core.Item(4067, 10));
      if (scenario === 'unregistered') first.p.setRegistered(false);
      if (scenario === 'bot') first.p.setAttribute(match.BOT_KEY, true);
      if (scenario === 'other-bot') first.p.setPlayerBot(true);
      const members = subtest.mock.method(core.WorldDefinition, 'isMembersWorld', () => scenario !== 'free');
      match.endGame();
      members.mock.restore();
      assert.equal(first.p.getAttribute(PLAUDITS) ?? 0, 0, scenario);
      assert.equal(first.p.getInventory().getAmount(4067), scenario === 'full-stack' ? 10 : ['free', 'bot', 'other-bot'].includes(scenario) ? 1 : 0, scenario);
      if (scenario === 'full') {
        assert.equal(first.p.getInventory().getAmount(1277), 28, 'no item is displaced');
        assert.equal(first.p.getAttribute('castlewars:games-played'), 1, 'the result is recorded even when currency cannot fit');
      }
    }
  });

  await t.test('native Lanthus XP confirmation persists, blocks combat gains and drops only in the active arena, then enables again', async (subtest) => {
    const first = shopActor(subtest), second = shopActor(subtest);
    await first.send({ type: 'npc_option', index: lanthus.getIndex(), clickType: 3 });
    for (let i = 0; i < 3; i++) { first.p.getMovementQueue().process(); core.TaskManager.processWalkTo(first.p.getIndex()); }
    assert.match(core.MultiChatboxPrompt.getPending(first.p)?.title ?? '', /Disable.*XP/);
    await choose(first, 'Cancel');
    assert.notEqual(first.p.getAttribute('castlewars:combat-xp-disabled'), true);
    await first.send({ type: 'npc_option', index: lanthus.getIndex(), clickType: 3 });
    for (let i = 0; i < 3; i++) { first.p.getMovementQueue().process(); core.TaskManager.processWalkTo(first.p.getIndex()); }
    await choose(first, 'Yes');
    const saved = PlayerSave.fromPlayer(first.p);
    assert.equal(saved.attributes['castlewars:combat-xp-disabled'], true);
    const disabled = shopActor(subtest);
    restoreAttributes(saved, disabled);
    const drops = [];
    subtest.mock.method(disabled.p.getPacketSender(), 'sendExpDrop', (skill, amount) => drops.push([skill, amount]));
    startRewardMatch(disabled, second, subtest);
    disabled.p.getInventory().deleteNumber(match.data.RUNE_POUCH, 1);
    const skills = [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE, core.Skill.RANGED, core.Skill.MAGIC, core.Skill.HITPOINTS];
    for (const skill of skills) {
      const old = disabled.p.getSkillManager().getExperience(skill);
      disabled.p.getSkillManager().addExperience(skill, 5, false);
      assert.equal(disabled.p.getSkillManager().getExperience(skill), old, skill.getName());
    }
    assert.equal(drops.length, 0);
    disabled.p.getSkillManager().addExperience(core.Skill.MINING, 5, false);
    assert.equal(drops.length, 1, 'unrelated skilling is unchanged');
    const waiting = subtest.mock.method(disabled.p, 'getArea', () => match.waitingAreas[match.TEAM.SARADOMIN]);
    disabled.p.getSkillManager().addExperience(core.Skill.ATTACK, 5, false);
    assert.equal(drops.length, 2, 'active phase/team alone cannot block a waiting-room gain');
    waiting.mock.restore();
    disabled.p.setLocation(new core.Location(2440, 3089));
    disabled.p.getSkillManager().addExperience(core.Skill.ATTACK, 5, false);
    assert.equal(drops.length, 3, 'stale area ownership outside the arena cannot block XP');
    match.endGame();
    await disabled.send({ type: 'npc_option', index: lanthus.getIndex(), clickType: 3 });
    for (let i = 0; i < 3; i++) { disabled.p.getMovementQueue().process(); core.TaskManager.processWalkTo(disabled.p.getIndex()); }
    assert.match(core.MultiChatboxPrompt.getPending(disabled.p)?.title ?? '', /Enable.*XP/);
    await choose(disabled, 'Yes');
    assert.equal(disabled.p.getAttribute('castlewars:combat-xp-disabled'), false);
    const old = disabled.p.getSkillManager().getExperience(core.Skill.ATTACK);
    disabled.p.getSkillManager().addExperience(core.Skill.ATTACK, 5, false);
    assert.equal(disabled.p.getSkillManager().getExperience(core.Skill.ATTACK), old + 5);
  });


  await t.test('standard outcomes and minigame multipliers credit only valid fully fitting ticket amounts', (subtest) => {
    for (const [own, other, multiplier] of [[0, 0, 1], [1, 1, 1], [2, 1, 1], [1, 0, 1], [0, 1, 1], [1, 0, 2], [0, 0, NaN], [0, 0, 0.5], [0, 0, -1]]) {
      const first = shopActor(subtest), second = shopActor(subtest);
      startRewardMatch(first, second, subtest);
      cycle += 1500;
      match.score[match.TEAM.SARADOMIN] = own;
      match.score[match.TEAM.ZAMORAK] = other;
      const emit = PluginManager.emitCustomEvent;
      subtest.mock.method(PluginManager, 'emitCustomEvent', function (name, event) {
        if (name === 'minigame:points') event.points *= multiplier;
        return emit.call(this, name, event);
      });
      match.endGame();
      PluginManager.emitCustomEvent.mock.restore();
      const base = own === other ? (own === 0 ? 1 : 2) : own < other ? 1 : other === 0 ? 3 : 2;
      const expected = Number.isSafeInteger(base * multiplier) && base * multiplier > 0 ? base * multiplier : 0;
      assert.equal(first.p.getInventory().getAmount(4067), expected);
      assert.equal(first.p.getAttribute(PLAUDITS) ?? 0, expected);
    }
    for (const cap of ['tickets', 'plaudits']) {
      const first = shopActor(subtest), second = shopActor(subtest);
      startRewardMatch(first, second, subtest);
      cycle += 1500;
      match.score[match.TEAM.SARADOMIN] = 1; // Three tickets cannot fit above MAX-2.
      if (cap === 'tickets') first.p.getInventory().adds(4067, 0x7fffffff - 2);
      else first.p.setAttribute(PLAUDITS, 0x7fffffff - 2);
      match.endGame();
      assert.equal(first.p.getInventory().getAmount(4067), cap === 'tickets' ? 0x7fffffff - 2 : 0);
      assert.equal(first.p.getAttribute(PLAUDITS) ?? 0, cap === 'plaudits' ? 0x7fffffff - 2 : 0);
    }
  });

  await t.test('leaving or logging out clears participation and a new match cannot reuse earlier time', (subtest) => {
    for (const logout of [false, true]) {
      const first = shopActor(subtest), second = shopActor(subtest);
      startRewardMatch(first, second, subtest);
      cycle += 1400;
      nativeGameArea.postLeave(first.p, logout);
      assert.equal(match.getTeamId(first.p), null);
      assert.equal(first.p.getAttribute(PLAUDITS) ?? 0, 0);
      match.endGame();
      startRewardMatch(first, second, subtest);
      cycle += 100;
      match.endGame();
      assert.equal(first.p.getInventory().getAmount(4067), 0);
      assert.equal(first.p.getAttribute(PLAUDITS) ?? 0, 0, 'the previous 1400 cycles are not reused');
    }
  });

  await t.test('crate ammunition retains dragon compatibility and actual consumption only inside an active Castle Wars arena', async (subtest) => {
    const first = shopActor(subtest), second = shopActor(subtest);
    startRewardMatch(first, second, subtest);
    const { Ammunition, RangedWeapon, CombatFactory, Equipment } = core;
    subtest.mock.method(core.Misc, 'getRandom', () => 0); // Break one fired unit; no floor drop.
    const equip = (weaponId, ammoId) => {
      first.p.getEquipment().setItem(Equipment.WEAPON_SLOT, new core.Item(weaponId, 1));
      first.p.getEquipment().setItem(Equipment.AMMUNITION_SLOT, new core.Item(ammoId, 10));
      first.p.getCombat().setRangedWeapon(RangedWeapon.getFor(first.p));
      first.p.getCombat().setAmmunition(Ammunition.getForItem(ammoId));
    };
    for (const weapon of Object.values(RangedWeapon)) {
      if (weapon instanceof RangedWeapon) assert.equal(weapon.getAmmunitionData().includes(Ammunition.DRAGON_ARROW),
        weapon.getAmmunitionData().includes(Ammunition.SEEKING_DRAGON_ARROW), 'the alias preserves the complete dragon-arrow compatibility set');
    }
    for (const [weapon, ammo, expected, strength] of [[11235, 30694, Ammunition.SEEKING_DRAGON_ARROW, 60], [21902, 30696, Ammunition.DRAGON_BOLTS, 122]]) {
      assert.equal(Ammunition.getForItem(ammo), expected);
      assert.equal(expected.getStrength(), strength);
      equip(weapon, ammo);
      assert.equal(CombatFactory.checkAmmo(first.p, 1), true);
      CombatFactory.decrementAmmo(first.p, first.p.getLocation(), 1);
      assert.equal(first.p.getEquipment().get(Equipment.AMMUNITION_SLOT).getId(), ammo);
      assert.equal(first.p.getEquipment().get(Equipment.AMMUNITION_SLOT).getAmount(), 9, 'consume the actual Castle Wars stack');
      const recovery = subtest.mock.method(CombatFactory, 'ammoRecovery', () => 80);
      const roll = subtest.mock.method(core.Misc, 'getRandom', () => 99);
      CombatFactory.decrementAmmo(first.p, first.p.getLocation(), 1);
      assert.equal(first.p.getEquipment().get(Equipment.AMMUNITION_SLOT).getAmount(), 9, 'native recovery keeps the same Castle Wars stack');
      recovery.mock.restore(); roll.mock.restore();
      for (const [where, location] of [['lobby', new core.Location(2440, 3089)], ['waiting', new core.Location(2381, 9489)], ['world', new core.Location(3222, 3218)]]) {
        first.p.setLocation(location);
        equip(weapon, ammo);
        assert.equal(CombatFactory.checkAmmo(first.p, 1), false, where);
        assert.equal(first.p.getEquipment().get(Equipment.AMMUNITION_SLOT).getAmount(), 10);
      }
      first.p.setLocation(new core.Location(2426, 3076, 1));
      const area = subtest.mock.method(first.p, 'getArea', () => match.waitingAreas[match.TEAM.SARADOMIN]);
      equip(weapon, ammo);
      assert.equal(CombatFactory.checkAmmo(first.p, 1), false, 'arena tiles alone do not admit a waiting actor');
      area.mock.restore();
      equip(861, ammo);
      assert.equal(CombatFactory.checkAmmo(first.p, 1), false, 'a Magic shortbow cannot fire either dragon-tier ammo');
    }
    first.p.setLocation(new core.Location(3222, 3218));
    for (const [weapon, ammo] of [[11235, 11212], [21902, 21905]]) {
      equip(weapon, ammo);
      assert.equal(CombatFactory.checkAmmo(first.p, 1), true, 'ordinary dragon ammunition remains usable elsewhere');
    }
    const Quiver = require('../plugins/items/DizanasQuiver.plugin');
    first.p.getEquipment().setItem(Equipment.CAPE_SLOT, new core.Item(core.ItemIdentifiers.DIZANAS_QUIVER, 1));
    const quiverAction = op => first.send({ type: 'widget_action', widgetId: (387 << 16) | 28,
      groupId: 387, childId: 28, buttonNum: op, slot: -1, itemId: -1 });
    for (const [weapon, ammo] of [[11235, 30694], [21902, 30696]]) {
      equip(weapon, ammo);
      await quiverAction(2);
      assert.deepEqual(Quiver.stored(first.p), { id: ammo, amount: 10 }, 'native Fill retains the actual ammo ID');
      first.p.getCombat().setAmmunition(Ammunition.getFor(first.p));
      assert.equal(CombatFactory.checkAmmo(first.p, 1), false, 'a stored CW stack cannot bypass the outside restriction');
      first.p.setLocation(new core.Location(2426, 3076, 1));
      first.p.getCombat().setRangedWeapon(RangedWeapon.getFor(first.p));
      first.p.getCombat().setAmmunition(Ammunition.getFor(first.p));
      assert.equal(CombatFactory.checkAmmo(first.p, 1), true);
      CombatFactory.decrementAmmo(first.p, first.p.getLocation(), 1);
      assert.deepEqual(Quiver.stored(first.p), { id: ammo, amount: 9 }, 'quiver consumption preserves the Castle Wars ID');
      await quiverAction(1);
      first.p.setLocation(new core.Location(3222, 3218));
    }
    equip(11235, 11212);
    await quiverAction(2);
    first.p.getEquipment().setItem(Equipment.AMMUNITION_SLOT, new core.Item(30696, 10));
    first.p.getCombat().setRangedWeapon(RangedWeapon.getFor(first.p));
    first.p.getCombat().setAmmunition(Ammunition.getFor(first.p));
    assert.equal(CombatFactory.checkAmmo(first.p, 1), true, 'unused worn CW bolts cannot block ordinary dragon arrows selected from the quiver');

  });

});

test('native Lanthus routing preserves explicit custom shops and disabled plugin dependencies', () => {
  const { spawnSync } = require('node:child_process');
  for (const scenario of ['custom', 'CastleWars-disabled', 'Omnishop-disabled']) {
    const env = { ...process.env, CW_SHOP_ROUTE_SCENARIO: scenario };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=^native Castle Wars supplies', __filename], {
      cwd: process.cwd(), env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `${scenario}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /native Castle Wars supplies/, 'the isolated child must execute the native route case');
  }
});
