// Run after `yarn build`: node --test tests/abyss-multilocs.test.cjs
//
// The map places a multiloc parent and a click names it, so a handler keyed on the child a player sees never
// fires. Real packets with the parent's id at the real tile, through the real route. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const LAYOUT_VARBIT = 625; // rcu_abyssal_generator
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [3, 0], [0, 3]];

let core;
let next = 7400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
});
after(() => PM.emitServerShutdown({}));

function actor(t, at) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("abyssqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(at);
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return { p, c, messages };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  for (let i = 0; i < 12; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

function spy(t, method) {
  const seen = [];
  const real = PM[method];
  t.mock.method(PM, method, (event, ...rest) => {
    seen.push(event);
    return real.call(PM, event, ...rest);
  });
  return seen;
}

async function fromASide(t, seen, tile, prepare, packet) {
  core.RegionManager.loadMapFiles(tile[0], tile[1]);
  const sides = SIDES.map(([dx, dy]) => new core.Location(tile[0] + dx, tile[1] + dy, tile[2]))
    .filter((location) => !core.RegionManager.blocked(location, null));
  for (const side of sides) {
    const f = actor(t, side);
    prepare(f);
    await send(f, packet);
    t.diagnostic(`from ${side.getX()},${side.getY()}: events ${seen.length}, said ${f.messages}`);
    if (seen.length) return f;
  }
  return assert.fail(`no event from any side of ${tile}`);
}

async function mine(t, { parent, tile, layout }) {
  t.mock.method(Math, "random", () => 0);
  const seen = spy(t, "emitObjectInteraction");
  const f = await fromASide(t, seen, tile, (a) => {
    if (layout) a.p.getPacketSender().sendVarbit(LAYOUT_VARBIT, layout);
    a.p.getInventory().setItem(0, new core.Item(core.ItemIdentifiers.BRONZE_PICKAXE, 1));
  }, { type: "object_option", id: parent, x: tile[0], y: tile[1], clickType: 1 });
  assert.equal(seen[0].objectId, parent, "the event names the parent");
  assert.equal(seen[0].definition?.getName?.(), "Rock", "and shows the rock");
  assert.equal(seen[0].handled, true, "the real click is handled");
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.MINING) > 0, true, "and passing it earns the XP");
}

test("the Abyss: mining the rock a layout puts at 3026,4813", (t) => mine(t, { parent: 26188, tile: [3026, 4813, 0] }));

test("the Abyss: another layout puts the rock at 3041,4811", (t) => mine(t, { parent: 26187, tile: [3041, 4811, 0], layout: 1 }));

test("Cadava bush at 3264,3366: Pick-from gives a berry", async (t) => {
  const seen = spy(t, "emitObjectInteraction");
  const tile = [3264, 3366, 0];
  const definition = core.ObjectDefinition.forPlayer(33183, { getPacketSender: () => ({ getVarbit: () => 0 }) });
  const clickType = definition.getInteractions().indexOf("Pick-from") + 1;
  const f = await fromASide(t, seen, tile, () => {}, { type: "object_option", id: 33183, x: tile[0], y: tile[1], clickType });
  assert.equal(seen[0].objectId, 33183, "the event names the parent");
  assert.equal(seen[0].handled, true, "the real click is handled");
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.CADAVA_BERRIES), 1, "and picks a berry");
});

test("The Golem: hammer on the demon's throne takes the gems", async (t) => {
  const seen = spy(t, "emitItemOnObject");
  const I = core.ItemIdentifiers;
  const tile = [2719, 4913, 2];
  const f = await fromASide(t, seen, tile, (a) => {
    a.p.getInventory().setItem(0, new core.Item(I.HAMMER, 1));
    a.p.getInventory().setItem(1, new core.Item(I.CHISEL, 1));
  }, { type: "item_on_object", itemId: I.HAMMER, slot: 0, widgetId: 149 << 16, objectId: 6300, x: tile[0], y: tile[1] });
  assert.equal(seen[0].objectId, 6300, "the event names the parent");
  assert.equal(seen[0].handled, true, "the real use is handled");
  assert.equal(f.p.getInventory().getAmount(I.RUBY), 2, "and takes the gems");
});

async function vine(t, { parent, tile, quest = true }) {
  const seen = spy(t, "emitObjectInteraction");
  const f = await fromASide(t, seen, tile, (a) => {
    a.p.getSkillManager().setMaxLevels(core.Skill.AGILITY, 99, false);
    a.p.getSkillManager().setCurrentLevels(core.Skill.AGILITY, 99, false);
    if (quest) {
      const entry = QuestRuntime.getRegisteredQuests().find((candidate) => candidate.key === "legends_quest");
      entry.setStage(a.p, entry.completionValue);
    }
  }, { type: "object_option", id: parent, x: tile[0], y: tile[1], clickType: 1 });
  assert.equal(seen[0].objectId, parent, "the event names the parent");
  assert.equal(seen[0].handled, true, "the real click is handled");
  for (let i = 0; i < 12; i++) {
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
  t.diagnostic(`at ${f.p.getLocation().getX()},${f.p.getLocation().getY()}; said ${f.messages}`);
  return f;
}

const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY()];

test("Agility: the Kharazi vine's north end, 26884, lands at its south end", async (t) => {
  assert.deepEqual(at(await vine(t, { parent: 26884, tile: [2899, 2941, 0] })), [2899, 2937]);
});

test("Agility: the Kharazi vine's south end, 26886, lands at its north end", async (t) => {
  assert.deepEqual(at(await vine(t, { parent: 26886, tile: [2899, 2938, 0] })), [2899, 2942]);
});

test("Agility: the Kharazi vine refuses without Legends' Quest", async (t) => {
  const f = await vine(t, { parent: 26884, tile: [2899, 2941, 0], quest: false });
  assert.notDeepEqual(at(f), [2899, 2937], "and doesn't cross");
  assert.ok(f.messages.some((message) => /Legends' Quest/.test(message)), `and says why: ${f.messages}`);
});

const RIFT = [3027, 4834, 0];
const KOUREND_TEXT = "The rift cannot find the true Blood Altar.";

/** A real click on the blood rift, and every teleport and chatbox line it led to. */
async function rift(t, { clickType, sins = false, lastUsed = 0 }) {
  const seen = spy(t, "emitObjectInteraction");
  const emit = PM.emitCustomEvent;
  const teleports = [];
  t.mock.method(PM, "emitCustomEvent", (name, event) => {
    if (name === "lever:teleport") teleports.push([event.destination.getX(), event.destination.getY()]);
    return emit.call(PM, name, event);
  });
  const strings = [];
  const f = await fromASide(t, seen, RIFT, (a) => {
    a.p.getPacketSender().sendVarbit(13783, lastUsed);
    if (sins) {
      const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "sins_of_the_father");
      quest.setStage(a.p, quest.completionValue);
    }
    const sender = a.p.getPacketSender();
    const sendString = sender.sendString;
    t.mock.method(sender, "sendString", function (text, ...rest) {
      strings.push(String(text));
      return sendString.call(this, text, ...rest);
    });
  }, { type: "object_option", id: 43848, x: RIFT[0], y: RIFT[1], clickType });
  assert.equal(seen[0].objectId, 43848, "the event names the parent");
  assert.equal(seen[0].handled, true, "the real click is handled");
  return { f, teleports, strings };
}

test("the Abyss: the blood rift", async (t) => {
  const { f, teleports } = await rift(t, { clickType: 1 });
  assert.deepEqual(teleports, [], "without Sins of the Father it goes nowhere");
  assert.ok(f.messages.some((message) => /Sins of the Father/.test(message)), `and says why: ${f.messages}`);
});

test("the Abyss: Exit-through goes to the true Blood Altar after Sins of the Father (rsprox 1636)", async (t) => {
  const { teleports } = await rift(t, { clickType: 1, sins: true });
  assert.deepEqual(teleports, [[3226, 4831]]);
});

test("the Abyss: Exit-through (Kourend) gives the captured refusal (rsprox 1636)", async (t) => {
  const { teleports, strings } = await rift(t, { clickType: 2, sins: true });
  assert.deepEqual(teleports, []);
  assert.ok(strings.some((text) => text.includes(KOUREND_TEXT)), strings.join(" | "));
});

test("the Abyss: varbit 13783 swaps the two ops, so the label decides, not the slot", async (t) => {
  const { teleports, strings } = await rift(t, { clickType: 1, sins: true, lastUsed: 1 });
  assert.deepEqual(teleports, [], "op1 is now Exit-through (Kourend)");
  assert.ok(strings.some((text) => text.includes(KOUREND_TEXT)), strings.join(" | "));
});
