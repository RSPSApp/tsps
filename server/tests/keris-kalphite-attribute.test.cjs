// Run after `yarn build`: node --test tests/keris-kalphite-attribute.test.cjs
// The keris works against kalphites and scarabs: the monster data marks both with the kalphite attribute, while scarab
// names (Scarab Mage, Locust rider, Kephri) say neither "kalphite" nor "scabarite". Real engine: every plugin loaded with
// the NPC definitions, a real Player wielding a keris, real NPCs, the plugins' registered modifiers applied.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const Effects = require("../dist/game/content/combat/EquipmentEffects");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("a keris boosts against a Scarab Mage (kalphite attribute) as against a kalphite, and not against a cow", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9978); p.setUsername("kerisuser"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.KERIS, 1));
  t.mock.method(core.Misc, "randomInclusive", () => 2); // no triple hit
  let target = null;
  t.mock.method(p.getCombat(), "getTarget", () => target);
  const hit = (npcId) => { target = core.NPC.create(npcId, new core.Location(3200, 3200, 0)); return Effects.applyMeleeHitModifiers(p, 30); };
  assert.ok(core.NPC.create(794, new core.Location(3200, 3200, 0)).getCurrentDefinition().hasAttribute("kalphite"), "Scarab Mage carries the attribute");
  assert.equal(hit(794), 40, "Scarab Mage: +33% (4/3)");
  assert.equal(hit(core.NpcIdentifiers.KALPHITE_WORKER), 40, "a kalphite by name still counts");
  assert.equal(hit(core.NpcIdentifiers.COW), 30, "a cow doesn't");
});
