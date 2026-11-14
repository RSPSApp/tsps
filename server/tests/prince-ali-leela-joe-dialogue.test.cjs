// Run after `yarn build`: node --test tests/prince-ali-leela-joe-dialogue.test.cjs
//
// Prince Ali Rescue, Leela and Joe in the Wiki shape (Transcript:Prince Ali Rescue, imported from
// osrsreboxed-db#96). Real engine: every plugin loaded, a real Player and Inventory, real NPC
// dispatch (Talk-to) and the real transcript runner.
//  - Leela's first visit explains the plan, even with the disguise, key and rope already held.
//  - Coming back at the same stage with everything plays "I do indeed." and moves the quest on;
//    coming back without everything plays her "talking to Leela again" lines.
//  - Joe asks "Not too drunk?" after the first beer whatever else the player holds.
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
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");
const { getRegisteredQuests } = require("../plugins/quests/QuestRuntime");

let core, quest, I, N;
let next = 6300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  ({ ItemIdentifiers: I, NpcIdentifiers: N } = core);
  quest = getRegisteredQuests().findLast((q) => q.key === "prince_ali_rescue");
  assert.ok(quest, "Prince Ali Rescue is registered");
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("princeali" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3113, 3261, 0));
  player.needsPlacement = false;
  t.mock.method(player.getPacketSender(), "sendMessage", () => player.getPacketSender());
  return player;
}

const pending = (player) => core.MultiChatboxPrompt.getPending(player);
function answer(player, number) {
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
  });
}

/** Lines said, from the real dialogue chain, stopping at a choice. */
function spoken(player) {
  const lines = [];
  const manager = player.getDialogueManager();
  for (let i = 0; i < 40 && manager.isActive(); i++) {
    const current = manager.getCurrent();
    if (current instanceof NpcDialogue || current instanceof PlayerDialogue) {
      lines.push(current.getText().replace(/\s+/g, " ").trim());
    }
    if (current instanceof OptionDialogue) break;
    manager.advance();
  }
  return lines;
}

function talk(player, npcId, location) {
  player.getDialogueManager().reset();
  const npc = core.NPC.create(npcId, location);
  const clickType = npc.getDefinition().getActions().indexOf("Talk-to") + 1;
  assert.ok(clickType > 0, `${npc.getDefinition().getName()} has Talk-to`);
  PluginManager.emitNpcInteraction({ player, npc, npcId, definition: npc.getDefinition(), clickType, handled: false });
  return spoken(player);
}

const talkToLeela = (player) => talk(player, N.LEELA, new core.Location(3113, 3262, 0));
const talkToJoe = (player) => talk(player, N.JOE_5, new core.Location(3124, 3245, 0));

function holdEverything(player) {
  for (const id of [I.WIG, I.PINK_SKIRT, I.PASTE, I.BRONZE_KEY, I.ROPE]) {
    player.getInventory().add(new core.Item(id, 1), false);
  }
}

test("stage 20 with disguise, key and rope: first Leela visit explains the plan, the return visit plays I do indeed.", (t) => {
  const player = actor(t);
  quest.setStage(player, 20);
  holdEverything(player);

  const first = talkToLeela(player).join("\n");
  assert.match(first, /You must be Leela/);
  assert.match(first, /Yes, he sent word ahead that you'd be coming/);
  assert.doesNotMatch(first, /I already have everything we need/, "the Wiki first visit has no prepared branch");
  assert.equal(quest.getStage(player), 20, "the first visit does not move the quest on");

  const again = talkToLeela(player);
  assert.deepEqual(again, [
    "You're back. Do you have everything needed yet?",
    "I do indeed.",
    "Good work. Now, before breaking the Prince out, you'll need to find a way to deal with his personal guard. He's talkative, so try to find a weakness. Remember, we don't want any unneeded violence.",
    "Alright. I'll go have a chat to this guard.",
  ]);
  assert.equal(quest.getStage(player), 30);
});

test("stage 20 return visit without everything plays Leela's talking-again lines", (t) => {
  const player = actor(t);
  quest.setStage(player, 20);
  talkToLeela(player);
  const again = talkToLeela(player);
  assert.deepEqual(again, ["You're back. Do you have everything needed yet?"]);
  assert.ok(pending(player), "her questions menu follows");
  assert.ok(pending(player).options.includes("Not yet. I'll go and prepare."), JSON.stringify(pending(player).options));
  assert.equal(quest.getStage(player), 20);
});

for (const beers of [1, 3]) {
  test(`Joe asks "Not too drunk?" after the first beer with ${beers} beer(s)`, (t) => {
    const player = actor(t);
    quest.setStage(player, 30);
    player.getInventory().add(new core.Item(I.BEER, beers), false);
    assert.deepEqual(talkToJoe(player), ["Hi there.", "What do you want?"]);
    assert.ok(pending(player), "Joe's topics menu");
    assert.equal(answer(player, 1), true, "I have some beer here. Fancy one?");
    const lines = spoken(player);
    assert.ok(lines.includes("How are you? Still okay? Not too drunk?"), lines.join("\n"));
    assert.equal(player.getInventory().getAmount(I.BEER), 0, "Joe drinks the beer, then the two more when offered");
    assert.equal(quest.getStage(player), beers === 3 ? 40 : 31);
  });
}
