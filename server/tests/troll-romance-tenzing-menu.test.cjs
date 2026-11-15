// Run after `yarn build`: node --test tests/troll-romance-tenzing-menu.test.cjs
//
// Troll Romance, Tenzing's Trollweiss menu (rsprox_transcripts/242/911982.txt: "Do you know where I can
// find Trollweiss?" is its 4th option). Its quest=no options replay Tenzing's own page, whose
// "Was there anything else?" jumps to the initial options. That must be the Trollweiss menu the player
// picked from, not the generic page's (which has "Nice place you have here." and no Trollweiss).
// Real engine: every plugin loaded, a real Player, the real transcript runner and dialogue manager.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcDialogue } = require("../dist/game/model/dialogues/entries/impl/NpcDialogue");
const { PlayerDialogue } = require("../dist/game/model/dialogues/entries/impl/PlayerDialogue");
const runtime = require("../plugins/quests/QuestRuntime");

const TROLLWEISS = "Do you know where I can find Trollweiss?";
const SHERPA = "What does a Sherpa do?";
const NICE_PLACE = "Nice place you have here.";
let core;
let next = 6300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
});

function actor() {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("tenzing" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2820, 3555, 0));
  player.needsPlacement = false;
  const quest = (key) => runtime.getRegisteredQuests().findLast((entry) => entry.key === key);
  quest("death_plateau").setStage(player, quest("death_plateau").completionValue);
  quest("troll_stronghold").setStage(player, quest("troll_stronghold").completionValue);
  quest("troll_romance").setStage(player, 10); // Aga has told the player about Trollweiss
  return player;
}

/** Lines said up to the next menu (the chatbox option prompt) or the end, with that menu's options. */
function untilMenu(player) {
  const lines = [];
  const manager = player.getDialogueManager();
  for (let i = 0; i < 40 && manager.isActive(); i++) {
    const current = manager.getCurrent();
    if (current instanceof NpcDialogue || current instanceof PlayerDialogue) lines.push(current.getText());
    if (core.MultiChatboxPrompt.getPending(player)) break;
    manager.advance();
  }
  return { lines, options: core.MultiChatboxPrompt.getPending(player)?.options ?? null };
}

function talk(player) {
  const npc = core.NPC.create(core.NpcIdentifiers.TENZING, new core.Location(2821, 3555, 0));
  const clickType = npc.getDefinition().getActions().indexOf("Talk-to") + 1;
  assert.ok(clickType > 0);
  return PluginManager.emitNpcInteraction({
    player, npc, npcId: npc.getId(), definition: npc.getDefinition(), clickType, handled: false,
  });
}

function choose(player, options, text) {
  const index = options.indexOf(text);
  assert.ok(index >= 0, `"${text}" is offered: ${JSON.stringify(options)}`);
  core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: index + 1, action: index + 1,
  });
}

test("after a shared option, Tenzing's 'anything else?' menu is the Trollweiss one again", () => {
  const player = actor();
  assert.equal(talk(player), true);
  const first = untilMenu(player);
  assert.ok(first.options?.includes(TROLLWEISS), JSON.stringify(first));
  choose(player, first.options, SHERPA);
  const after = untilMenu(player);
  assert.ok(after.lines.some((line) => /expert guides/.test(line)), JSON.stringify(after.lines));
  assert.ok(after.lines.some((line) => /Was there anything else\?/.test(line)), JSON.stringify(after.lines));
  assert.deepEqual(after.options, first.options, "the menu the player picked from, with Trollweiss");
  assert.ok(!after.options.includes(NICE_PLACE), "not the generic page's menu");

  // And it still works from there: a second shared option, then the Trollweiss branch.
  choose(player, after.options, SHERPA);
  const again = untilMenu(player);
  assert.deepEqual(again.options, first.options);
  choose(player, again.options, TROLLWEISS);
  const trollweiss = untilMenu(player);
  assert.ok(trollweiss.lines.some((line) => /asked me about Trollweiss/.test(line)), JSON.stringify(trollweiss.lines));
});
