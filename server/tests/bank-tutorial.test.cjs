// Run after `yarn build`: node --test tests/bank-tutorial.test.cjs
// The bank's tutorial button (bankmain:bank_tut) runs the 16-step screen highlight walkthrough as
// rsprox.net recording 3937 (rev 236, ticks 1653-2665) shows it: swap mode shown, the bank opened
// again with its inventory side unclickable, the walkthrough in bankmain:bank_highlight with text
// colour -1 and the text script's fourth argument true, no hnt_selected_hint; Finish leaves
// hnt_hint_step on the last step and opens the bank again. Real engine: every plugin loaded, a real
// Player with the bank open, clicks through the same routes the network uses.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Bank } = require("../dist/game/model/container/impl/Bank");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const componentId = (name) => core.CacheDefinitions.getComponentId(name);
const varbitId = (name) => core.CacheDefinitions.getVarbitId(name);
const uid = (group, child) => (group << 16) | child;
const CONTINUE = uid(664, 31);
const PREVIOUS = uid(664, 32);
const PAUSE_BUTTON = uid(664, 9);

let next = 9860;
function banker(t, { insertMode = true } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("banktut" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.setInsertMode(insertMode);
  const sender = p.getPacketSender();
  const log = [];
  const sendVarbit = sender.sendVarbit.bind(sender);
  t.mock.method(sender, "sendVarbit", (id, value) => { log.push(["varbit", id, value]); return sendVarbit(id, value); });
  const sendScript = sender.sendInterfaceScript.bind(sender);
  t.mock.method(sender, "sendInterfaceScript", (id, args, ...rest) => { log.push(["script", id, args]); return sendScript(id, args, ...rest); });
  const sendSub = sender.sendSubInterface.bind(sender);
  t.mock.method(sender, "sendSubInterface", (target, group, ...rest) => { log.push(["open", target, group]); return sendSub(target, group, ...rest); });
  const closeSub = sender.closeSubInterface.bind(sender);
  t.mock.method(sender, "closeSubInterface", (target) => { log.push(["close", target]); return closeSub(target); });
  p.getBank(0).open();
  assert.equal(Bank.isOpen(p), true, "the bank is open");
  log.length = 0;
  return { p, log };
}

function clickTutorial(p) {
  const widgetId = componentId("bankmain:bank_tut");
  const packet = { widgetId, groupId: widgetId >>> 16, childId: widgetId & 0xffff, buttonNum: 1 };
  const event = { player: p, packet, handled: false };
  PM.emitCustomEvent("player:widget-action", event);
  return event.handled;
}

const button = (p, buttonId, slot = 9) => PM.emitInterfaceActionClick({ player: p, buttonId, slot, opId: 1, action: 1, handled: false });
const scripts = (log, id) => log.filter(([kind, script]) => kind === "script" && script === id).map(([, , args]) => args);
const varbits = (log, id) => log.filter(([kind, varbit]) => kind === "varbit" && varbit === id).map(([, , value]) => value);

test("the tutorial button reopens the bank, shows swap mode and starts the walkthrough as captured", (t) => {
  const { p, log } = banker(t);
  const host = componentId("bankmain:bank_highlight");
  const noclick = componentId("bankside:bankside_highlight");
  assert.equal(clickTutorial(p), true);
  assert.equal(Bank.isOpen(p), true, "the bank is open again");
  const closeAt = log.findIndex(([kind, target]) => kind === "close" && target === uid(161, 16));
  const reopenAt = log.findIndex(([kind, target, group], i) => i > closeAt && kind === "open" && target === uid(161, 16) && group === 12);
  assert.ok(closeAt >= 0 && reopenAt > closeAt, "the bank closes and opens again: " + JSON.stringify(log.slice(0, 8)));
  assert.deepEqual(scripts(log, 101), [[11]], "meslayer_close 11");
  assert.deepEqual(scripts(log, 3407), [[noclick]], "highlight_noclick_clear on the inventory side");
  assert.deepEqual(scripts(log, 3406), [[noclick]], "highlight_noclick on the inventory side");
  assert.equal(varbits(log, varbitId("bank_insertmode"))[0], 0, "swap mode, before the bank closes");
  assert.equal(p.insertModeReturn(), false, "the walkthrough runs in swap mode, as live");
  const mounted = log.findIndex(([kind, target, group]) => kind === "open" && target === host && group === 664);
  assert.ok(mounted > reopenAt, "the walkthrough mounts in bankmain:bank_highlight after the reopen");
  assert.deepEqual(varbits(log, varbitId("hnt_hint_max_step")), [16]);
  assert.deepEqual(varbits(log, varbitId("hnt_selected_hint")), [], "no hnt_selected_hint, as captured");
  assert.deepEqual(scripts(log, 3408), [[host]], "highlight_start");
  assert.deepEqual(scripts(log, 3409), [[host, 0, 0, 0, 0, 2, 2, 100, 1]], "the first box: the whole bank, dimmed");
  assert.deepEqual(scripts(log, 3413), [["This is your bank. No one else can touch it but you.", -1, 0, 1, host]]);
});

test("Continue steps through all 16 boxes and texts; Finish keeps the last step and reopens the bank", (t) => {
  const { p, log } = banker(t);
  const host = componentId("bankmain:bank_highlight");
  clickTutorial(p);
  log.length = 0;
  for (let step = 1; step < 16; step++) assert.equal(button(p, CONTINUE), true, `Continue to step ${step}`);
  assert.deepEqual(varbits(log, varbitId("hnt_hint_step")), Array.from({ length: 15 }, (_, i) => i + 1));
  const boxes = scripts(log, 3409).map((args) => args.slice(1, 5));
  assert.deepEqual(boxes[1], [44, 44, 40, 3], "step 2: the deposit all button");
  assert.deepEqual(boxes[10], [409, 46, 40, 32], "step 11: the bank tabs");
  assert.deepEqual(boxes[14], [55, 29, 3, 3], "step 15: bank space and settings");
  const last = scripts(log, 3413).at(-1);
  assert.match(last[0], /^Finally, you can see your available bank space/);
  assert.deepEqual(last.slice(1), [-1, 1, 1, host], "the last text is final");
  log.length = 0;
  assert.equal(button(p, PAUSE_BUTTON, -1), true, "Finish (the pause button's resume) ends it");
  assert.deepEqual(varbits(log, varbitId("hnt_hint_step")), [], "hnt_hint_step stays on the last step");
  assert.ok(log.some(([kind, target]) => kind === "close" && target === host), "the walkthrough closes");
  assert.deepEqual(scripts(log, 3412), [[host]], "highlight_screen_hide_layer");
  assert.ok(log.some(([kind, target, group]) => kind === "open" && target === uid(161, 16) && group === 12), "the bank opens again");
  assert.equal(p.insertModeReturn(), true, "the player's own insert mode is back");
  assert.equal(Bank.isOpen(p), true);
  assert.equal(button(p, CONTINUE), false, "nothing left to step");
});

test("Previous steps back, and the button again starts over from the first step", (t) => {
  const { p, log } = banker(t);
  clickTutorial(p);
  button(p, CONTINUE);
  button(p, CONTINUE);
  log.length = 0;
  assert.equal(button(p, PREVIOUS), true);
  assert.deepEqual(varbits(log, varbitId("hnt_hint_step")), [1]);
  log.length = 0;
  assert.equal(clickTutorial(p), true);
  assert.deepEqual(varbits(log, varbitId("hnt_hint_step")), [0], "back to the first step");
});

test("the button does nothing with the bank closed", (t) => {
  const { p, log } = banker(t);
  p.getPacketSender().sendInterfaceRemoval();
  assert.equal(Bank.isOpen(p), false);
  log.length = 0;
  assert.equal(clickTutorial(p), false);
  assert.deepEqual(log.filter(([kind, , group]) => kind === "open" && group === 664), []);
});

test("closing the bank or logging out mid-walkthrough puts the player's own mode back", (t) => {
  const { p } = banker(t);
  clickTutorial(p);
  assert.equal(p.insertModeReturn(), false);
  p.getPacketSender().sendInterfaceRemoval();
  assert.equal(Bank.isOpen(p), false);
  assert.equal(p.insertModeReturn(), true, "restored when the bank closes");
  const other = banker(t).p;
  clickTutorial(other);
  clickTutorial(other);
  assert.equal(other.insertModeReturn(), false, "a restart keeps the saved mode");
  PM.emitPlayerLogout({ player: other, username: other.getUsername() });
  assert.equal(other.insertModeReturn(), true, "restored at logout, before the save");
  const swapper = banker(t, { insertMode: false }).p;
  clickTutorial(swapper);
  swapper.getPacketSender().sendInterfaceRemoval();
  assert.equal(swapper.insertModeReturn(), false, "a swap-mode player stays in swap");
});

test("a server shutdown mid-walkthrough puts the player's own mode back before the save", (t) => {
  const { p } = banker(t);
  clickTutorial(p);
  assert.equal(p.insertModeReturn(), false);
  PM.emitServerShutdown({});
  assert.equal(p.insertModeReturn(), true);
});

test("Close before the last step ends the walkthrough like Finish, as recording 3923 shows", (t) => {
  const { p, log } = banker(t);
  const host = componentId("bankmain:bank_highlight");
  clickTutorial(p);
  button(p, CONTINUE);
  log.length = 0;
  assert.equal(button(p, PAUSE_BUTTON, -1), true, "Close (the pause button's resume) on step 2");
  assert.deepEqual(varbits(log, varbitId("hnt_hint_step")), [], "hnt_hint_step left as it was");
  assert.ok(log.some(([kind, target]) => kind === "close" && target === host), "the walkthrough closes");
  assert.deepEqual(scripts(log, 3412), [[host]], "highlight_screen_hide_layer");
  assert.ok(log.some(([kind, target, group]) => kind === "open" && target === uid(161, 16) && group === 12), "the bank opens again");
  assert.equal(p.insertModeReturn(), true, "the player's own insert mode is back");
  assert.equal(Bank.isOpen(p), true);
  assert.equal(button(p, CONTINUE), false, "nothing left to step");
  assert.equal(clickTutorial(p), true, "the button starts it again");
  assert.equal(p.insertModeReturn(), false);
});

test("a walkthrough without closable (the league ones) still ignores the resume before the last step", (t) => {
  const { p, log } = banker(t);
  const step = { focus: { script: 3409, args: [0, 0, 0, 0, 2, 2, 100, true] }, text: { script: 3413, text: "x", final: false } };
  PM.emitCustomEvent("screen-highlight:show", { player: p, key: "plain", host: componentId("bankmain:bank_highlight"), colour: 0, steps: [step, step] });
  t.after(() => PM.emitCustomEvent("screen-highlight:close", { player: p }));
  log.length = 0;
  assert.equal(button(p, PAUSE_BUTTON, -1), false, "ignored on the first step");
  assert.deepEqual(log.filter(([kind]) => kind === "close"), []);
  assert.equal(button(p, CONTINUE), true, "still on the walkthrough");
  assert.equal(button(p, PAUSE_BUTTON, -1), true, "Finish on the last step");
});
