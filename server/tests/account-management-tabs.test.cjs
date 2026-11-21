// Run after `yarn build`: node --test tests/account-management-tabs.test.cjs
// The Account Management tab's Account / Community / Useful Links buttons (109:2, 109:10, 109:18)
// set varbit 10060 account_current_tab on the click, and login sends the saved tab back
// (rsprox captures local 1001337, 1001364, 1001842, 1001944). Real Player and plugin registration.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { Player } = require("../dist/game/entity/impl/player/Player");
const AccountManagement = require("../plugins/interface/AccountManagement.plugin");

const { TAB_BUTTONS, ACCOUNT_CURRENT_TAB_VARBIT, TAB_ATTRIBUTE } = AccountManagement._test;
const hooks = { buttons: null, buttonHandler: null, login: null, persisted: {} };

before(() => {
  AccountManagement.register({
    persistAttribute(key, fallback) { hooks.persisted[key] = fallback; },
    onPlayerLogin(handler) { hooks.login = handler; },
    onInterfaceActionButton(buttons, handler) { hooks.buttons = buttons; hooks.buttonHandler = handler; },
  });
});

function makePlayer() {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  player.setUsername("accounttabs");
  const varbits = [];
  const sender = player.getPacketSender();
  sender.sendVarbit = (id, value) => { varbits.push([id, value]); };
  return { player, varbits };
}

test("the three tab buttons are the cache's 109:2, 109:10 and 109:18, and the tab is saved", () => {
  assert.deepEqual(hooks.buttons, [(109 << 16) | 2, (109 << 16) | 10, (109 << 16) | 18]);
  assert.equal(hooks.persisted[TAB_ATTRIBUTE], 0);
});

test("each tab button sets account_current_tab to its tab", () => {
  const { player, varbits } = makePlayer();
  const order = [[1, 1], [2, 2], [0, 0]]; // Community, Useful Links, back to Account
  for (const [index, tab] of order) {
    assert.equal(hooks.buttonHandler({ player, buttonId: TAB_BUTTONS[index] }), true);
    assert.deepEqual(varbits.at(-1), [ACCOUNT_CURRENT_TAB_VARBIT, tab]);
    assert.equal(player.getAttribute(TAB_ATTRIBUTE), tab);
  }
});

test("another button on the interface is left to its own handler", () => {
  const { player, varbits } = makePlayer();
  assert.equal(hooks.buttonHandler({ player, buttonId: (109 << 16) | 37 }), false);
  assert.deepEqual(varbits, []);
});

test("login sends the tab the player last chose", () => {
  const { player, varbits } = makePlayer();
  player.setAttribute(TAB_ATTRIBUTE, 2);
  hooks.login({ player });
  assert.deepEqual(varbits, [[ACCOUNT_CURRENT_TAB_VARBIT, 2]]);
});

test("login on the default Account tab, or with a bad saved value, sends nothing", () => {
  for (const saved of [undefined, 0, 7, "x"]) {
    const { player, varbits } = makePlayer();
    if (saved !== undefined) player.setAttribute(TAB_ATTRIBUTE, saved);
    hooks.login({ player });
    assert.deepEqual(varbits, [], `saved ${saved}`);
  }
});
