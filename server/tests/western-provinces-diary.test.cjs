// Run after `yarn build`: node --test tests/western-provinces-diary.test.cjs
// Western Provinces Diary credits from the successful actions other plugins emit.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
before(() => CachePipeline.initialize(path.resolve(__dirname, '..')));
const Western = require('../plugins/achievements/diaries/WesternProvincesDiary.plugin');
const Data = require('../plugins/achievements/diaries/Data.AchievementDiaries');
const Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');

const events = [];
const custom = new Map();
const deaths = [];
const api = new Proxy({
  core,
  emitCustomEvent: (name, payload) => events.push({ name, ...payload }),
  onCustomEvent: (name, handler) => custom.set(name, [...(custom.get(name) ?? []), handler]),
  onNpcDeath: (handler) => deaths.push(handler),
}, { get: (target, key) => target[key] ?? (() => {}) });
Progress(api);
Western.register(api);

const fire = (name, payload) => { for (const handler of custom.get(name) ?? []) handler(payload); };
const tasks = () => events.filter((event) => event.name === 'diary:task').map((event) => event.task);
const reset = () => { events.length = 0; };

function player(at = [2500, 3500, 0], extra = {}) {
  let location = new core.Location(...at);
  const who = {
    isRegistered: () => true,
    getHitpoints: () => 99,
    isDyingReturn: () => false,
    getLocation: () => location,
    moveTo: (next) => { location = next; },
    getEquipment: () => ({ getItems: () => [], get: () => new core.Item(-1, 0) }),
    ...extra,
  };
  return who;
}

const objectAt = (x, y, z, name) => ({ getLocation: () => new core.Location(x, y, z), getDefinition: () => ({ getName: () => name }) });
const npcAt = (x, y, z, name) => ({ getLocation: () => new core.Location(x, y, z), getDefinition: () => ({ getName: () => name }) });
const T = Western._test.TASK;

test('the catalogue has every task this module names; the rest are other content or unimplemented', () => {
  const diary = Data.BY_KEY.get('western');
  const keys = new Set(Object.values(diary.tiers).flatMap((tier) => tier.tasks.map((task) => task.key)));
  for (const [name, key] of Object.entries(T)) assert.ok(keys.has(key), `${name} is a Western task`);
  assert.equal(Object.keys(T).length, 39);
  const covered = new Set(Object.values(T));
  const missing = [...keys].filter((key) => !covered.has(key));
  assert.deepEqual(missing.sort(), [
    'complete-a-lap-of-the-ape-atoll-agility-course',
    'complete-a-lap-of-the-gnome-agility-course',
    'fletch-a-magic-longbow-in-tirannwn',
    'fletch-an-oak-shortbow-in-the-gnome-stronghold',
    'score-a-goal-in-a-gnomeball-match',
  ]);
});

test('hunter catches only count in their Wiki area', () => {
  reset();
  const N = core.NpcIdentifiers;
  fire('hunter:success', { player: player([2320, 3590]), npcId: N.COPPER_LONGTAIL });
  fire('hunter:success', { player: player([2550, 2890]), npcId: N.SPINED_LARUPIA });
  fire('hunter:success', { player: player([2380, 3580]), npcId: N.DASHING_KEBBIT });
  assert.deepEqual(tasks(), [T.copperLongtail, T.spinedLarupia, T.dashingKebbit]);
  reset();
  fire('hunter:success', { player: player([2550, 2890]), npcId: N.COPPER_LONGTAIL });
  fire('hunter:success', { player: player([2320, 3590]), npcId: N.SPINED_LARUPIA });
  fire('hunter:success', { player: player([2550, 2890]), npcId: N.DASHING_KEBBIT });
  assert.deepEqual(tasks(), []);
});

test('Pest Control credits the boat that was won and no other', () => {
  reset();
  const who = player();
  fire('pest-control:won', { player: who, boat: 'novice' });
  fire('pest-control:won', { player: who, boat: 'intermediate' });
  fire('pest-control:won', { player: who, boat: 'veteran' });
  assert.deepEqual(tasks(), [T.novicePestControl, T.intermediatePestControl, T.veteranPestControl]);
  reset();
  fire('pest-control:won', { player: who, boat: 'unknown' });
  assert.deepEqual(tasks(), []);
});

test('the Pest Control minigame teleport credits on arrival, other minigames do not', () => {
  reset();
  const who = player();
  fire('minigame-teleport:arrived', { player: who, minigame: 'Pest Control' });
  assert.deepEqual(tasks(), [T.pestControlTeleport]);
  reset();
  fire('minigame-teleport:arrived', { player: who, minigame: 'Castle Wars' });
  assert.deepEqual(tasks(), []);
});

test('travel credits the Gnome Stronghold spirit tree, the Feldip glider and the Feldip eagle', () => {
  reset();
  const who = player();
  fire('spirit-trees:travelled', { player: who, tree: 'Gnome Stronghold' });
  fire('gnome-gliders:arrived', { player: who, destination: { area: 'Feldip Hills' } });
  fire('eagle-transport:arrived', { player: who, to: [2520, 9325, 0] });
  assert.deepEqual(tasks(), [T.spiritTree, T.feldipGlider, T.feldipEagle]);
  reset();
  fire('spirit-trees:travelled', { player: who, tree: 'Feldip Hills' });
  fire('gnome-gliders:arrived', { player: who, destination: { area: 'Ape Atoll' } });
  fire('eagle-transport:arrived', { player: who, to: [2022, 4960, 3] });
  assert.deepEqual(tasks(), []);
});

test('only a palm-tree health check in Lletya credits the palm task', () => {
  reset();
  const who = player();
  fire('farming:check-health', { player: who, type: 'FRUIT_TREE', crop: 'PALM', patch: { x: 2346, y: 3161, z: 0 } });
  assert.deepEqual(tasks(), [T.lletyaPalm]);
  reset();
  fire('farming:check-health', { player: who, type: 'FRUIT_TREE', crop: 'APPLE', patch: { x: 2346, y: 3161, z: 0 } });
  fire('farming:check-health', { player: who, type: 'FRUIT_TREE', crop: 'PALM', patch: { x: 2800, y: 3400, z: 0 } });
  fire('farming:check-health', { player: who, type: 'TREE', patch: { x: 2346, y: 3161, z: 0 } });
  assert.deepEqual(tasks(), []);
});

test('the Ape Atoll teleport landing credits, another landing does not', () => {
  reset();
  const who = player();
  fire('teleport:landed', { player: who, to: new core.Location(2796, 2798, 0) });
  assert.deepEqual(tasks(), [T.apeAtollTeleport]);
  reset();
  fire('teleport:landed', { player: who, to: new core.Location(3222, 3218, 0) });
  assert.deepEqual(tasks(), []);
});

test('gnome and elf pickpockets credit their own tasks, other targets do not', () => {
  reset();
  const who = player();
  fire('thieving:success', { player: who, method: 'pickpocket', target: 'gnome' });
  fire('thieving:success', { player: who, method: 'pickpocket', target: 'elf' });
  assert.deepEqual(tasks(), [T.gnomePickpocket, T.elfPickpocket]);
  reset();
  fire('thieving:success', { player: who, method: 'stall', target: 'gnome' });
  fire('thieving:success', { player: who, method: 'pickpocket', target: 'man' });
  assert.deepEqual(tasks(), []);
});

test('a complete void set credits only with every piece worn', () => {
  const ids = core.ItemIdentifiers;
  const E = core.Equipment;
  const wear = (...worn) => {
    const items = [];
    for (const [slot, id] of worn) items[slot] = new core.Item(id, 1);
    return player([2500, 3500], { getEquipment: () => ({ getItems: () => items }) });
  };
  reset();
  fire('equipment:changed', { player: wear([E.HEAD_SLOT, ids.VOID_RANGER_HELM], [E.BODY_SLOT, ids.VOID_KNIGHT_TOP], [E.LEG_SLOT, ids.VOID_KNIGHT_ROBE], [E.HANDS_SLOT, ids.VOID_KNIGHT_GLOVES]) });
  assert.deepEqual(tasks(), [T.voidSet]);
  reset();
  fire('equipment:changed', { player: wear([E.HEAD_SLOT, ids.VOID_RANGER_HELM], [E.BODY_SLOT, ids.VOID_KNIGHT_TOP], [E.LEG_SLOT, ids.VOID_KNIGHT_ROBE]) });
  fire('equipment:changed', { player: wear([E.HEAD_SLOT, ids.VOID_RANGER_HELM], [E.BODY_SLOT, ids.VOID_KNIGHT_TOP], [E.LEG_SLOT, ids.BLACK_PLATELEGS], [E.HANDS_SLOT, ids.VOID_KNIGHT_GLOVES]) });
  assert.deepEqual(tasks(), []);
});

test('mining credits the named ore at its Wiki mine only', () => {
  const ids = core.ItemIdentifiers;
  const mine = (who, x, y, ore) => {
    fire('mining:attempt', { player: who, object: objectAt(x, y, 0, 'rocks'), success: true });
    fire('mining:success', { player: who, itemId: ore });
  };
  reset();
  const who = player();
  mine(who, 2338, 3640, ids.IRON_ORE);
  mine(who, 2489, 9909, ids.GOLD_ORE);
  mine(who, 2279, 3159, ids.ADAMANTITE_ORE);
  assert.deepEqual(tasks(), [T.ironPiscatoris, T.goldGrandTree, T.adamantiteTirannwn]);
  reset();
  mine(who, 3100, 3300, ids.IRON_ORE);
  mine(who, 2338, 3640, ids.COAL);
  assert.deepEqual(tasks(), []);
});

test('bass is credited on Ape Atoll; monkfish needs the Piscatoris catch and cook', () => {
  const ids = core.ItemIdentifiers;
  reset();
  const who = player([2700, 2700]);
  fire('fishing:success', { player: who, itemId: ids.RAW_BASS });
  assert.deepEqual(tasks(), [T.bassApeAtoll]);
  reset();
  who.moveTo(new core.Location(3000, 3000, 0));
  fire('fishing:success', { player: who, itemId: ids.RAW_BASS });
  assert.deepEqual(tasks(), [], 'bass elsewhere');

  const cook = player([2320, 3700]);
  fire('fishing:success', { player: cook, itemId: ids.RAW_MONKFISH });
  fire('cooking:success', { player: cook, itemId: ids.MONKFISH });
  assert.deepEqual(tasks(), [T.monkfishPiscatoris]);
  reset();
  const cold = player([2320, 3700]);
  fire('cooking:success', { player: cold, itemId: ids.MONKFISH });
  assert.deepEqual(tasks(), [], 'cooked without a Piscatoris catch');
});

test('teak and mahogany need the Ape Atoll chop before the burn', () => {
  const ids = core.ItemIdentifiers;
  const who = player([2700, 2700]);
  reset();
  fire('firemaking:success', { player: who, itemId: ids.TEAK_LOGS });
  assert.deepEqual(tasks(), [], 'brought-in logs alone');
  fire('woodcutting:success', { player: who, logId: ids.TEAK_LOGS });
  fire('woodcutting:success', { player: who, logId: ids.MAHOGANY_LOGS });
  fire('firemaking:success', { player: who, itemId: ids.MAHOGANY_LOGS });
  assert.deepEqual(tasks(), [T.mahoganyApeAtoll]);
  fire('firemaking:success', { player: who, itemId: ids.TEAK_LOGS });
  assert.deepEqual(tasks(), [T.mahoganyApeAtoll, T.teakApeAtoll]);
});


test('a Chocolate bomb made at the Grand Tree range credits; elsewhere or another dish does not', () => {
  const ids = core.ItemIdentifiers;
  reset();
  const cook = player([2480, 3480, 1]);
  fire('skills:produced', { player: cook, itemId: ids.CHOCOLATE_BOMB, kind: 'make' });
  assert.deepEqual(tasks(), [T.chocolateBomb]);
  reset();
  cook.moveTo(new core.Location(2400, 3500, 0));
  fire('skills:produced', { player: cook, itemId: ids.CHOCOLATE_BOMB, kind: 'make' });
  fire('skills:produced', { player: player([2480, 3480, 1]), itemId: ids.POT_OF_CREAM, kind: 'make' });
  assert.deepEqual(tasks(), []);
});

test('Prissy Scilla protecting the Grand Tree magic-tree patch credits after the successful payment event', () => {
  reset();
  const who = player([2438, 3418]);
  const prissy = npcAt(2436, 3415, 0, 'Prissy Scilla');
  fire('farming:protected', { player: who, npc: prissy, patch: { x: 2435, y: 3414, z: 0 }, crop: 'MAGIC' });
  assert.deepEqual(tasks(), [T.prissyScilla]);
  reset();
  fire('farming:protected', { player: who, npc: prissy, patch: { x: 2435, y: 3414, z: 0 }, crop: 'YEW' });
  fire('farming:protected', { player: who, npc: npcAt(2436, 3415, 0, 'Gardener'), patch: { x: 2435, y: 3414, z: 0 }, crop: 'MAGIC' });
  fire('farming:protected', { player: who, npc: prissy, patch: { x: 2800, y: 3400, z: 0 }, crop: 'MAGIC' });
  assert.deepEqual(tasks(), []);
});

test('another diary task between the Ape Atoll chop and burn resets the pending chop', () => {
  const ids = core.ItemIdentifiers;
  const who = player([2700, 2700]);
  reset();
  fire('woodcutting:success', { player: who, logId: ids.TEAK_LOGS });
  fire('diary:task', { player: who, diary: 'western', task: 'catch-a-copper-longtail', completed: true });
  fire('firemaking:success', { player: who, itemId: ids.TEAK_LOGS });
  assert.deepEqual(tasks(), []);
});

test('a swamp toad from the north-west pen counts; one from the south-west area does not', () => {
  const ids = core.ItemIdentifiers;
  reset();
  const who = player();
  const take = (x, y) => fire('ground-items:taken', { player: who, itemId: ids.SWAMP_TOAD, groundItem: { getPosition: () => new core.Location(x, y, 0) } });
  take(2385, 3412);
  assert.deepEqual(tasks(), []);
  take(2416, 3515);
  assert.deepEqual(tasks(), [T.swampToad]);
});

test('chompy hats credit the tiers whose kill count was reached when the hat was claimed', () => {
  reset();
  const who = player();
  fire('big-chompy-bird-hunting:hat-claimed', { player: who, kills: 30 });
  assert.deepEqual(tasks(), [T.chompyHat]);
  reset();
  fire('big-chompy-bird-hunting:hat-claimed', { player: who, kills: 300 });
  assert.deepEqual(tasks(), [T.chompyHat, T.chompyHat125, T.chompyHat300]);
  reset();
  fire('big-chompy-bird-hunting:hat-claimed', { player: who, kills: 1000 });
  assert.deepEqual(tasks(), [T.chompyHat, T.chompyHat125, T.chompyHat300, T.chompyHat1000]);
});

test('the two Western agility shortcuts credit by their own names', () => {
  reset();
  const who = player();
  fire('agility:obstacle', { player: who, shortcut: 'Rocks (Tree Gnome Stronghold, down)' });
  fire('agility:obstacle', { player: who, shortcut: 'Rocks (Tirannwn advanced)' });
  assert.deepEqual(tasks(), [T.grandTreeShortcut, T.elvenOverpass]);
  reset();
  fire('agility:obstacle', { player: who, shortcut: 'Rocks (Tree Gnome Stronghold, up)' });
  fire('agility:obstacle', { player: who, shortcut: 'Rocks (Tirannwn medium)' });
  assert.deepEqual(tasks(), []);
});

test('Zulrah and the Thermonuclear smoke devil credit their kills, with the room checked for the latter', () => {
  reset();
  const who = player();
  fire('combat-achievements:kill', { player: who, monster: 'Zulrah' });
  assert.deepEqual(tasks(), [T.zulrah]);
  reset();
  for (const handler of deaths) handler({ killer: who, npc: npcAt(2360, 9452, 0, 'Thermonuclear smoke devil') });
  assert.deepEqual(tasks(), [T.thermonuclear]);
  reset();
  for (const handler of deaths) handler({ killer: who, npc: npcAt(2600, 3100, 0, 'Thermonuclear smoke devil') });
  assert.deepEqual(tasks(), []);
});

test('a Terrorbird in the enclosure and an elf killed with a crystal bow or Bow of Faerdhinen credit', () => {
  const ids = core.ItemIdentifiers;
  const armed = (id) => player([2500, 3500], { getEquipment: () => ({ get: () => new core.Item(id, 1), getItems: () => [] }) });
  const kill = (who, victim) => { for (const handler of deaths) handler({ killer: who, npc: victim }); };
  reset();
  kill(player(), npcAt(2378, 3432, 0, 'Terrorbird'));
  kill(armed(ids.CRYSTAL_BOW_FULL), npcAt(2329, 3173, 0, 'Elf Warrior'));
  kill(armed(ids.BOW_OF_FAERDHINEN), npcAt(2336, 3167, 0, 'Elf Archer'));
  assert.deepEqual(tasks(), [T.terrorbird, T.elfCrystalBow, T.elfCrystalBow]);
  reset();
  kill(player(), npcAt(2500, 3200, 0, 'Terrorbird'));
  kill(armed(ids.TWISTED_BOW), npcAt(2329, 3173, 0, 'Elf Warrior'));
  kill(armed(ids.CRYSTAL_BOW_FULL), npcAt(2329, 3173, 0, 'Elf Tracker'));
  assert.deepEqual(tasks(), []);
});

test('gnome restaurant delivery, crystal saw and Brimstail essence teleport credit', () => {
  reset();
  const who = player();
  fire('gnome-restaurant:delivered', { player: who });
  fire('crystal-saw:made', { player: who });
  fire('runecrafting:brimstail-essence', { player: who });
  fire('construction:furniture-built', { player: who, buildable: { key: 'ISAFDAR_LANDSCAPE' } });
  assert.deepEqual(tasks(), [T.gnomeRestaurant, T.crystalSaw, T.brimstailTeleport, T.isafdarPainting]);
  reset();
  fire('construction:furniture-built', { player: who, buildable: { key: 'KARAMJA_LANDSCAPE' } });
  assert.deepEqual(tasks(), []);
});

test('an inactive player earns nothing', () => {
  reset();
  const dead = player([2320, 3590], { getHitpoints: () => 0 });
  fire('hunter:success', { player: dead, npcId: core.NpcIdentifiers.COPPER_LONGTAIL });
  fire('pest-control:won', { player: dead, boat: 'novice' });
  assert.deepEqual(tasks(), []);
});

test('only a newly completed diary task resets the pending Ape Atoll chop; repeats and rejects do not', () => {
  const Diaries = require('../plugins/achievements/AchievementDiaries.plugin');
  const Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
  const diary = Data.BY_KEY.get('western');
  const repeatTask = diary.tiers.easy.tasks[0].key;
  const interveningTask = diary.tiers.easy.tasks[1].key;
  const handlers = new Map();
  const emitted = [];
  const bus = new Proxy({
    core,
    emitCustomEvent(name, payload) { for (const handler of handlers.get(name) ?? []) handler(payload); },
    onCustomEvent(name, handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    onNpcDeath() {},
    persistAttribute() {},
    getTaskManager: () => ({ submit() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Progress(bus);
  // Production order: AchievementDiaries (whose onTask sets `completed`) before the Western listener.
  handlers.set('diary:task', [Diaries._test.onTask, (event) => emitted.push({ ...event })]);
  Western.register(bus);

  const diaryPlayer = () => {
    const attributes = new Map();
    const sender = { sendVarbit: () => sender, sendConfig: () => sender };
    return {
      isRegistered: () => true,
      getHitpoints: () => 99,
      isDyingReturn: () => false,
      getLocation: () => new core.Location(2700, 2700, 0),
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      sendMessage() {},
      getPacketSender: () => sender,
      getDialogueManager: () => ({ startDialogues() {} }),
      getEquipment: () => ({ getItems: () => [], get: () => new core.Item(-1, 0) }),
    };
  };
  const chop = (player) => bus.emitCustomEvent('woodcutting:success', { player, logId: core.ItemIdentifiers.TEAK_LOGS });
  const burn = (player) => bus.emitCustomEvent('firemaking:success', { player, itemId: core.ItemIdentifiers.TEAK_LOGS });
  const teakCredits = () => emitted.filter((event) => event.diary === 'western' && event.task === T.teakApeAtoll && event.completed === true).length;

  const repeated = diaryPlayer();
  Progress.completeTask(repeated, diary, repeatTask);
  chop(repeated);
  bus.emitCustomEvent('diary:task', { player: repeated, diary: 'western', task: repeatTask });
  burn(repeated);
  assert.equal(teakCredits(), 1, 'an already-completed repeat must not reset the pending chop');

  emitted.length = 0;
  const rejected = diaryPlayer();
  chop(rejected);
  bus.emitCustomEvent('diary:task', { player: rejected, diary: 'not-a-diary', task: repeatTask });
  burn(rejected);
  assert.equal(teakCredits(), 1, 'a rejected task must not reset the pending chop');

  emitted.length = 0;
  const interrupted = diaryPlayer();
  chop(interrupted);
  bus.emitCustomEvent('diary:task', { player: interrupted, diary: 'western', task: interveningTask });
  assert.equal(emitted.some((event) => event.task === interveningTask && event.completed === true), true);
  burn(interrupted);
  assert.equal(teakCredits(), 0, 'a newly completed intervening task resets the chop');

  emitted.length = 0;
  const once = diaryPlayer();
  chop(once);
  burn(once);
  burn(once);
  assert.equal(teakCredits(), 1, 'the intended burn credits exactly once');
});
