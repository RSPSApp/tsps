// Run after `yarn build`: node --test tests/monkey-speak-dialogue.test.cjs
// Monkeys whose transcript has a "without" and a "with" M'speak amulet section always played the
// first (untranslated) one. Live (rsprox recording 3030) a Mos Le'Harmless monkey answers in
// words; the Wiki's sections give the condition: the amulet worn, or Monkey Madness II complete.
// Real engine: every plugin loaded, a real Player, the monkeys' real transcripts.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { getRegisteredQuests } = require("../plugins/quests/QuestRuntime");
let core, I;
const lines = new Map();
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi(); I = core.ItemIdentifiers;
  PM.emitServerStartup({});
  PM.createApi("monkey speak test").onCustomEvent("npc-dialogue:line", (request) => {
    if (!lines.has(request.player)) lines.set(request.player, []);
    lines.get(request.player).push(request.text);
  });
});
after(() => PM.emitServerShutdown({}));

let nextIndex = 9500;
/** The transcript's first `count` lines, continuing the chatbox natively between them. */
async function opening(t, npcId, { amulet = false, carried = false, mm2 = false, count = 1 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(nextIndex++); p.setUsername("monkeyspeak" + p.getIndex()); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true); p.needsPlacement = false;
  p.setLocation(new core.Location(3668, 3010, 0));
  t.after(() => { p.closeInterruptibleInterfaces(); p.setRegistered(false); });
  const c = new ClientConnection(channel); c.player = p;
  if (carried) p.getInventory().setItem(0, new core.Item(I.MSPEAK_AMULET, 1));
  if (amulet) p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I.MSPEAK_AMULET, 1));
  if (mm2) {
    const quest = getRegisteredQuests().find((q) => q.key === "monkey_madness_ii");
    quest.setStage(p, 1000);
    assert.equal(quest.isComplete(p), true);
  }
  const npc = core.NPC.create(npcId, new core.Location(3669, 3010, 0));
  const request = { player: p, npc, npcId, handled: false };
  PM.emitCustomEvent("npc-dialogue:start", request);
  assert.equal(request.handled, true, "the monkey's transcript plays");
  for (let i = 0; i < 6 && (lines.get(p) ?? []).length < count && p.getDialogueManager().getCurrent(); i++) {
    const group = p.getPacketSender().getChatboxGroupId();
    await c.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 }]);
    c.processTurnPackets();
  }
  return (lines.get(p) ?? []).slice(0, count);
}

const UNDERSTOOD = /^(?:Arr! Yer messin with me monkey plunder!|Are ye here for\.\.\.the stuff\?)$/;

test("a Mos Le'Harmless monkey says 'Eeekeek ookeek!' to a player who can't understand it", async (t) => {
  assert.deepEqual(await opening(t, 2848), ["Eeekeek ookeek!"]);
  assert.deepEqual(await opening(t, 1038, { carried: true }), ["Eeekeek ookeek!"], "carried, not worn");
});

test("worn M'speak amulet: the Mos Le'Harmless monkeys (1038, 2848) talk", async (t) => {
  for (const id of [1038, 2848]) assert.match((await opening(t, id, { amulet: true }))[0], UNDERSTOOD, `monkey ${id}`);
});

test("Monkey Madness II complete: understood without the amulet", async (t) => {
  assert.match((await opening(t, 2848, { mm2: true }))[0], UNDERSTOOD);
});

test("the magic carpet monkey (23) and the blue monkey (1825) pick their section the same way", async (t) => {
  assert.deepEqual(await opening(t, 23, { count: 2 }), ["Who's a cute little monkey?", "Ukkuk oook! Eeek aka, ahh aka gonk."]);
  assert.deepEqual(await opening(t, 23, { amulet: true, count: 2 }), ["Who's a cute little monkey?", "Who's an ugly human? Give me a banana!"]);
  assert.deepEqual(await opening(t, 1825, { count: 2 }), ["Hey, monkey!", "Eeek! Eeek! Ook!"]);
  assert.notDeepEqual(await opening(t, 1825, { mm2: true }), ["Hey, monkey!"]);
});
