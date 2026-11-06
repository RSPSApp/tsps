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

test('a deleted name is tombstoned for good and survives a restart', () => {
  Accounts.ensure('Zezima', 1000); Accounts.addCharacter('zezima', 'Zez Alt', 1100);
  assert.equal(Accounts.isDeleted('Zez Alt'), false);
  assert.equal(Accounts.removeCharacter('zezima', 'Zez Alt', 1200), true);
  assert.equal(Accounts.accountOf('zez alt'), undefined);
  assert.equal(Accounts.isDeleted('ZEZ_ALT'), true, 'key normalisation');
  Accounts.ensure('Other', 1300);
  assert.throws(() => Accounts.addCharacter('other', 'Zez Alt'), /deleted/);
  assert.throws(() => Accounts.addCharacter('zezima', 'zez alt'), /deleted/, 'not even by its own account');
  assert.throws(() => Accounts.ensure('Zez Alt'), /deleted/, 'nor as a new login');
  Accounts.reset();
  assert.deepEqual(Accounts.deletedOf('zez alt'), { name: 'Zez Alt', account: 'zezima', deletedAt: 1200 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).deleted, { 'zez alt': { name: 'Zez Alt', account: 'zezima', deletedAt: 1200 } });
});

test('a file from before tombstones still loads, and an unreadable one names itself', () => {
  fs.writeFileSync(file, JSON.stringify({ accounts: { zezima: { createdAt: 1, characters: [{ name: 'Zezima', createdAt: 1, lastPlayedAt: 0 }, { name: 'Alt', createdAt: 2, lastPlayedAt: 0 }] } } }));
  assert.deepEqual(Accounts.charactersOf('zezima').map((c) => c.name), ['Zezima', 'Alt']);
  assert.equal(Accounts.isDeleted('Alt'), false);
  assert.equal(Accounts.removeCharacter('zezima', 'Alt', 5), true);
  Accounts.reset();
  assert.equal(Accounts.isDeleted('Alt'), true, 'the first delete adds the tombstones');

  fs.writeFileSync(file, '{"accounts": {');
  Accounts.reset();
  assert.throws(() => Accounts.accountOf('Zezima'), (error) => error.message.includes(file) && /backup/.test(error.message));
  assert.equal(fs.readFileSync(file, 'utf8'), '{"accounts": {', 'an unreadable file is never replaced');
});

test('a malformed deleted list is refused, never loaded as none, and never overwritten', () => {
  const account = { zezima: { createdAt: 1, characters: [{ name: 'Zezima', createdAt: 1, lastPlayedAt: 0 }] } };
  for (const deleted of [[], 5, null, 'abc']) {
    const text = JSON.stringify({ accounts: account, deleted });
    fs.writeFileSync(file, text);
    Accounts.reset();
    assert.throws(() => Accounts.accountOf('Zezima'), (error) => error.message.includes(file) && /backup/.test(error.message), JSON.stringify(deleted));
    assert.throws(() => Accounts.ensure('Newcomer'), (error) => error.message.includes(file), 'a save path refuses too');
    assert.equal(fs.readFileSync(file, 'utf8'), text, 'the file is never replaced');
  }
  fs.writeFileSync(file, JSON.stringify({ accounts: account }));
  Accounts.reset();
  assert.equal(Accounts.isDeleted('Anything'), false, 'a missing list still loads as none');
  assert.deepEqual(Accounts.charactersOf('zezima').map((c) => c.name), ['Zezima']);
});

test('a malformed entry inside a valid deleted object still reserves its name', () => {
  fs.writeFileSync(file, JSON.stringify({ accounts: {}, deleted: { 'str name': 'junk', 'num name': 5, 'null name': null } }));
  Accounts.reset();
  for (const name of ['Str Name', 'Num Name', 'Null Name']) assert.equal(Accounts.isDeleted(name), true, name);
});
