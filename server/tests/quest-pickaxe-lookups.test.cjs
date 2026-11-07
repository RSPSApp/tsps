// Run after `yarn build`: node --test tests/quest-pickaxe-lookups.test.cjs
// Quest rocks and rubble checked their own bronze-to-rune pickaxe lists, so a crystal, infernal, dragon or 3rd age
// pickaxe was "You need a pickaxe to mine this rock." They now ask Mining. Real engine: every plugin loaded, a real
// Player, Family Crest's Witchaven gold rock through the object event with its cache definition.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");

let core, next = 9850;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

// A tile in the Witchaven region the quest names (42, 151).
const ROCK = { x: 42 * 64 + 10, y: 151 * 64 + 10, z: 0 };

function miner(t, pickaxe) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("qpick" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(ROCK.x - 1, ROCK.y, 0)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  for (const skill of [core.Skill.MINING, core.Skill.AGILITY]) {
    p.getSkillManager().setMaxLevels(skill, 99, false); p.getSkillManager().setCurrentLevels(skill, 99, false);
  }
  const quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "family_crest");
  assert.ok(quest); quest.setStage(p, 7);
  if (pickaxe) p.getInventory().add(new core.Item(pickaxe, 1), false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, messages };
}

function mineRock(f) {
  const id = core.ObjectIdentifiers.GOLD_ROCKS_2;
  const definition = ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((s) => /mine/i.test(s ?? "")) + 1;
  assert.ok(clickType > 0);
  const object = new GameObject(id, new core.Location(ROCK.x, ROCK.y, ROCK.z), 10, 0, null);
  const from = f.p.getLocation();
  const handled = PM.emitObjectInteraction({ player: f.p, object, objectId: id, definition, clickType, location: ROCK,
    sourceLocation: { x: from.getX(), y: from.getY(), z: from.getZ() }, handled: false });
  assert.equal(handled, true, f.messages.join(" | "));
}

for (const name of ["CRYSTAL_PICKAXE", "INFERNAL_PICKAXE", "DRAGON_PICKAXE", "_3RD_AGE_PICKAXE"]) {
  test(`Family Crest's perfect gold rock takes a ${name}`, (t) => {
    const f = miner(t, core.ItemIdentifiers[name]);
    mineRock(f);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.PERFECT_GOLD_ORE), 1, f.messages.join(" | "));
  });
}

test("Family Crest's rock still refuses with no pickaxe", (t) => {
  const f = miner(t, null);
  mineRock(f);
  assert.ok(f.messages.includes("You need a pickaxe to mine this rock."), f.messages.join(" | "));
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.PERFECT_GOLD_ORE), 0);
});

test("mining:pickaxe names any pickaxe Mining knows, and nothing else", () => {
  for (const name of ["BRONZE_PICKAXE", "CRYSTAL_PICKAXE", "INFERNAL_PICKAXE", "_3RD_AGE_PICKAXE"]) {
    const request = { itemId: core.ItemIdentifiers[name], pickaxe: null };
    PM.emitCustomEvent("mining:pickaxe", request);
    assert.equal(request.pickaxe?.id, core.ItemIdentifiers[name], name);
  }
  const request = { itemId: core.ItemIdentifiers.BRONZE_AXE, pickaxe: null };
  PM.emitCustomEvent("mining:pickaxe", request);
  assert.equal(request.pickaxe, null);
});
