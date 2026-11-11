// Run after `yarn build`: node --test tests/giants-foundry.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const Shared = require('../plugins/minigames/giantsfoundry/Shared.GiantsFoundry');
const Crucible = require('../plugins/minigames/giantsfoundry/Crucible.GiantsFoundry');
const Mould = require('../plugins/minigames/giantsfoundry/Mould.GiantsFoundry');
const Tools = require('../plugins/minigames/giantsfoundry/Tools.GiantsFoundry');
const Kovac = require('../plugins/minigames/giantsfoundry/Kovac.GiantsFoundry');
const Preform = require('../plugins/minigames/giantsfoundry/Preform.GiantsFoundry');

before(() => {
  CachePipeline.initialize();
  Shared.bind({ core: PluginManager.getCoreApi(), emitCustomEvent() {} });
});

/** Crucible counts, bronze to rune. */
function metals({ bronze = 0, iron = 0, steel = 0, mithril = 0, adamant = 0, rune = 0 }) {
  return [bronze, iron, steel, mithril, adamant, rune];
}

test('metal score matches the Wiki examples', () => {
  assert.equal(Crucible.metalScore(metals({ bronze: 28 })), 10);
  assert.equal(Crucible.metalScore(metals({ rune: 28 })), 60);
  assert.equal(Crucible.metalScore(metals({ bronze: 14, iron: 14 })), 20); // rsprox recording 565
  assert.equal(Crucible.metalScore(metals({ steel: 19, mithril: 9 })), 59);
  assert.equal(Crucible.metalScore(metals({ mithril: 18, adamant: 10 })), 89);
  assert.equal(Crucible.metalScore(metals({ adamant: 19, rune: 9 })), 118);
  assert.equal(Crucible.metalScore(metals({ adamant: 14, rune: 14 })), 130);
  // Only the two most common metals count.
  assert.equal(Crucible.metalScore(metals({ bronze: 2, adamant: 13, rune: 13 })), Crucible.metalScore(metals({ adamant: 13, rune: 13 })));
});

test('equipment is worth its smithing cost minus a bar', () => {
  assert.deepEqual(Crucible.metalValue(I.BRONZE_BAR), { metal: 0, bars: 1, bar: true });
  assert.deepEqual(Crucible.metalValue(I.IRON_PLATEBODY), { metal: 1, bars: 4, bar: false });
  assert.deepEqual(Crucible.metalValue(I.RUNE_PLATELEGS), { metal: 5, bars: 2, bar: false });
  assert.deepEqual(Crucible.metalValue(I.IRON_LONGSWORD), { metal: 1, bars: 1, bar: false });
  assert.equal(Crucible.metalValue(I.BRONZE_DAGGER), null); // one bar to smith, nothing to melt
  assert.equal(Crucible.metalValue(I.BLACK_PLATEBODY), null);
});

test('mould parts and scores come from the cache', () => {
  const forte = Mould.part(0, 1);
  assert.equal(forte.name, 'Spiker!');
  assert.equal(forte.level, 79);
  // rsprox recording 565: Spiker! + Choppa! + Serrated Tip for Light Spiked score 64.
  assert.equal(Mould.score([1, 1, 3], [Kovac.WORD.LIGHT, Kovac.WORD.SPIKED]), 64);
  // Wiki: Medusa Ricasso + Medusa Blade + Saw Tip is the best default mould for Broad Heavy, 44.
  const index = (tab, name) => [...Mould.allParts()[tab].values()].find((part) => part.name === name).index;
  const medusa = [index(0, 'Medusa Ricasso'), index(1, 'Medusa Blade'), index(2, 'Saw Tip')];
  assert.equal(Mould.score(medusa, [Kovac.WORD.BROAD, Kovac.WORD.HEAVY]), 44);
});

test('bought moulds unlock through the varbits script 6099 checks', () => {
  assert.equal(Mould.unlockVarbit(0, 4297), Shared.VARBIT.UNLOCK_FORTE_FIRST);
  assert.equal(Mould.unlockVarbit(1, 4312), Shared.VARBIT.UNLOCK_BLADE_FIRST + 4);
  assert.equal(Mould.unlockVarbit(2, 4319), Shared.VARBIT.UNLOCK_TIP_FIRST);
  assert.equal(Mould.unlockVarbit(0, 4291), null);
});

test('commissions never pair two words on one axis', () => {
  assert.equal(Kovac.PAIRS.length, 12);
  const axis = { 1: 0, 4: 0, 2: 1, 5: 1, 3: 2, 6: 2 };
  for (const [first, second] of Kovac.PAIRS) assert.notEqual(axis[first], axis[second]);
});

test('heat zones and stages follow the HUD scripts', () => {
  assert.deepEqual(Tools.heatZone(Tools.TOOL.HAMMER, 0), { start: 666, end: 999 });
  assert.deepEqual(Tools.heatZone(Tools.TOOL.POLISH, 130), { start: 83, end: 249 });
  assert.equal(Tools.stageCount(19), 3);
  assert.equal(Tools.stageCount(20), 4);
  assert.equal(Tools.stageCount(130), 7);
  assert.equal(Tools.stageOf(999, 4), 3);
  assert.equal(Tools.stageOf(1000, 4), 3);
  assert.equal(Tools.sweetSpotCount(5), 2);
  assert.equal(Tools.sweetSpotCount(6), 3);
});

test('stage tools never repeat back to back, starting after the hammer', () => {
  for (let run = 0; run < 200; run++) {
    const seeds = Preform.rollSeeds(7);
    let previous = Tools.TOOL.HAMMER;
    for (const seed of seeds) {
      assert.notEqual(seed, previous);
      previous = seed;
    }
  }
});

test('the trip hammer works on the room hammer cycle, not from the click', () => {
  assert.equal(Shared.HAMMER_PERIOD, 5);
  assert.equal(Tools.TOOLS[Tools.TOOL.HAMMER].cycle, Shared.HAMMER_PERIOD, 'the room and the hammer share the cycle');
  // recording 101: the hits land on 94, 99, 104, 109, 114, 209, 214, 354, 359, 364, all the same
  // tick of the cycle, whichever tick the player started swinging on.
  const hits = [94, 99, 104, 109, 114, 209, 214, 354, 359, 364];
  assert.equal(new Set(hits.map((tick) => tick % 5)).size, 1, 'one tick of the cycle');
  // So the hammer is due on the room's ticks and not on the ticks in between, whatever it has done.
  const hammer = { tool: Tools.TOOL.HAMMER, sinceAction: 0 };
  for (const now of [0, 5, 10, 95, 100, 1000]) assert.equal(Tools.due(hammer, now), true, `tick ${now}`);
  for (const now of [1, 2, 3, 4, 94, 99]) assert.equal(Tools.due(hammer, now), false, `tick ${now}`);
  hammer.sinceAction = 4;
  assert.equal(Tools.due(hammer, 11), false, 'the count from the click no longer decides');
  // the grindstone counts from the click instead: recording 101 has it on even ticks in one stretch
  // and odd ticks in the next.
  const grind = { tool: Tools.TOOL.GRIND, sinceAction: 0 };
  assert.equal(Tools.due(grind, 3), false);
  grind.sinceAction = 2;
  assert.equal(Tools.due(grind, 3), true);
});

test('hand-in XP follows the Wiki formula', () => {
  assert.equal(Kovac.swordXp(0), 30);
  assert.equal(Kovac.swordXp(188), 23010); // rsprox recording 101
  assert.equal(Kovac.swordXp(199), 25230);
  assert.equal(Kovac.duration(3130000), '52m 10s');
  assert.equal(Kovac.duration(3723000), '1h 2m 3s');
});

test('the worn preform is held in the giant two-handed stance', () => {
  const names = require('../data/definitions/sequence-names.json');
  assert.deepEqual(
    [Preform.STANCE[0], Preform.STANCE[2], Preform.STANCE[6]].map((id) => names[id]),
    ['HUMAN_WEAPON_GIANT01_READY', 'HUMAN_WEAPON_GIANT01_WALK', 'HUMAN_WEAPON_GIANT01_RUN'],
  );
  assert.equal(Preform.STANCE.length, 7);
});
