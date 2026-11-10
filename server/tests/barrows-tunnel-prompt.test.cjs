// Run after `yarn build`: node --test tests/barrows-tunnel-prompt.test.cjs
//
// The hidden tunnel's sarcophagus, as recorded (rsprox_transcripts/226/01694.txt:169415-169442, a normal world): a
// message box "You've found a hidden tunnel, do you want to enter?" (and its mesbox chat line), then on continue the
// menu "Select an option": "Yeah I'm fearless!" / "No way, that looks scary!". Real plugins, a real Player, native
// dialogue_continue packets.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");

const AHRIM = 0;
const AHRIM_MOUND = [3565, 3289, 0];
const TEXT = "You've found a hidden tunnel, do you want to enter?";
let core, Barrows, next = 9900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3551, 9694);
  PM.emitServerStartup({});
  Barrows = require("../plugins/minigames/Barrows.plugin");
});
after(() => PM.emitServerShutdown({}));

function inAhrimsCrypt(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("tunnel" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...AHRIM_MOUND)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const typed = [];
  const sender = p.getPacketSender(), sendTyped = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, "sendTypedMessage", (type, text, ...rest) => { typed.push([type, text]); return sendTyped(type, text, ...rest); });
  Barrows._test.processPlayer({ player: p });
  Barrows._test.dig({ player: p });
  for (let i = 0; i < 6 && p.getLocation().getZ() === 0; i++) Barrows._test.processPlayer({ player: p });
  assert.equal(p.getLocation().getZ(), 3, "in the crypt");
  p.getAttribute("barrows").tunnel = AHRIM;
  typed.length = 0;
  const send = async (packet) => { await c.dispatch([packet]); c.processTurnPackets(); for (let i = 0; i < 2; i++) core.TaskManager.process(); };
  const group = () => p.getPacketSender().getChatboxGroupId();
  const continueBox = () => send({ type: "dialogue_continue", widgetId: (group() << 16) | 2, childIndex: -1 });
  const answer = (option) => send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: option });
  return { p, typed, continueBox, answer };
}

test("the box, then 'Yeah I'm fearless!' enters the tunnels", async (t) => {
  const f = inAhrimsCrypt(t);
  Barrows._test.searchCrypt(f.p, AHRIM);
  assert.deepEqual(f.typed, [[core.ChatType.MESBOX, TEXT]], "the mesbox chat line");
  assert.equal(f.p.getDialogueManager().getCurrent()?.getText?.(), TEXT, "the message box");
  assert.equal(MultiChatboxPrompt.getPending(f.p), null, "no menu before continue");
  await f.continueBox();
  const prompt = MultiChatboxPrompt.getPending(f.p);
  assert.equal(prompt?.title, "Select an option");
  assert.deepEqual(prompt.options, ["Yeah I'm fearless!", "No way, that looks scary!"]);
  await f.answer(1);
  assert.equal(f.p.getLocation().getZ(), 0, "down in the tunnels");
  assert.ok(f.p.getLocation().getY() > 9600);
});

test("'No way, that looks scary!' stays in the crypt", async (t) => {
  const f = inAhrimsCrypt(t);
  Barrows._test.searchCrypt(f.p, AHRIM);
  await f.continueBox();
  await f.answer(2);
  assert.equal(f.p.getLocation().getZ(), 3);
});
