// Run after `yarn build`: node --test tests/accounts.test.cjs
const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-accounts-')), 'accounts.json');
process.env.TSPS_ACCOUNTS_FILE = file;
const { Accounts } = require('../dist/game/entity/impl/player/Accounts');
beforeEach(() => { fs.rmSync(file, { force: true }); Accounts.reset(); });

test('ensure creates an account whose first character is the login name', () => {
  const entry = Accounts.ensure('Zezima', 1000);
  assert.deepEqual(entry, { createdAt: 1000, characters: [{ name: 'Zezima', createdAt: 1000, lastPlayedAt: 0 }] });
  assert.equal(Accounts.accountOf('zezima'), 'zezima');
  assert.equal(Accounts.accountOf('ZEZIMA '), 'zezima', 'key normalisation');
  assert.equal(Accounts.primaryOf('zezima'), 'Zezima');
  assert.equal(Accounts.ensure('Zezima', 2000).createdAt, 1000, 'idempotent');
});

test('characters are added, found by name, touched and removed, never the primary', () => {
  Accounts.ensure('Zezima', 1000);
  const added = Accounts.addCharacter('zezima', 'Zez Alt', 1500);
  assert.deepEqual(added, { name: 'Zez Alt', createdAt: 1500, lastPlayedAt: 0 });
  assert.equal(Accounts.accountOf('zez_alt'), 'zezima');
  assert.throws(() => Accounts.addCharacter('zezima', 'ZEZ ALT'), /owned/);
  Accounts.touchLastPlayed('zezima', 'Zez Alt', 1600);
  assert.equal(Accounts.charactersOf('zezima')[1].lastPlayedAt, 1600);
  assert.equal(Accounts.removeCharacter('zezima', 'Zezima'), false, 'primary stays');
  assert.equal(Accounts.removeCharacter('zezima', 'Zez Alt'), true);
  assert.equal(Accounts.accountOf('zez alt'), undefined);
});

test('the file round-trips through a restart', () => {
  Accounts.ensure('Zezima', 1000); Accounts.addCharacter('zezima', 'Second', 1100);
  Accounts.reset();
  assert.deepEqual(Accounts.charactersOf('zezima').map((c) => c.name), ['Zezima', 'Second']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).accounts.zezima.characters.length, 2);
});
