// Run after `yarn build`: node --test tests/giant-dwarf-secretary-next-task.test.cjs
//
// Issue #5741: after handing in a company ore task, the secretary's "Do you have another task for
// me?" option is a wiki {{tact|above}} whose target the dump lost, so the conversation closed with
// no next task. Real cache, every plugin loaded, the real turn-in transcript and the real
// multi-chatbox prompt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const Runtime = require("../plugins/quests/QuestRuntime");

const SECRETARY = 5990; // Purple Pewter Secretary (the company table's own secretary id)
const STAGE_CONSORTIUM = 30;
const PAGE = "The Giant Dwarf";
const TURN_IN = "the-head-of-a-dwarf-talking-to-a-company-secretary-turning-in-items";
let core, next = 9950;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2662, 3310);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player() {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("giantdwarf" + next); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2662, 3310, 0)); p.needsPlacement = false;
  const quest = Runtime.getRegisteredQuests().find((q) => q.key === "giant_dwarf");
  assert.ok(quest, "The Giant Dwarf is registered");
  quest.setStage(p, STAGE_CONSORTIUM);
  p.setAttribute("quest.giant_dwarf.company", 1);
  p.setAttribute("quest.giant_dwarf.joined", true);
  return p;
}

function startTurnIn(p) {
  const request = {
    player: p,
    npcId: SECRETARY,
    variant: { page: PAGE, variant: TURN_IN },
    handled: false,
  };
  PM.emitCustomEvent("npc-dialogue:start", request);
  assert.equal(request.handled, true, "the turn-in transcript starts");
}

function promptFor(p) {
  for (let i = 0; i < 30; i++) {
    const pending = MultiChatboxPrompt.getPending(p);
    if (pending) return pending;
    const current = p.getDialogueManager().getCurrent?.();
    if (!current) return null;
    p.getDialogueManager().advance();
    for (let t = 0; t < 2; t++) core.TaskManager.process();
  }
  return MultiChatboxPrompt.getPending(p);
}

function pick(p, prefix) {
  const prompt = promptFor(p);
  assert.ok(prompt, "a menu is open");
  const index = prompt.options.findIndex((text) => text.startsWith(prefix));
  assert.ok(index >= 0, `the menu offers "${prefix}" (${prompt.options.join(" | ")})`);
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: p, groupId: 219, slot: index + 1 }), true);
  for (let t = 0; t < 4; t++) core.TaskManager.process();
}

test('the secretary continues into the next task offer after a hand-in (#5741)', () => {
  const p = player();
  startTurnIn(p);
  pick(p, "Do you have another task for me?");
  const nextPrompt = promptFor(p);
  const current = p.getDialogueManager().getCurrent?.();
  assert.ok(nextPrompt || current,
    'the conversation continues instead of closing after "Do you have another task for me?"');
  if (nextPrompt) {
    assert.ok(nextPrompt.options.some((text) => /take it|task|work/i.test(text)),
      `the next menu is a task offer (${nextPrompt.options.join(" | ")})`);
  }
});

test('"I need to speak to the director." also continues instead of closing', () => {
  const p = player();
  startTurnIn(p);
  pick(p, "I need to speak to the director.");
  const nextPrompt = promptFor(p);
  const current = p.getDialogueManager().getCurrent?.();
  assert.ok(nextPrompt || current,
    'the conversation continues instead of closing after "I need to speak to the director."');
});
