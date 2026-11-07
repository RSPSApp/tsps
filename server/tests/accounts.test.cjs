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

const onDisk = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const diskPlayed = (name) => onDisk().accounts.zezima.characters.find((c) => c.name === name).lastPlayedAt;

test('touchLastPlayed updates memory at once but defers the file write; flush writes it', () => {
  Accounts.ensure('Zezima', 1000); Accounts.addCharacter('zezima', 'Alt', 1100);
  const before = fs.readFileSync(file, 'utf8');
  Accounts.touchLastPlayed('zezima', 'Alt', 5000);
  assert.equal(Accounts.charactersOf('zezima')[1].lastPlayedAt, 5000, 'in memory now');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the file is not rewritten on every world entry');
  Accounts.flush();
  assert.equal(diskPlayed('Alt'), 5000);
  const flushed = fs.readFileSync(file, 'utf8');
  Accounts.flush();
  assert.equal(fs.readFileSync(file, 'utf8'), flushed, 'nothing pending: nothing written');
});

test('pending last-played times are written by the coalescing timer, once per window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Accounts.ensure('Zezima', 1000); Accounts.addCharacter('zezima', 'Alt', 1100);
  Accounts.touchLastPlayed('zezima', 'Zezima', 4000);
  Accounts.touchLastPlayed('zezima', 'Alt', 5000);
  t.mock.timers.tick(Accounts.LAST_PLAYED_WRITE_DELAY_MS - 1);
  assert.equal(diskPlayed('Alt'), 0, 'not before the window ends');
  t.mock.timers.tick(1);
  assert.equal(diskPlayed('Zezima'), 4000);
  assert.equal(diskPlayed('Alt'), 5000, 'both entries in one write');
});

test('a structural write carries the pending last-played time', () => {
  Accounts.ensure('Zezima', 1000);
  Accounts.touchLastPlayed('zezima', 'Zezima', 4000);
  Accounts.addCharacter('zezima', 'Alt', 4100);
  assert.equal(diskPlayed('Zezima'), 4000);
  Accounts.ensure('Other', 4200);
  Accounts.reset();
  assert.equal(Accounts.charactersOf('zezima')[0].lastPlayedAt, 4000, 'survives a restart');
});

test('the account that deleted a name may create it again, which removes its tombstone', () => {
  Accounts.ensure('Zezima', 1000); Accounts.ensure('Other', 1000);
  Accounts.addCharacter('zezima', 'Zez Alt', 1100);
  Accounts.removeCharacter('zezima', 'Zez Alt', 1200);
  assert.throws(() => Accounts.addCharacter('other', 'Zez Alt'), /deleted/, 'another account still cannot');
  const again = Accounts.addCharacter('zezima', 'ZEZ ALT', 1300);
  assert.equal(again.name, 'ZEZ ALT');
  assert.equal(Accounts.isDeleted('zez alt'), false);
  assert.equal(Accounts.accountOf('zez alt'), 'zezima');
  Accounts.reset();
  assert.equal(Accounts.isDeleted('zez alt'), false, 'in the same write');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).deleted, {});
});

test('a tombstone from before it recorded its account is claimable by nobody', () => {
  fs.writeFileSync(file, JSON.stringify({ accounts: { zezima: { createdAt: 1, characters: [{ name: 'Zezima', createdAt: 1, lastPlayedAt: 0 }] } }, deleted: { old: { name: 'Old', deletedAt: 5 } } }));
  assert.throws(() => Accounts.addCharacter('zezima', 'Old'), /deleted/);
  assert.equal(Accounts.deletedOf('old').account, '');
});

test('an account holds at most MAX_TOMBSTONES_PER_ACCOUNT tombstones', () => {
  assert.equal(Accounts.MAX_TOMBSTONES_PER_ACCOUNT, 6);
  Accounts.ensure('Zezima', 1000);
  for (let i = 0; i < Accounts.MAX_TOMBSTONES_PER_ACCOUNT; i++) {
    assert.equal(Accounts.canDelete('zezima'), true);
    Accounts.addCharacter('zezima', 'Burner ' + i, 1100 + i);
    Accounts.removeCharacter('zezima', 'Burner ' + i, 1200 + i);
  }
  assert.equal(Accounts.deletedCountOf('zezima'), 6);
  assert.equal(Accounts.canDelete('zezima'), false);
  Accounts.addCharacter('zezima', 'Seventh', 1300);
  assert.throws(() => Accounts.removeCharacter('zezima', 'Seventh', 1400), /too many/);
  assert.deepEqual(Accounts.charactersOf('zezima').map((c) => c.name), ['Zezima', 'Seventh'], 'nothing removed');
  assert.equal(Accounts.isDeleted('Seventh'), false);
  // Re-creating one of its own frees a tombstone.
  Accounts.addCharacter('zezima', 'Burner 0', 1500);
  assert.equal(Accounts.canDelete('zezima'), true);
});

test('releaseDeleted frees a tombstoned name for anyone', () => {
  Accounts.ensure('Zezima', 1000); Accounts.addCharacter('zezima', 'Zez Alt', 1100);
  Accounts.removeCharacter('zezima', 'Zez Alt', 1200);
  assert.equal(Accounts.releaseDeleted('Nobody'), undefined);
  assert.deepEqual(Accounts.releaseDeleted('zez_alt'), { name: 'Zez Alt', account: 'zezima', deletedAt: 1200 });
  assert.equal(Accounts.isDeleted('zez alt'), false);
  Accounts.reset();
  assert.equal(Accounts.isDeleted('zez alt'), false, 'written');
  Accounts.ensure('Other', 1300);
  assert.equal(Accounts.addCharacter('other', 'Zez Alt', 1400).name, 'Zez Alt');
});
