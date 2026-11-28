// Run after `yarn build`: node --test tests/fenkenstrain-silver-furnace.test.cjs
// Creature of Fenkenstrain's conductor is cast from a silver bar on a furnace with the conductor mould, through the
// silver crafting menu (Crafting's), as the revision 243 capture has it.
// Its hook took every silver bar used on a furnace while the quest was in progress, so without the conductor mould a
// tiara, holy symbol or any silver jewellery answered "You need a conductor mould to cast anything useful." until the
// quest was done.
// Real engine: every plugin loaded, a real Player, item-on-object through PluginManager.emitItemOnObject.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, I, furnace;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  PM.emitServerStartup({});
  const total = core.CacheDefinitions.getCounts().objects;
  for (let id = 0; id < total && furnace == null; id++) {
    const def = core.CacheDefinitions.getObject(id);
    if (def?.name === "Furnace" && def.actions?.includes("Smelt")) furnace = id;
  }
});
after(() => PM.emitServerShutdown({}));

let next = 9600;
function setup(t, stage, items) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("fenkensilver" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.getSkillManager().setMaxLevels(core.Skill.CRAFTING, 50, false);
  p.getSkillManager().setCurrentLevels(core.Skill.CRAFTING, 50, false);
  const quest = require("../plugins/quests/QuestRuntime").questNamed("Creature of Fenkenstrain");
  if (stage != null) quest.setStage(p, stage);
  for (const id of [I.SILVER_BAR, ...items]) p.getInventory().adds(id, 1);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  const use = () => {
    const object = { getId: () => furnace, getType: () => 10, getLocation: () => p.getLocation(), getDefinition: () => core.ObjectDefinition.forId(furnace) };
    const event = { player: p, itemId: I.SILVER_BAR, item: p.getInventory().getItems().find((i) => i?.getId() === I.SILVER_BAR),
      slot: 0, objectId: furnace, object, location: p.getLocation(), handled: false };
    PM.emitItemOnObject(event);
    return event;
  };
  return { p, messages, use };
}

test("mid-quest, a silver bar on a furnace with a tiara mould is not taken by the conductor step", (t) => {
  assert.ok(furnace != null, "a Furnace with Smelt in the cache");
  const { p, messages, use } = setup(t, 1, [I.TIARA_MOULD]);
  use();
  assert.ok(!messages.some((m) => /conductor/i.test(m)), `no conductor line: ${JSON.stringify(messages)}`);
  assert.equal(p.getInventory().getAmount(I.CONDUCTOR), 0);
});

test("mid-quest, the conductor mould opens the silver menu and its lightning rod is the conductor (capture ticks 1652-1657)", (t) => {
  const { p, use } = setup(t, 1, [I.CONDUCTOR_MOULD]);
  const event = use();
  assert.equal(event.handled, true);
  assert.equal(p.getInterfaceId(), 6, "silver_crafting, as live opens it (Crafting's menu; the quest no longer casts it itself)");
  PM.emitInterfaceActionClick({ player: p, buttonId: (6 << 16) | 26, action: 1, handled: false });
  for (let i = 0; i < 4; i++) core.TaskManager.process();
  assert.equal(p.getInventory().getAmount(I.CONDUCTOR), 1);
  assert.equal(p.getInventory().getAmount(I.SILVER_BAR), 0);
  assert.equal(p.getInventory().getAmount(I.CONDUCTOR_MOULD), 1, "the mould is a tool and is kept (tick 1657)");
});
