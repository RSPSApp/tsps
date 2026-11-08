// Run after `yarn build`: node --test tests/estate-agent-blueprint-confirm.test.cjs
// rsprox_transcripts/229/02546.txt (Twisted) and 236/03950.txt (Wilderness): picking a blueprint style plays the
// agent's line, then a "Hand in your blueprints for the Twisted theme?" Yes/No; only Yes takes the blueprints and
// changes the style. The agent took them straight after the menu pick.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
let core, House, Estate, next = 9860;
const AGENT_AT = [3241, 3475, 0];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(AGENT_AT[0], AGENT_AT[1]);
  PM.emitServerStartup({});
  House = require("../plugins/skills/construction/House.Construction");
  Estate = require("../plugins/skills/construction/Estate.Construction");
});
after(() => PM.emitServerShutdown({}));

function owner(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("estate" + next); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(AGENT_AT[0] + 1, AGENT_AT[1], 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  House.houseStateFor(p).owned = true;
  p.getInventory().add(new core.Item(core.ItemIdentifiers.TWISTED_BLUEPRINTS, 1), true);
  const npc = core.NPC.create(core.NpcIdentifiers.ESTATE_AGENT, new core.Location(...AGENT_AT));
  const lines = [];
  const sender = p.getPacketSender();
  const sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, ...r) => { lines.push(String(text)); return sendString(text, ...r); });
  return { p, c, npc, lines };
}
async function send(f, packet) { await f.c.dispatch([packet]); f.c.processTurnPackets(); for (let i = 0; i < 3; i++) core.TaskManager.process(); }
async function pickTwisted(f) {
  const clickType = f.npc.getCurrentDefinition(f.p).getActions().indexOf("Redecorate") + 1;
  assert.ok(clickType > 0);
  PM.emitNpcInteraction({ player: f.p, npc: f.npc, npcId: f.npc.getId(), clickType, action: "Redecorate", handled: false });
  // The "Choose a style:" menu (menu:lj_layer1): Twisted theme is the eighth row (rsprox 229/02546: sub=7).
  const menu = core.CacheDefinitions.getComponentId("menu:lj_layer1");
  assert.equal(f.p.getInterfaceId(), menu >>> 16, "the style menu is open");
  await send(f, { type: "widget_action", widgetId: menu, groupId: menu >>> 16, childId: menu & 0xffff, slot: 7, buttonNum: 1, itemId: -1 });
  await send(f, { type: "dialogue_continue", widgetId: (f.p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
  const prompt = core.MultiChatboxPrompt.getPending(f.p);
  assert.ok(prompt, `a question is open: ${f.lines.slice(-3).join(" | ")}`);
  return prompt;
}
const style = (p) => Estate.houseStyleIndex(House.houseStateFor(p));

for (const [answer, slot] of [["No", 2], ["Yes", 1]]) {
  test(`Twisted theme: the agent's line, then "Hand in your blueprints for the Twisted theme?" and ${answer}`, async (t) => {
    const f = owner(t);
    const before = style(f.p);
    const prompt = await pickTwisted(f);
    assert.equal(prompt.title, "Hand in your blueprints for the Twisted theme?");
    assert.deepEqual(prompt.options, ["Yes", "No"]);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.TWISTED_BLUEPRINTS), 1, "nothing taken before the answer");
    core.MultiChatboxPrompt.handleInterfaceActionClick({ player: f.p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot, action: slot });
    for (let i = 0; i < 3; i++) core.TaskManager.process();
    if (answer === "No") {
      assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.TWISTED_BLUEPRINTS), 1, "the blueprints stay");
      assert.equal(style(f.p), before, "the style is unchanged");
    } else {
      assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.TWISTED_BLUEPRINTS), 0, "the blueprints are handed in");
      assert.equal(style(f.p), 7, "Twisted theme");
    }
  });
}
