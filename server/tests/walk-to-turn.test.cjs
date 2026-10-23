'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Task } = require('../dist/game/task/Task');
const { TaskType } = require('../dist/game/task/TaskType');
const { TaskManager } = require('../dist/game/task/TaskManager');

class CountingTask extends Task {
  constructor(key, type, count) {
    super(0, key, false);
    this.type = type;
    this.count = count;
  }
  execute() {
    this.count();
  }
}

test('a walk-to submitted during its owner\'s turn gets that turn\'s reach check', (t) => {
  const key = 'walk-to-turn';
  const other = 'walk-to-turn-other';
  t.after(() => { TaskManager.cancelTasks(key); TaskManager.cancelTasks(other); TaskManager.process(); });
  const ticks = { walk: 0, otherWalk: 0, plain: 0 };

  // The cycle's task pass has already run when client input reaches the player's turn.
  TaskManager.process();
  TaskManager.submit(new CountingTask(key, TaskType.WALK_TO, () => ticks.walk++));
  TaskManager.submit(new CountingTask(other, TaskType.WALK_TO, () => ticks.otherWalk++));
  TaskManager.submit(new CountingTask(key, undefined, () => ticks.plain++));

  TaskManager.processWalkTo(key);
  assert.equal(ticks.walk, 1, 'the reach check runs after this turn\'s movement, on the click cycle');
  TaskManager.processWalkTo(key);
  assert.equal(ticks.walk, 1, 'once per cycle');
  assert.equal(ticks.otherWalk, 0, 'another owner\'s walk-to waits for its own turn');
  assert.equal(ticks.plain, 0, 'other tasks still wait for the next task pass');

  TaskManager.process();
  assert.equal(ticks.plain, 1);
  assert.equal(ticks.walk, 1, 'the task pass never ticks walk-to tasks');
  TaskManager.processWalkTo(key);
  TaskManager.processWalkTo(other);
  assert.equal(ticks.walk, 2);
  assert.equal(ticks.otherWalk, 1);
});
