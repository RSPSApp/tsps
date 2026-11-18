// Run after `npx tsc --build`: node --test tests/item-fill-charges.test.cjs
//
// "item:fill-charges" { player, item, handled }: content that hands out charged items ready to
// use (the PvP Arena's load-outs) asks each item's own plugin for a full one. Every charged item
// the arena's load-outs offer (enum 4390) answers, through its real plugin and the real cache.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

const PLUGINS = [
  'ToxicStaffOfTheDead.plugin', 'ToxicBlowpipe.plugin', 'SanguinestiStaff.plugin', 'ScytheOfVitur.plugin',
  'AmuletOfBloodFury.plugin', 'ElementalTomes.plugin', 'Trident.plugin', 'TumekensShadow.plugin',
  'EyeOfAyak.plugin', 'AccursedSceptre.plugin', 'WarpedSceptre.plugin',
];
const fillers = [];
let core;

before(() => {
  CachePipeline.initialize();
  const startups = [];
  const noop = () => {};
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    onServerStartup: (handler) => startups.push(handler),
    onCustomEvent: (name, handler) => { if (name === 'item:fill-charges') fillers.push(handler); },
    getAreaManager: () => ({}),
  }, { get: (target, key) => target[key] ?? noop });
  core = api.core;
  for (const name of PLUGINS) require(`../plugins/items/${name}`).register(api);
  for (const startup of startups) startup({});
});

function fill(id) {
  const item = new core.Item(id, 1);
  const event = { player: null, item, handled: false };
  for (const handler of fillers) handler(event);
  return { item, handled: event.handled };
}

const I = () => core.ItemIdentifiers;

test('each charged load-out item comes full, in its charged form', () => {
  const cases = [
    [I().TOXIC_STAFF_OF_THE_DEAD, 'toxic-staff-charges', 11000],
    [I().SANGUINESTI_STAFF, 'sanguinesti-staff-charges', 20000],
    [I().SCYTHE_OF_VITUR, 'scythe-of-vitur-charges', 20000],
  ];
  for (const [id, key, charges] of cases) {
    const { item, handled } = fill(id);
    assert.equal(handled, true, core.CacheDefinitions.getItem(id).name);
    assert.equal(item.getId(), id);
    assert.equal(item.getMetaValue(key), charges);
  }
});

test('the blowpipe comes with its scales and darts, the amulet and the tome charged', () => {
  const pipe = fill(I().TOXIC_BLOWPIPE);
  assert.equal(pipe.handled, true);
  assert.equal(pipe.item.getId(), I().TOXIC_BLOWPIPE);
  assert.deepEqual(pipe.item.getMetaValue('toxic-blowpipe'), { scales: 16383, dartId: I().DRAGON_DART, dartAmount: 16383 });

  const amulet = fill(I().AMULET_OF_BLOOD_FURY);
  assert.equal(amulet.handled, true);
  assert.deepEqual(amulet.item.getMetaValue('blood-fury'), { charges: 30000 });

  const tome = fill(I().TOME_OF_FIRE);
  assert.equal(tome.handled, true);
  assert.equal(tome.item.getId(), I().TOME_OF_FIRE);
  assert.equal(tome.item.getMetaValue('elemental-tomes').charges, 20000);
});

test('an uncharged staff is handed out charged; items without charges are left alone', () => {
  const uncharged = fill(I().UNCHARGED_TRIDENT);
  assert.equal(uncharged.handled, true);
  assert.equal(uncharged.item.getId(), I().TRIDENT_OF_THE_SEAS);
  const plain = fill(I().ABYSSAL_WHIP);
  assert.equal(plain.handled, false);
  assert.equal(plain.item.getMeta?.() ?? null, null);
});

const path = require('node:path');
const Eye = require('../plugins/items/EyeOfAyak.plugin');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const Json = require('../plugins/persistence/JsonPlayerPersistence.plugin');
const { EquipPacketListener } = require('../dist/net/packet/impl/EquipPacketListener');
const { ItemActionPacketListener } = require('../dist/net/packet/impl/ItemActionPacketListener');
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Eye.register(PluginManager.createApi('AyakFillRegression'));
  Json.register(PluginManager.createApi('AyakFillPersistence'));
});

function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername('ayakfill'); p.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(p), true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.getSkillManager().setMaxLevels(core.Skill.MAGIC, 99, false).setCurrentLevels(core.Skill.MAGIC, 99, false);
  t.after(() => { core.TaskManager.cancelTasks(p); core.World.getPlayers().removes(p); });
  return p;
}

function action(p, item, option) {
  return ItemActionPacketListener.handleAction(p, core.Inventory.INTERFACE_ID, item.getId(),
    p.getInventory().getItems().indexOf(item), core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf(option) + 1, option);
}

for (const material of [undefined, 'runes', 'tears']) {
  test(`Eye fill event initializes/preserves ${material ?? 'missing'} material across Check, cast and refund`, t => {
    const p = actor(t), item = new core.Item(material ? core.ItemIdentifiers.EYE_OF_AYAK : core.ItemIdentifiers.EYE_OF_AYAK_UNCHARGED_, 1);
    item.setMetaValue('test:origin', 'kept'); item.setMetaValue(core.Item.PRESET_META, true);
    if (material) {
      item.setMetaValue(Eye._test.MATERIAL_KEY, material);
      item.setMetaValue(Eye._test.CHARGES_KEY, 12);
    }
    p.getInventory().setItem(0, item);
    const event = { player: p, item, handled: false };
    PluginManager.emitCustomEvent('item:fill-charges', event);
    const expectedMaterial = material ?? 'runes';
    assert.equal(event.handled, true);
    assert.equal(item.getId(), core.ItemIdentifiers.EYE_OF_AYAK);
    assert.equal(Eye._test.staff.chargesOf(item), 50000);
    assert.equal(item.getMetaValue(Eye._test.MATERIAL_KEY), expectedMaterial);
    const messages = [], originalSend = p.sendMessage.bind(p);
    p.sendMessage = text => { messages.push(text); return originalSend(text); };
    assert.equal(action(p, item, 'Check'), true);
    assert.match(messages.at(-1), new RegExp(`charged with ${expectedMaterial === 'tears' ? 'demon tears' : 'runes'}.*50,000 charges`));
    EquipPacketListener.equip(p, item.getId(), 0, core.Inventory.INTERFACE_ID);
    const worn = p.getEquipment().get(core.Equipment.WEAPON_SLOT);
    assert.notEqual(worn, item);
    assert.equal(worn.getMetaValue(Eye._test.MATERIAL_KEY), expectedMaterial);
    const target = new core.NPC(core.NpcIdentifiers.MAN, new core.Location(3201, 3200, 0));
    const method = core.CombatFactory.getMethod(p);
    assert.ok(method instanceof core.MagicCombatMethod);
    assert.equal(method.canAttack(p, target), true); method.start(p, target);
    assert.equal(method.hits(p, target).length, 1);
    assert.equal(Eye._test.staff.chargesOf(worn), 49999);
    assert.equal(worn.getMetaValue(Eye._test.MATERIAL_KEY), expectedMaterial);
    assert.equal(worn.getMetaValue('test:origin'), 'kept');
    assert.equal(worn.isPresetItem(), true);
    const codec = new Json.JsonPlayerPersistence();
    const record = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p), codec.replacer.bind(codec)), codec.reviver.bind(codec));
    const loaded = actor(t); codec.hydratePlayerSave(record).applyToPlayer(loaded);
    loaded.setAttribute('bot-skip-persistence', true);
    const reloaded = loaded.getEquipment().get(core.Equipment.WEAPON_SLOT);
    assert.equal(reloaded.getMetaValue(Eye._test.MATERIAL_KEY), expectedMaterial);
    assert.equal(Eye._test.staff.chargesOf(reloaded), 49999);
    assert.equal(reloaded.isPresetItem(), true);
    EquipPacketListener.unequip(loaded, core.Equipment.WEAPON_SLOT);
    assert.equal(action(loaded, reloaded, 'Uncharge'), true);
    assert.equal(loaded.getDialogueManager().handleResume((219 << 16) | 1, 1), true);
    assert.equal(reloaded.getId(), core.ItemIdentifiers.EYE_OF_AYAK_UNCHARGED_);
    assert.equal(reloaded.getMetaValue(Eye._test.MATERIAL_KEY), undefined);
    assert.equal(Eye._test.staff.chargesOf(reloaded), 0);
    assert.equal(loaded.getInventory().getAmount(core.ItemIdentifiers.DEATH_RUNE), expectedMaterial === 'runes' ? 99998 : 0);
    assert.equal(loaded.getInventory().getAmount(core.ItemIdentifiers.CHAOS_RUNE), expectedMaterial === 'runes' ? 49999 : 0);
    assert.equal(loaded.getInventory().getAmount(core.ItemIdentifiers.DEMON_TEAR), expectedMaterial === 'tears' ? 49999 : 0);
    assert.equal(reloaded.getMetaValue('test:origin'), 'kept');
  });
}

test('Eye fill handler leaves an unrelated item and its metadata alone', t => {
  const p = actor(t), item = new core.Item(core.ItemIdentifiers.LOGS, 1, { 'test:origin': 'kept' });
  const event = { player: p, item, handled: false };
  PluginManager.emitCustomEvent('item:fill-charges', event);
  assert.equal(event.handled, false);
  assert.equal(item.getId(), core.ItemIdentifiers.LOGS);
  assert.deepEqual(item.getMeta(), { 'test:origin': 'kept' });
});
