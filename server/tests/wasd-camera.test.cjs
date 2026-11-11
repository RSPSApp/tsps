const assert = require('node:assert/strict');
const { test } = require('node:test');

// The web client offers Settings > Controls > WASD Camera only on worlds whose WasdCamera plugin
// tells it so at login; switched off on the world config page, the plugin isn't loaded and says nothing.
test('WasdCamera offers the web client WASD camera at login', () => {
  const handlers = {};
  const core = { encodePluginMessage: (channel, data) => ({ channel, data }) };
  const plugin = require('../plugins/interface/WasdCamera.plugin');
  assert.equal(plugin.name, 'WasdCamera');
  assert.notEqual(plugin.enabled, false, 'on for a new world');
  assert.match(plugin.description, /Settings > Controls/);
  plugin.register({ core, onPlayerLogin: (handler) => { handlers.login = handler; } });
  const packets = [];
  const player = { getSession: () => ({ sendClientPacket: (packet) => packets.push(packet) }) };
  handlers.login({ player });
  assert.deepEqual(packets, [{ channel: 'wasd-camera', data: { available: true } }]);
});
