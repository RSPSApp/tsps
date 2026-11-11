// Run after `yarn build`: node --test tests/world-config-declarations.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  checkConfigValue, validateDeclaration, WORLD_SETTING_DECLARATIONS, CORE_CONFIG_DECLARATIONS,
} = require('../dist/game/definition/WorldSettingDeclarations');

test('numbers accept numeric strings and honour min', () => {
  assert.deepEqual(checkConfigValue({ type: 'number', min: 1 }, '30'), { ok: true, value: 30 });
  assert.equal(checkConfigValue({ type: 'number', min: 1 }, 'abc').ok, false);
  assert.equal(checkConfigValue({ type: 'number', min: 1 }, 0).ok, false);
});

test('enum, boolean and date checks', () => {
  assert.equal(checkConfigValue({ type: 'enum', values: [{ value: 'a', label: 'A' }] }, 'b').ok, false);
  assert.equal(checkConfigValue({ type: 'enum', values: [{ value: 'a', label: 'A' }] }, 'a').ok, true);
  assert.equal(checkConfigValue({ type: 'boolean' }, 'true').ok, false);
  assert.equal(checkConfigValue({ type: 'boolean' }, true).ok, true);
  assert.equal(checkConfigValue({ type: 'date' }, '2026-11-08').ok, true);
  assert.equal(checkConfigValue({ type: 'date' }, 'next week').ok, false);
});

test('validateDeclaration reports problems', () => {
  assert.ok(validateDeclaration('X:y', { type: 'boolean', label: 'L', help: 'H' }).join().includes('default or defaultText'));
  assert.ok(validateDeclaration('noColon', { type: 'boolean', label: 'L', help: 'H', default: true }).join().includes('namespace:key'));
  assert.deepEqual(validateDeclaration('X:y', { type: 'boolean', label: 'L', help: 'H', default: true }), []);
});

test('core declarations cover the keys the server reads', () => {
  assert.deepEqual(Object.keys(CORE_CONFIG_DECLARATIONS).sort(), ['commands:permissions']);
  for (const [key, decl] of Object.entries(CORE_CONFIG_DECLARATIONS)) assert.deepEqual(validateDeclaration(key, decl), [], key);
});

test('world settings declare every scalar top-level key parseWorldDefinition reads', () => {
  for (const key of ['name', 'description', 'experienceMultiplier', 'spawn', 'membersWorld', 'gameframe']) {
    assert.ok(WORLD_SETTING_DECLARATIONS[key], key);
  }
  assert.equal(WORLD_SETTING_DECLARATIONS.spawn.type, 'json');
  for (const [key, decl] of Object.entries(WORLD_SETTING_DECLARATIONS)) {
    // top-level keys have no namespace, so give them one to check the shape
    assert.deepEqual(validateDeclaration('x:' + key, decl), [], key);
  }
});

test('experienceMultiplier excludes zero, as parseWorldDefinition does', () => {
  const decl = WORLD_SETTING_DECLARATIONS.experienceMultiplier;
  assert.equal(checkConfigValue(decl, 0).ok, false);
  assert.equal(checkConfigValue(decl, 0.5).ok, true);
  assert.ok(validateDeclaration('X:y', { type: 'boolean', label: 'L', help: 'H', default: true, exclusiveMin: true }).join().includes('exclusiveMin'));
});

const base = (extra) => ({ label: 'L', help: 'H', ...extra });
const problemsOf = (decl) => validateDeclaration('X:y', decl).join('; ');

test('a default must have the declared type exactly', () => {
  assert.match(problemsOf(base({ type: 'number', default: '5' })), /default is invalid/);
  assert.match(problemsOf(base({ type: 'boolean', default: 'true' })), /default is invalid/);
  assert.match(problemsOf(base({ type: 'string', default: 5 })), /default is invalid/);
  assert.match(problemsOf(base({ type: 'date', default: 20261108 })), /default is invalid/);
  assert.match(problemsOf(base({ type: 'date', default: 'next week' })), /default is invalid/);
  assert.equal(problemsOf(base({ type: 'date', default: '2026-11-08' })), '');
  assert.match(problemsOf(base({ type: 'json', default: () => 1 })), /default is invalid/);
  assert.match(problemsOf(base({ type: 'json', default: { when: new Date(0) } })), /default is invalid/);
  assert.equal(problemsOf(base({ type: 'json', default: { a: [1, 'b', null, true] } })), '');
});

test('an enum default must equal one of its values without coercion', () => {
  const values = [{ value: 5, label: 'Five' }, { value: 'a', label: 'A' }];
  assert.match(problemsOf(base({ type: 'enum', values, default: '5' })), /default is invalid/);
  assert.match(problemsOf(base({ type: 'enum', values, default: 'b' })), /default is invalid/);
  assert.equal(problemsOf(base({ type: 'enum', values, default: 5 })), '');
});

test('integer, exclusiveMin and members must be booleans', () => {
  assert.match(problemsOf(base({ type: 'number', default: 1, integer: 'yes' })), /integer must be true or false/);
  assert.match(problemsOf(base({ type: 'number', default: 1, min: 0, exclusiveMin: 1 })), /exclusiveMin must be true or false/);
  assert.match(problemsOf(base({ type: 'boolean', default: true, members: 'true' })), /members must be true or false/);
  assert.equal(problemsOf(base({ type: 'boolean', default: true, members: true })), '');
});

test('exclusiveMin needs min, and min may not exceed max', () => {
  assert.match(problemsOf(base({ type: 'number', default: 1, exclusiveMin: true })), /exclusiveMin needs min/);
  assert.match(problemsOf(base({ type: 'number', default: 1, min: 5, max: 1 })), /min must not be greater than max/);
  assert.equal(problemsOf(base({ type: 'number', default: 1, min: 1, max: 1 })), '');
});

test('enum values must be unique', () => {
  const values = [{ value: 'a', label: 'A' }, { value: 'a', label: 'A again' }];
  assert.match(problemsOf(base({ type: 'enum', values, default: 'a' })), /enum values must be unique/);
});

test('unknown declaration fields are rejected', () => {
  assert.match(problemsOf(base({ type: 'number', default: 1, minimum: 0 })), /unknown field minimum/);
});
