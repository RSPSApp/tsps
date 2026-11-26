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
const Temperature = require('../plugins/minigames/giantsfoundry/Temperature.GiantsFoundry');

const temperatureOptions = new Map();

before(() => {
  CachePipeline.initialize();
  Shared.bind({ core: PluginManager.getCoreApi(), emitCustomEvent() {} });
  Temperature({ onObjectInteraction: (name, options) => temperatureOptions.set(name, options) });
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

const fastSteps = [27, 30, 33, 37, 41, 45, 49, 53, 57, 62, 67, 72, 77, 83, 89, 95];

function temperatureRun(t, initial, firstCycle = 1) {
  const { Equipment, Location } = Shared.core();
  const attributes = new Map();
  const varbits = new Map();
  const temperatures = [];
  const sequences = [];
  const sounds = [];
  const temp = Shared.VARBIT.TEMPERATURE;
  let location = new Location(3370, 11497, 0);
  let cycle = firstCycle;
  const packets = {
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit: (id, value) => {
      varbits.set(id, value);
      if (id === temp) temperatures.push(value);
    },
    sendSound: (id) => sounds.push(id),
  };
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getEquipment: () => ({ get: (slot) => slot === Equipment.WEAPON_SLOT ? { getId: () => Shared.ITEM.PREFORM } : null }),
    getLocation: () => location,
    getPacketSender: () => packets,
    performAnimation: (animation) => sequences.push(animation.getId()),
  };
  t.mock.method(Shared, 'questComplete', () => true);
  t.after(() => Shared.stopWork(player));
  const temperature = () => Shared.get(player, temp);
  const setTemperature = (value) => Shared.set(player, temp, value);
  setTemperature(initial);
  return {
    lava: (option) => assert.equal(temperatureOptions.get(Shared.OBJECT.LAVA_POOL)[option]({ player }), true),
    waterfall: (option) => assert.equal(temperatureOptions.get(Shared.OBJECT.WATERFALL)[option]({ player }), true),
    stop: () => Shared.stopWork(player),
    move: () => { location = new Location(3370, 11498, 0); },
    temperature,
    setTemperature,
    tick() {
      const before = temperature();
      const passive = cycle % 2 === 0 && before > 0 ? 1 : 0;
      temperatures.length = sequences.length = sounds.length = 0;
      Shared.runTick(player, cycle++);
      return {
        step: temperature() - before + passive,
        temperatures: [...temperatures],
        sequences: [...sequences],
        sounds: [...sounds],
      };
    },
  };
}

test('the fast temperature table includes the recorded sixteenth step', () => {
  assert.deepEqual(Temperature.FAST_STEPS, fastSteps);
});

test('Dunk-preform follows the recorded steps and repeats the last step', (t) => {
  const run = temperatureRun(t, 0);
  run.lava('Dunk-preform');
  for (const [i, step] of fastSteps.entries()) {
    const dip = run.tick();
    assert.deepEqual(dip.sequences, [827]);
    assert.deepEqual(dip.sounds, [1019]);
    assert.equal(dip.step, step, `dip ${i + 1}`);
  }
  // Give the estimated 17th step room to fit below the cap without starting another run.
  run.setTemperature(900);
  assert.equal(run.tick().step, 95);
});

test('Quench-preform follows the same fast steps with the opposite sign', (t) => {
  const run = temperatureRun(t, 1000);
  run.waterfall('Quench-preform');
  for (const [i, step] of fastSteps.entries()) {
    const dip = run.tick();
    assert.deepEqual(dip.sequences, [832]);
    assert.deepEqual(dip.sounds, [1006]);
    assert.equal(dip.step, -step, `dip ${i + 1}`);
  }
});

test('Heat-preform dips before changing heat, then follows the four recorded increases', (t) => {
  const run = temperatureRun(t, 500);
  run.lava('Heat-preform');
  assert.deepEqual(run.tick(), { step: 0, temperatures: [], sequences: [827], sounds: [1019] });
  assert.equal(run.temperature(), 500);
  for (const step of [7, 8, 9, 11]) assert.equal(run.tick().step, step);
});

test('Cool-preform dips before changing heat, then cools by seven', (t) => {
  const run = temperatureRun(t, 993);
  run.waterfall('Cool-preform');
  assert.deepEqual(run.tick(), { step: 0, temperatures: [], sequences: [832], sounds: [1006] });
  assert.equal(run.temperature(), 993);
  assert.deepEqual(run.tick(), { step: -7, temperatures: [992, 985], sequences: [832], sounds: [1006] });
});

test('Dunk-preform keeps its pace when clicked again during a run', (t) => {
  const run = temperatureRun(t, 500);
  run.lava('Dunk-preform');
  for (const step of [27, 30, 33, 37]) assert.equal(run.tick().step, step);
  run.lava('Dunk-preform');
  assert.equal(run.tick().step, 41);
});

test('Dunk-preform starts at 27 after the previous run has stopped', (t) => {
  const run = temperatureRun(t, 500);
  run.lava('Dunk-preform');
  for (const step of [27, 30, 33]) assert.equal(run.tick().step, step);
  run.stop();
  run.lava('Dunk-preform');
  assert.equal(run.tick().step, 27);
});

test('Heat-preform starts at its first dip after movement stops a run', (t) => {
  const run = temperatureRun(t, 500);
  run.lava('Heat-preform');
  const initial = [run.tick(), run.tick()];
  assert.deepEqual(initial.map(({ sounds }) => sounds), [[1019], [1019]]);
  run.move();
  assert.deepEqual(run.tick().sounds, []);
  run.lava('Heat-preform');
  assert.deepEqual([run.tick().step, run.tick().step], initial.map(({ step }) => step));
});

test('Dunk-preform starts at 27 after two Heat-preform dips', (t) => {
  const run = temperatureRun(t, 500);
  run.lava('Heat-preform');
  assert.deepEqual(run.tick().sounds, [1019]);
  assert.deepEqual(run.tick().sounds, [1019]);
  run.lava('Dunk-preform');
  assert.equal(run.tick().step, 27);
});

test('the run ends after clamping to 1000, even if the next tick cools the preform', (t) => {
  const run = temperatureRun(t, 776);
  run.lava('Dunk-preform');
  for (const step of [27, 30, 33, 37, 41, 45]) assert.equal(run.tick().step, step);
  assert.equal(run.temperature(), 986);
  assert.equal(run.tick().step, 14);
  assert.equal(run.temperature(), 1000);
  assert.deepEqual(run.tick().sounds, []);
  assert.equal(run.temperature(), 999);
});

test('a same-option click on the clamp tick does not extend the run', (t) => {
  const run = temperatureRun(t, 808, 2);
  run.lava('Dunk-preform');
  for (const step of [27, 30, 33, 37, 41]) assert.equal(run.tick().step, step);
  assert.equal(run.temperature(), 973);

  run.lava('Dunk-preform');
  assert.equal(run.tick().step, 27);
  assert.equal(run.temperature(), 1000);
  assert.deepEqual(run.tick().sounds, []);
  assert.equal(run.temperature(), 999);
  run.lava('Dunk-preform');
  assert.equal(run.tick().step, 1);
  assert.equal(run.temperature(), 1000);
});

test('passive cooling is sent before a fast dip on an even tick', (t) => {
  const run = temperatureRun(t, 500, 2);
  run.lava('Dunk-preform');
  assert.deepEqual(run.tick(), { step: 27, temperatures: [499, 526], sequences: [827], sounds: [1019] });
});
