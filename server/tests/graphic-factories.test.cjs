// Run after `yarn build`: node --test tests/graphic-factories.test.cjs
//
// new Graphic(id, n) decides from n's value what it is: 0-2 read as a Priority, a GraphicHeight value
// (50, 92, 96, 100, 124) as a height, anything else as a delay. Graphic.delayed / Graphic.atHeight say
// which one they mean, so a delay of 100 (or of 1) stays a delay and a height of 80 stays a height.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Graphic } = require('../dist/game/model/Graphic');
const { GraphicHeight } = require('../dist/game/model/GraphicHeight');
const { Priority } = require('../dist/game/model/Priority');

const parts = (graphic) => [graphic.getId(), graphic.getDelay(), graphic.getHeight(), graphic.getPriority()];

test('the two-argument constructor still guesses, unchanged', () => {
  assert.deepEqual(parts(new Graphic(1, 100)), [1, 0, GraphicHeight.HIGH, Priority.LOW], '100 reads as a height');
  assert.deepEqual(parts(new Graphic(1, 2)), [1, 0, GraphicHeight.LOW, Priority.HIGH], '2 reads as a priority');
  assert.deepEqual(parts(new Graphic(1, 80)), [1, 80, GraphicHeight.LOW, Priority.LOW], '80 reads as a delay');
});

test('Graphic.delayed keeps every delay a delay', () => {
  for (const delay of [0, 1, 2, 30, 50, 92, 96, 100, 124, 155]) {
    assert.deepEqual(parts(Graphic.delayed(7, delay)), [7, delay, GraphicHeight.LOW, Priority.LOW], `delay ${delay}`);
  }
  assert.deepEqual(parts(Graphic.delayed(7, 40, GraphicHeight.SPELL_IMPACT)), [7, 40, 124, Priority.LOW]);
  assert.deepEqual(parts(Graphic.delayed(7, 40, 1)), [7, 40, 1, Priority.LOW], 'a height of 1 is not a priority');
});

test('Graphic.atHeight keeps every height a height', () => {
  for (const height of [0, 1, 2, 80, 92, 124, 130]) {
    assert.deepEqual(parts(Graphic.atHeight(7, height)), [7, 0, height, Priority.LOW], `height ${height}`);
  }
  assert.deepEqual(parts(Graphic.atHeight(7, GraphicHeight.HIGH, 30)), [7, 30, 100, Priority.LOW]);
});
