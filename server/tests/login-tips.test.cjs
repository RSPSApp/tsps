// Run: node --test tests/login-tips.test.cjs
// "Did you know?" tips at login (row 433), as live sends them straight after the greeting.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const LoginTips = require('../plugins/interface/LoginTips.plugin');

function player(saved, varbit = 0) {
  const self = {
    messages: [],
    getAttribute: (key) => (key === 'settings:values' ? saved : undefined),
    isPlayerBot: () => false,
    getPacketSender: () => ({
      getVarbit: (id) => (id === 16235 ? varbit : 0),
      sendTypedMessage: (type, text) => self.messages.push([type, text]),
    }),
  };
  return self;
}

test('the tips are live\'s "Did you know?" lines', () => {
  assert.equal(LoginTips.TIPS.length, 40);
  for (const tip of LoginTips.TIPS) assert.match(tip, /^Did you know\? /);
});

test('a tip goes out as chat type 117, picked at random', () => {
  const p = player({});
  LoginTips.sendTip({ player: p }, () => 0);
  LoginTips.sendTip({ player: p }, () => 0.999);
  assert.deepEqual(p.messages, [[117, LoginTips.TIPS[0]], [117, LoginTips.TIPS.at(-1)]]);
});

test('no tip with the setting off, saved or already sent', () => {
  const saved = player({ 'varbit:16235': 1 });
  LoginTips.sendTip({ player: saved });
  assert.deepEqual(saved.messages, []);
  const sent = player(undefined, 1);
  LoginTips.sendTip({ player: sent });
  assert.deepEqual(sent.messages, []);
  const turnedBackOn = player({ 'varbit:16235': 0 }, 1);
  LoginTips.sendTip({ player: turnedBackOn }, () => 0);
  assert.equal(turnedBackOn.messages.length, 1, 'the saved choice wins over a stale varbit');
});

test('bots get no tip', () => {
  const bot = player({});
  bot.isPlayerBot = () => true;
  LoginTips.sendTip({ player: bot });
  assert.deepEqual(bot.messages, []);
});
