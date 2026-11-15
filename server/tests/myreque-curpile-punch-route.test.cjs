// Run after `yarn build`: node --test tests/myreque-curpile-punch-route.test.cjs
// The refusal option "I don't have to answer to you!" played through the real route (Talk-to on Curpile Fyod, the real
// NpcDialogues runtime, dialogue_continue packets; the route harness follows the retry test of the quiz PR): exactly one
// 3-damage hit is queued, once per playback, and the quest stage does not move. PUNCH-ROUTE lines print what was observed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
const savedBots = process.env.DISABLE_PLAYER_BOTS;
process.env.DISABLE_PLAYER_BOTS = "1";
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { Location } = require("../dist/game/model/Location");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const runtime = require("../plugins/quests/QuestRuntime");
const dialogues = require("../data/definitions/npc-dialogues.json");

let core, index = 36000;
const LUMBRIDGE = [3222, 3218, 0];
const MORTTON = { x: 3522, y: 3285 };
const COME = "I've come to help the Myreque. I've brought weapons.";
const LATER = "Hey... Don't tempt me! You's dicing wiv death here my friend!";
const PASS = "Okay, I believes ya... You can go on in. Head through the doors behind the tree. Once you's in, take the first cave on the right.";
const WEAPON_NAMES = [["STEEL_LONGSWORD", 1], ["STEEL_SHORTSWORD", 2], ["STEEL_DAGGER", 1], ["STEEL_MACE", 1], ["STEEL_WARHAMMER", 1]];
const realRandom = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  RegionManager.init();
  RegionManager.loadMapFiles(LUMBRIDGE[0], LUMBRIDGE[1]);
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => {
  Math.random = realRandom;
  PM.emitServerShutdown({});
  if (savedBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = savedBots;
});

const quest = () => runtime.getRegisteredQuests().find((q) => q.key === "in_search_of_the_myreque");

/** Talks to Curpile at quest stage `stage` carrying the weapons; `script` picks the options in order. */
async function talkCurpile(stage, script, existing) {
  Math.random = () => 0;
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = existing ?? new Player(new PlayerSession(channel), new Location(...LUMBRIDGE));
  if (!existing) {
    p.setIndex(index++); p.setRegistered(true); p.setUsername("curpile" + index);
    p.setAttribute("bot-skip-persistence", true);
    for (const [name, amount] of WEAPON_NAMES) p.getInventory().add(new core.Item(core.ItemIdentifiers[name], amount), false);
    quest().setStage(p, stage);
  }
  const connection = new ClientConnection(p.getSession?.().getChannel?.() ?? channel);
  connection.player = p;
  const npc = core.NPC.create(core.NpcIdentifiers.CURPILE_FYOD, new Location(...LUMBRIDGE));
  const lines = [];
  const optionLists = [];
  const sender = p.getPacketSender();
  const original = sender.sendString.bind(sender);
  sender.sendString = (text, ...rest) => { if (typeof text === "string") lines.push(text); return original(text, ...rest); };
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), action: "Talk-to", clickType: 1, handled: false });
  let picks = 0;
  for (let n = 0; n < 300; n++) {
    const pending = MultiChatboxPrompt.getPending(p);
    if (pending) {
      optionLists.push(pending.options.slice());
      const idx = picks < script.length ? pending.options.indexOf(script[picks]) : -1;
      if (idx < 0) break;
      picks++;
      await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: idx + 1 });
      continue;
    }
    if (!p.getDialogueManager().getCurrent()) break;
    await send({ type: "dialogue_continue", widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
  }
  const result = {
    lines, optionLists, open: !!p.getDialogueManager().getCurrent(), stage: quest().getStage(p),
    at: { x: p.getLocation().getX(), y: p.getLocation().getY() },
  };
  Math.random = realRandom;
  result.player = p;
  return result;
}


const allOptionsOf = (r) => r.optionLists.flat();


const REFUSE = "I don't have to answer to you!";
const pending = (p) => p.getHitpoints() - p.getHitpointsAfterPendingDamage();
test("Curpile: refusing the questions through the real route queues exactly one 3-damage hit and leaves the stage", async () => {
  const r = await talkCurpile(25, [REFUSE]);
  const hp = pending(r.player);
  console.log(`PUNCH-ROUTE stage=${r.stage} open=${r.open} pending=${hp} options=${JSON.stringify(r.optionLists)} lines=${JSON.stringify(r.lines.slice(-6))}`);
  assert.ok(r.lines.some((l) => l.includes("You do if you know what's good for you!")), "the refusal reply played");
  assert.equal(hp, 3, "one hit of 3");
  assert.equal(r.stage, 25, "no stage change");
  r.player.setRegistered(false);
});
