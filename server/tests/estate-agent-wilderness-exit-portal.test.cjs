// Run after `yarn build`: node --test tests/estate-agent-wilderness-exit-portal.test.cjs
// rsprox_transcripts/236/03950.txt: handing in the Wilderness theme's blueprints sets deadman_2026_poh_ornament_unlocked
// (:21806), the agent's exit-portal line (:21807) and the exit-portal blueprints in the handed-in slot (:21816), then
// "Your house has been redecorated."; Nigel's "Do you have any spare exit portal blueprints?" gives another on the
// player's "Thank you, Nigel." (:56132-56196).
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
let core, House, Estate, next = 9960;
const AGENT_AT = [3241, 3475, 0];
const EXIT_PORTAL_LINE = "If you'd like, you can build a new exit portal with these blueprints. Talk to Nigel if you need more.";
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

const unlockVarbit = () => core.CacheDefinitions.getVarbitId("deadman_2026_poh_ornament_unlocked");
const blueprints = () => core.ItemIdentifiers.ANNIHILATION_BLUEPRINTS;
const exitPortal = () => core.ItemIdentifiers.ANNIHILATION_EXIT_PORTAL_BLUEPRINTS;

function owner(t, { fill = 0 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("wildy" + next); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(AGENT_AT[0] + 1, AGENT_AT[1], 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  House.houseStateFor(p).owned = true;
  for (let i = 0; i < fill; i++) p.getInventory().add(new core.Item(core.ItemIdentifiers.LOGS, 1), true);
  p.getInventory().add(new core.Item(blueprints(), 1), true);
  const npc = core.NPC.create(core.NpcIdentifiers.ESTATE_AGENT, new core.Location(...AGENT_AT));
  const lines = [];
  const sender = p.getPacketSender();
  const sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, ...r) => { lines.push(String(text)); return sendString(text, ...r); });
  return { p, c, npc, lines };
}
async function send(f, packet) { await f.c.dispatch([packet]); f.c.processTurnPackets(); for (let i = 0; i < 3; i++) core.TaskManager.process(); }
const cont = (f) => send(f, { type: "dialogue_continue", widgetId: (f.p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
const said = (f, text) => f.lines.some((line) => line.replace(/<br>/g, " ") === text);

/** Redecorate, the Wilderness theme (the menu's thirteenth row while its blueprints are carried), then Yes. */
async function handIn(f) {
  const clickType = f.npc.getCurrentDefinition(f.p).getActions().indexOf("Redecorate") + 1;
  PM.emitNpcInteraction({ player: f.p, npc: f.npc, npcId: f.npc.getId(), clickType, action: "Redecorate", handled: false });
  const menu = core.CacheDefinitions.getComponentId("menu:lj_layer1");
  assert.equal(f.p.getInterfaceId(), menu >>> 16, "the style menu is open");
  await send(f, { type: "widget_action", widgetId: menu, groupId: menu >>> 16, childId: menu & 0xffff, slot: 12, buttonNum: 1, itemId: -1 });
  await cont(f);
  const prompt = core.MultiChatboxPrompt.getPending(f.p);
  assert.equal(prompt?.title, "Hand in your blueprints for the Wilderness theme?");
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: f.p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 1, action: 1 });
  for (let i = 0; i < 3; i++) core.TaskManager.process();
}

test("the Wilderness hand-in sets the unlock varbit, says the exit-portal line and gives the blueprints in the same slot", async (t) => {
  const f = owner(t, { fill: 3 });
  const slot = f.p.getInventory().getSlotForItemId(blueprints());
  assert.equal(slot, 3);
  assert.equal(f.p.getPacketSender().getVarbit(unlockVarbit()), 0);
  await handIn(f);
  assert.equal(f.p.getInventory().getAmount(blueprints()), 0, "handed in");
  assert.equal(f.p.getInventory().getItems()[slot].getId(), exitPortal(), "the exit-portal blueprints take its slot");
  assert.equal(f.p.getInventory().getAmount(exitPortal()), 1);
  assert.equal(f.p.getPacketSender().getVarbit(unlockVarbit()), 1, "deadman_2026_poh_ornament_unlocked 0 -> 1");
  assert.equal(Estate.houseStyleIndex(House.houseStateFor(f.p)), 12, "Wilderness theme");
  assert.ok(said(f, EXIT_PORTAL_LINE), `the agent's line: ${f.lines.slice(-3).join(" | ")}`);
  assert.ok(!said(f, "Your house has been redecorated."), "the redecoration line comes after");
  await cont(f);
  assert.ok(said(f, "Your house has been redecorated."), `then: ${f.lines.slice(-3).join(" | ")}`);
  // Relogging resends the varbit from the saved unlock.
  f.p.getPacketSender().sendVarbit(unlockVarbit(), 0);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername(), isNewAccount: false });
  assert.equal(f.p.getPacketSender().getVarbit(unlockVarbit()), 1, "resent on login");
});

test("Nigel's spare-blueprints option needs the unlock; the blueprints come with the player's thanks", async (t) => {
  const f = owner(t);
  const condition = "If the Wilderness house theme has been unlocked:";
  assert.equal(PM.emitNpcDialogueCondition({ player: f.p, text: condition }), false, "hidden before the hand-in");
  await handIn(f);
  assert.equal(PM.emitNpcDialogueCondition({ player: f.p, text: condition }), true, "shown after");
  const nigel = core.CacheDefinitions.getNpcId("deadman_nigel");
  const line = (text, npcId = nigel) => {
    const request = { player: f.p, npcId, text, pages: [{ page: "Nigel" }], skip: false };
    PM.emitCustomEvent("npc-dialogue:line", request);
    return request;
  };
  const had = f.p.getInventory().getAmount(exitPortal());
  const thanks = line("Thank you, Nigel.");
  assert.equal(typeof thanks.before, "function", "the item waits for the line to show");
  assert.equal(f.p.getInventory().getAmount(exitPortal()), had, "nothing while the chain is built");
  thanks.before();
  assert.equal(f.p.getInventory().getAmount(exitPortal()), had + 1, "another set");
  for (const other of [line("Of course, here you go."), line("Thank you, Nigel.", core.NpcIdentifiers.ESTATE_AGENT)]) other.before?.();
  assert.equal(f.p.getInventory().getAmount(exitPortal()), had + 1, "only Nigel's thanks gives one");
});

test("with a full pack the exit-portal blueprints take the handed-in slot", async (t) => {
  const f = owner(t, { fill: 27 });
  assert.equal(f.p.getInventory().getFreeSlots(), 0);
  await handIn(f);
  assert.equal(f.p.getInventory().getAmount(exitPortal()), 1);
  assert.equal(f.p.getInventory().getItems()[27].getId(), exitPortal());
});
