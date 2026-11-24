const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

/** For fixtures that start every plugin. Never open live persistence or bind a shared TCP port. */
module.exports = function isolatedPluginRuntime(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `tsps-${name}-`));
  process.env.PLAYER_SAVE_DATABASE_PATH = path.join(directory, 'players.sqlite');
  process.env.LEGACY_PLAYER_SAVE_DIRECTORY = path.join(directory, 'legacy');
  process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = '0';
  process.env.TSPS_WORLD_ADMIN_SOCKET = path.join(directory, 'admin.sock');
  process.env.WORLD_ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
  process.once('exit', () => fs.rmSync(directory, {recursive:true, force:true}));
  return directory;
};
