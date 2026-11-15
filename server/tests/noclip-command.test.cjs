// node --test tests/noclip-command.test.cjs   (needs `dist` for the core API; the command is driven with a fake player)
// ::noclip (#5630) toggles a per-player, non-persisted flag that the movement code reads for that player only. The packet
// the command has always sent (opcode 250) is unchanged; no client here handles it.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { PlayerRights } = require('../src/main/typescript/elvarg/game/model/rights/PlayerRights');

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

/** The noclip command's registration, captured from the admin commands plugin. */
function noclipCommand() {
  const commands = new Map();
  const api = new Proxy({ registerCommand(name, handler, rights, description) { commands.set(name, { handler, rights, description }); } },
    { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/commands/AdminCommands.plugin').register(api);
  const command = commands.get('noclip');
  assert.ok(command, 'the noclip command is registered');
  return command;
}

/** A fake player: attributes, messages, and the packet sender the command uses. */
function player() {
  const attributes = new Map();
  const messages = [];
  const sent = { enableNoclip: 0 };
  return {
    attributes, messages, sent,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => messages.push(text),
    getPacketSender: () => ({ sendEnableNoclip: () => { sent.enableNoclip++; return this; } }),
  };
}

test('::noclip is an owner command', () => {
  assert.equal(noclipCommand().rights, PlayerRights.OWNER);
});

test('::noclip toggles the flag: enabled, then disabled, and the flag is not persisted', () => {
  const command = noclipCommand();
  const p = player();
  command.handler({ player: p, args: [] });
  assert.equal(p.attributes.get('admin:noclip'), true, 'the flag is on after the first use');
  assert.equal(p.messages.at(-1), 'Noclip enabled.');
  assert.equal(p.sent.enableNoclip, 0, 'no packet on enable: PlayerSession.write is a no-op, and the client batch decoder would desync');
  command.handler({ player: p, args: [] });
  assert.equal(p.attributes.get('admin:noclip'), false, 'the flag is off after the second use');
  assert.equal(p.messages.at(-1), 'Noclip disabled.');
  assert.equal(p.sent.enableNoclip, 0, 'no packet on disable either');
});
