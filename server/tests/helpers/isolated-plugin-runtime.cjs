const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

/** For fixtures that start every plugin. Never open live persistence or bind a shared TCP port. */
module.exports = function isolatedPluginRuntime(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `tsps-${name}-`));
  const databasePath = path.join(directory, 'players.sqlite');
  process.env.PLAYER_SAVE_DATABASE_PATH = databasePath;
  process.env.LEGACY_PLAYER_SAVE_DIRECTORY = path.join(directory, 'legacy');
  process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = '0';
  process.env.TSPS_WORLD_ADMIN_SOCKET = path.join(directory, 'admin.sock');
  process.env.WORLD_ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
  process.once('beforeExit', async () => {
    // Close only this fixture's SQLite handles before Windows removes its files.
    const constants = require.cache[path.resolve(__dirname, '../../dist/game/GameConstants.js')]?.exports.GameConstants;
    const persistence = constants?.PLAYER_PERSISTENCE;
    try {
      if (persistence?.constructor.DATABASE_PATH === databasePath) {
        try {
          await persistence.flush();
        } finally {
          const writer = persistence.writer;
          persistence.writer = null; // Its exit handler must not restart a terminated worker.
          writer?.ref();
          await writer?.terminate();
          persistence.database.close();
        }
      }
    } finally {
      fs.rmSync(directory, {recursive:true, force:true, maxRetries:3, retryDelay:50});
    }
  });
  return directory;
};
