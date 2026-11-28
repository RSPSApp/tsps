const test = require("node:test");
const assert = require("node:assert/strict");
const StaffCrowns = require("../plugins/interface/StaffCrowns.plugin.js");

test("StaffCrowns pushes account:chat-icons on account:refresh-chat-icons (not on login)", () => {
  const events = new Map();
  let onLogin = null;
  const sent = [];

  const PlayerRights = {
    NONE: { getId: () => 0 },
    MODERATOR: { getId: () => 1 },
    ADMINISTRATOR: { getId: () => 2 },
    OWNER: { getId: () => 3 },
    DEVELOPER: { getId: () => 4 },
  };

  const api = {
    core: {
      PlayerRights,
      encodePluginMessage: (channel, data) => ({ channel, data }),
    },
    onPlayerLogin(fn) {
      onLogin = fn;
    },
    onCustomEvent(name, fn) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(fn);
    },
    emitCustomEvent(name, payload) {
      for (const fn of events.get(name) || []) fn(payload);
    },
  };

  StaffCrowns.register(api);

  let rights = PlayerRights.NONE;
  let chatIcons = [];
  const player = {
    getRights: () => rights,
    setRights: (next) => {
      rights = next;
    },
    getChatIcons: () => chatIcons,
    setChatIcons: (next) => {
      chatIcons = [...next];
    },
    getSession: () => ({
      sendClientPacket: (pkt) => sent.push(pkt),
    }),
  };

  // Login sets icons without pushing a redundant plugin_message (handshake already carries them).
  onLogin({ player });
  assert.deepEqual(chatIcons, []);
  assert.equal(sent.length, 0);

  // Mid-session promotion pushes account:chat-icons with [1] (JMod crown).
  player.setRights(PlayerRights.DEVELOPER);
  api.emitCustomEvent("account:refresh-chat-icons", { player });
  assert.deepEqual(chatIcons, [1]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { channel: "account:chat-icons", data: { chatIcons: [1] } });

  // Dropping rights mid-session pushes account:chat-icons with [] to clear the input crown.
  player.setRights(PlayerRights.NONE);
  api.emitCustomEvent("account:refresh-chat-icons", { player });
  assert.deepEqual(chatIcons, []);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], { channel: "account:chat-icons", data: { chatIcons: [] } });
});
