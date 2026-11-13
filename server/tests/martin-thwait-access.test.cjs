// Run after `yarn build`: node --test tests/martin-thwait-access.test.cjs
// Martin Thwait's Lost and Found needs 50 Thieving and 50 Agility, or 99 Thieving; boosts don't count (Wiki: Martin
// Thwait). All plugins, the real cache, the generated transcript and a real Player.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const ROOT = path.resolve(__dirname, "..");
const MARTIN = { x: 3048, y: 4975, z: 1 };
const SHOP_INTERFACE = 300;
let core;
let index = 400;

before(async () => {
  await CachePipeline.initialize(ROOT);
  // The server's shops, as its startup data loads them.
  assert.equal(new (require("../dist/game/definition/loader/impl/ShopDefinitionLoader").ShopDefinitionLoader)().load(), true);
  require("../dist/game/model/container/shop/ShopManager").ShopManager.initialize();
  PluginManager.loadFromDirectory(path.join(ROOT, "plugins"));
  PluginManager.emitServerStartup({ timestamp: Date.now() });
  core = PluginManager.getCoreApi();
});

function visitor(t, { thieving, agility, boostedThieving = thieving }) {
  const transport = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(transport));
  p.setUsername("thwaitqa" + index);
  p.setIndex(index++);
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(MARTIN.x - 1, MARTIN.y, MARTIN.z));
  p.needsPlacement = false;
  const skills = p.getSkillManager();
  skills.setMaxLevel(core.Skill.THIEVING, thieving, false).setCurrentLevel(core.Skill.THIEVING, boostedThieving, false);
  skills.setMaxLevel(core.Skill.AGILITY, agility, false).setCurrentLevel(core.Skill.AGILITY, agility, false);
  const lines = [];
  const manager = p.getDialogueManager();
  const start = manager.startDialogues.bind(manager);
  t.mock.method(manager, "startDialogues", (chain, ...rest) => {
    for (const entry of chain.getDialogues?.().values?.() ?? []) lines.push(entry.getText?.() ?? "");
    return start(chain, ...rest);
  });
  t.after(() => p.setRegistered(false));
  const npc = core.NPC.create(core.NpcIdentifiers.MARTIN_THWAIT, new core.Location(MARTIN.x, MARTIN.y, MARTIN.z));
  // As NPCOptionPacketListener sends it: the shops.json binding is keyed by npcId and click.
  const trade = () => PluginManager.emitNpcInteraction({
    player: p, npc, definition: npc.getDefinition(), npcId: npc.getContentId(p), npcIndex: npc.getIndex(), option: "Trade",
    clickType: 3, location: { x: MARTIN.x, y: MARTIN.y, z: MARTIN.z }, handled: false,
  });
  return { p, lines, trade };
}

test("Trade opens the Lost and Found with 50 Thieving and 50 Agility, or 99 Thieving", (t) => {
  for (const [thieving, agility] of [[50, 50], [70, 80], [99, 1]]) {
    const f = visitor(t, { thieving, agility });
    f.trade();
    assert.equal(f.p.getInterfaceId(), SHOP_INTERFACE, `${thieving} Thieving, ${agility} Agility: the shop opens`);
  }
});

test("Trade without the levels gets the transcript's train-up line, and no shop", (t) => {
  const cases = [
    [{ thieving: 49, agility: 99 }, "Train up your Thieving skill to at least 50"],
    [{ thieving: 98, agility: 49 }, "Train up your Agility skill to at least 50"],
    // Boosts don't count: a 45 boosted to 55 is still a 45.
    [{ thieving: 45, agility: 60, boostedThieving: 55 }, "Train up your Thieving skill to at least 50"],
  ];
  for (const [levels, line] of cases) {
    const f = visitor(t, levels);
    f.trade();
    assert.notEqual(f.p.getInterfaceId(), SHOP_INTERFACE, `${JSON.stringify(levels)}: no shop`);
    assert.ok(f.lines.some((text) => text.includes(line)), `${JSON.stringify(levels)}: "${line}" (got ${JSON.stringify(f.lines)})`);
  }
});

test("Talk-to's transcript conditions get the same answers as Trade's", (t) => {
  const ask = (levels, text) => PluginManager.emitNpcDialogueCondition({
    player: visitor(t, levels).p, npcId: core.NpcIdentifiers.MARTIN_THWAIT, text,
  });
  // The Talk-to section's wording (npc-dialogues.json, Martin Thwait).
  const THIEVING = "If the player doesn't have at least level 50 Thieving:";
  const AGILITY = "If the player has between level 50-98 Thieving, but doesn't have at least level 50 Agility:";
  const ACCESS = "If the player has over level 50 Thieving and Agility, or level 99 Thieving outright:";
  const answers = (levels) => [THIEVING, AGILITY, ACCESS].map((text) => ask(levels, text));
  assert.deepEqual(answers({ thieving: 49, agility: 99 }), [true, false, false]);
  assert.deepEqual(answers({ thieving: 98, agility: 49 }), [false, true, false]);
  assert.deepEqual(answers({ thieving: 50, agility: 50 }), [false, false, true]);
  assert.deepEqual(answers({ thieving: 99, agility: 1 }), [false, false, true]);
  assert.deepEqual(answers({ thieving: 45, agility: 60, boostedThieving: 55 }), [true, false, false], "boosts don't count");
});
