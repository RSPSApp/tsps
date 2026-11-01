// Run after `yarn build`: node --test tests/character-summary-time-played.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const hooks = {};
const handlers = [];
class Chain { add(dialogue) { this.dialogue = dialogue; return this; } }
class Options {
  constructor(_index, listener, ...labels) { Object.assign(this, { listener, labels }); }
  setTitle(title) { this.title = title; return this; }
}
const journal = require("../plugins/interface/SideJournalDefaults.plugin");
journal.register({
  core: { DialogueChainBuilder: Chain, OptionDialogue: Options },
  log: () => {},
  persistAttribute: (key) => { (hooks.persisted ??= []).push(key); },
  onCustomEvent: (name, handler) => { hooks[name] = handler; },
  onPlayerLogin: (handler) => { hooks.login = handler; },
  onPlayerLogout: (handler) => { hooks.logout = handler; },
  onInterfaceActionButton: (id, handler) => handlers.push({ id, handler }),
  emitCustomEvent: () => {},
});

const SUMMARY = 712;
const ENTRY_LIST = (SUMMARY << 16) | 3;
const TIME_PLAYED_ROW = 7;

function createPlayer(saved = {}) {
  const attributes = new Map(Object.entries(saved));
  const sent = { varbits: {}, times: [], order: [] };
  let dialogue = null;
  const sender = new Proxy({}, {
    get: (_target, name) => (...args) => {
      if (name === "sendVarbit") sent.varbits[args[0]] = args[1];
      if (name === "sendInterfaceScript" && args[0] === 3970) { sent.times.push(args[1][2]); sent.order.push("time"); }
      if (name === "sendSubInterface") sent.order.push("open");
      return sender;
    },
  });
  return {
    sent,
    dialogue: () => dialogue,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues: (chain) => { dialogue = chain.dialogue; } }),
  };
}

function click(player) {
  const row = handlers.find(({ id }) => id === ENTRY_LIST);
  assert.equal(row.handler({ player, slot: TIME_PLAYED_ROW }), true);
}

const PLAY_TIME = "account-summary:play-time";
const DISPLAYED = "account-summary:play-time-displayed";

test("time played is the saved total plus this session, in minutes, kept over a logout", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const player = createPlayer({ [PLAY_TIME]: 60 * 60000 });
  hooks.login({ player });
  assert.equal(player.sent.times.at(-1), 60);

  t.mock.timers.tick(5 * 60000);
  hooks.logout({ player });
  assert.equal(player.getAttribute(PLAY_TIME), 65 * 60000);
  assert.ok(hooks.persisted.includes(PLAY_TIME));
});

test("opening the summary sends the time first, as captured", () => {
  const player = createPlayer();
  hooks.login({ player });
  player.sent.order.length = 0;
  const event = { player, groupId: SUMMARY, tabIndex: 0 };
  hooks["side-journal:mount"](event);
  assert.deepEqual(player.sent.order.slice(0, 2), ["time", "open"]);
});

test("showing the row asks first with the captured options; hiding doesn't", () => {
  const player = createPlayer();
  hooks.login({ player });
  click(player);
  const prompt = player.dialogue();
  assert.equal(prompt.title, "Are you sure you want to display your time played?");
  assert.deepEqual(prompt.labels, ["Yes", "Yes and don't ask me again", "No"]);
  assert.equal(player.sent.varbits[12933], 0, "nothing shows until it's answered");

  prompt.listener.executeOption(3);
  assert.equal(player.sent.varbits[12933], 0);

  prompt.listener.executeOption(1);
  assert.equal(player.sent.varbits[12933], 1);
  assert.equal(player.getAttribute(DISPLAYED), true);

  click(player);
  assert.equal(player.sent.varbits[12933], 0);
});

test("\"don't ask me again\" stays, and the choice is resent at login", () => {
  const player = createPlayer();
  hooks.login({ player });
  click(player);
  player.dialogue().listener.executeOption(2);
  assert.equal(player.sent.varbits[12962], 1);
  click(player);
  const asked = player.dialogue();
  click(player);
  assert.equal(player.dialogue(), asked, "no second prompt");
  assert.equal(player.sent.varbits[12933], 1);

  const relogged = createPlayer({ [DISPLAYED]: true, "account-summary:play-time-remind-disabled": true });
  hooks.login({ player: relogged });
  assert.equal(relogged.sent.varbits[12933], 1);
  assert.equal(relogged.sent.varbits[12962], 1);
});
