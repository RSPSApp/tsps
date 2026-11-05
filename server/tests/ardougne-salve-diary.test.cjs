const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Item } = require('../dist/game/model/Item');
const diary = require('../plugins/achievements/diaries/ArdougneSalveDiary.plugin');
const Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
const AchievementDiaries = require('../plugins/achievements/AchievementDiaries.plugin');
const core = PluginManager.getCoreApi();
const handlers = new Map();

const api = {
  core,
  persistAttribute() {},
  onPlayerLogin() {},
  onCustomEvent(name, handler) {
    const list = handlers.get(name) ?? [];
    list.push(handler);
    handlers.set(name, list);
  },
  emitCustomEvent(name, event) {
    for (const handler of handlers.get(name) ?? []) handler(event);
  },
};

Progress(api);
diary.register(api);
api.onCustomEvent('diary:task', AchievementDiaries._test.onTask);

before(async () => {
  await CachePipeline.initialize(process.cwd());
});

function player(t, { registered = true, hitpoints = 99, dying = false } = {}) {
  const value = new Player({ sendClientPacket: () => true });
  value.setRegistered(registered);
  t.mock.method(value, 'getHitpoints', () => hitpoints);
  t.mock.method(value, 'isDyingReturn', () => dying);
  return value;
}

function completed(player) {
  const diaryData = require('../plugins/achievements/diaries/Data.AchievementDiaries').BY_KEY.get('ardougne');
  return Progress.doneTasks(player, diaryData).has(diary._test.TASK);
}

test('only the NMZ Salve item ids count when worn', (t) => {
  const ids = core.ItemIdentifiers;
  for (const id of [ids.SALVE_AMULET_I_, ids.SALVE_AMULET_EI_]) {
    const p = player(t);
    api.emitCustomEvent('equipment:equipped', { player: p, itemId: id, slot: core.Equipment.AMULET_SLOT });
    assert.equal(completed(p), true, `NMZ item ${id} counts`);
  }

  for (const id of [ids.SALVE_AMULET_I__3, ids.SALVE_AMULET_EI__3, ids.SALVE_AMULET_I__5, ids.SALVE_AMULET_EI__5]) {
    const p = player(t);
    api.emitCustomEvent('equipment:equipped', { player: p, itemId: id, slot: core.Equipment.AMULET_SLOT });
    assert.equal(completed(p), false, `non-NMZ item ${id} does not count`);
  }
});

test('equipment refreshes and wrong equipment slots do not count', (t) => {
  const p = player(t);
  api.emitCustomEvent('equipment:changed', { player: p });
  api.emitCustomEvent('equipment:equipped', {
    player: p,
    itemId: core.ItemIdentifiers.SALVE_AMULET_EI_,
    slot: core.Equipment.RING_SLOT,
  });
  assert.equal(completed(p), false);
});

test('an NMZ imbue event credits the diary once for living registered players only', (t) => {
  const ids = core.ItemIdentifiers;
  const request = (p) => api.emitCustomEvent('nightmare-zone:imbued', {
    player: p,
    baseItemId: ids.SALVE_AMULET_E_,
    imbuedItemId: ids.SALVE_AMULET_EI_,
  });

  const p = player(t);
  request(p);
  request(p);
  assert.equal(completed(p), true);
  assert.equal(p.getAttribute(Progress.TASKS_ATTRIBUTE).ardougne.filter((task) => task === diary._test.TASK).length, 1);

  for (const options of [{ registered: false }, { hitpoints: 0 }, { dying: true }]) {
    const inactive = player(t, options);
    request(inactive);
    assert.equal(completed(inactive), false);
  }
});

test('a failed equip attempt does not credit the diary', (t) => {
  const { EquipPacketListener } = require('../dist/net/packet/impl/EquipPacketListener');
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => api.emitCustomEvent(name, event));
  const p = player(t);
  p.getInventory().setItem(0, new Item(core.ItemIdentifiers.SALVE_AMULET_EI_, 1));
  EquipPacketListener.equip(p, core.ItemIdentifiers.SALVE_AMULET_EI_, 0, -1);
  assert.equal(completed(p), false);
  assert.equal(p.getEquipment().getItems()[core.Equipment.AMULET_SLOT].getId(), -1);
});
