const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIfAction } = require('../plugins/bots/brain/actions/If.PlayerBots');

test('if chooses once per entry, keeps per-player state and cleans up', () => {
  const events = [];
  const branch = name => ({ id: name, update(ctx) { events.push(`${ctx.player.name}:${name}`); return 'running'; }, stop(ctx) { events.push(`${ctx.player.name}:stop:${name}`); } });
  let checks = 0;
  const action = createIfAction({ check(ctx) { checks++; return ctx.player.hasItem; } }, branch('yes'), branch('no'));
  const a = { player: { name: 'a', hasItem: true } }, b = { player: { name: 'b', hasItem: false } };
  action.update(a); a.player.hasItem = false; action.update(a); action.update(b);
  assert.equal(checks, 2);
  assert.deepEqual(events, ['a:yes', 'a:yes', 'b:no']);
  action.stop(a); action.update(a);
  assert.equal(checks, 3);
  assert.deepEqual(events.slice(-2), ['a:stop:yes', 'a:no']);
});

test('empty branch succeeds', () => {
  const action = createIfAction({ check: () => false }, { update: () => 'failed' }, null);
  const ctx = { player: {} };
  assert.equal(action.update(ctx), 'success');
  action.stop(ctx);
});
