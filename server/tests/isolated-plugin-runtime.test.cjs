const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

for (const owned of [true, false]) {
  test(`fixture cleanup closes ${owned ? 'its own' : 'no unrelated'} SQLite handles`, async () => {
    const directory = path.resolve('fixture-runtime');
    const databasePath = path.join(directory, 'players.sqlite');
    let readerOpen = true, writerOpen = true, removed = false, flushed = false, cleanup;
    const persistence = {
      constructor: { DATABASE_PATH: owned ? databasePath : path.resolve('other.sqlite') },
      async flush() { flushed = true; },
      writer: { ref() {}, async terminate() { writerOpen = false; } },
      database: { close() { readerOpen = false; } },
    };
    const fakeFs = {
      mkdtempSync: () => directory,
      rmSync(target) {
        assert.equal(target, directory);
        // Windows refuses to remove a database while either SQLite connection is open.
        if (owned && (readerOpen || writerOpen)) throw Object.assign(new Error('File is locked'), { code: 'EPERM' });
        removed = true;
      },
    };
    const helper = path.join(__dirname, 'helpers/isolated-plugin-runtime.cjs');
    const fakeRequire = name => name === 'node:fs' ? fakeFs : require(name);
    fakeRequire.cache = { [path.resolve(__dirname, '../dist/game/GameConstants.js')]: { exports: { GameConstants: { PLAYER_PERSISTENCE: persistence } } } };
    const fixture = { exports: {} };
    vm.runInNewContext(fs.readFileSync(helper, 'utf8'), {
      module: fixture, require: fakeRequire, __dirname: path.dirname(helper),
      process: { env: {}, once(event, handler) { assert.equal(event, 'beforeExit'); cleanup = handler; } },
    });
    fixture.exports('test');
    await cleanup();
    assert.equal(removed, true);
    assert.equal(flushed, owned);
    assert.equal(readerOpen, !owned);
    assert.equal(writerOpen, !owned);
  });
}
