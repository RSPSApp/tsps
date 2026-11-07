// Run after `yarn build`: node --test tests/cox-shared-tools.test.cjs
// The Chambers of Xeric kept their own axe and pickaxe tables: the infernal axe without its 85 Firemaking, the crystal
// tools without their Agility, and many tools missing (3rd age, trailblazer, gilded; the Guardians' pickaxe factor 0).
// They now ask Woodcutting and Mining. Real engine: every plugin loaded, real Players and items.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, Shared, Guardians, next = 9700;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  Shared = require("../plugins/minigames/cox/Shared.ChambersOfXeric");
  Guardians = require("../plugins/minigames/cox/Guardians.ChambersOfXeric");
});
after(() => PM.emitServerShutdown({}));

function raider(t, levels, items = [], wield = null) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("coxtool" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  for (const [name, level] of Object.entries(levels)) {
    p.getSkillManager().setMaxLevels(core.Skill[name], level, false); p.getSkillManager().setCurrentLevels(core.Skill[name], level, false);
  }
  for (const id of items) p.getInventory().add(new core.Item(id, 1), false);
  if (wield) p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(wield, 1));
  return p;
}

const I = () => core.ItemIdentifiers;

test("an infernal axe needs 85 Firemaking in the raid, as Woodcutting has it", (t) => {
  const low = raider(t, { WOODCUTTING: 99, FIREMAKING: 84 }, [I().INFERNAL_AXE]);
  assert.equal(Shared.axeOf(low), null);
  const ok = raider(t, { WOODCUTTING: 99, FIREMAKING: 85 }, [I().INFERNAL_AXE]);
  assert.equal(Shared.axeOf(ok)?.id, I().INFERNAL_AXE);
  assert.equal(typeof Shared.axeOf(ok).animation, "number", "an animation id the raid can play");
});

test("a crystal pickaxe needs its Agility in the raid; a 3rd age pickaxe is now a pickaxe", (t) => {
  const noAgility = raider(t, { MINING: 99, AGILITY: 1 }, [I().CRYSTAL_PICKAXE]);
  assert.equal(Shared.pickaxeOf(noAgility), null);
  const thirdAge = raider(t, { MINING: 99 }, [I()._3RD_AGE_PICKAXE]);
  assert.equal(Shared.pickaxeOf(thirdAge)?.id, I()._3RD_AGE_PICKAXE);
  assert.equal(typeof Shared.pickaxeOf(thirdAge).animation, "number");
});

test("the Guardians' pickaxe factor counts any wielded pickaxe, capped at a dragon pickaxe's 61 (Wiki)", (t) => {
  const thirdAge = raider(t, { MINING: 99 }, [], I()._3RD_AGE_PICKAXE);
  assert.equal(Guardians.pickaxeFactor(thirdAge), (50 + 99 + 61) / 150);
  const crystal = raider(t, { MINING: 99 }, [], I().CRYSTAL_PICKAXE);
  assert.equal(Guardians.pickaxeFactor(crystal), (50 + 99 + 61) / 150, "71 capped at 61");
  const rune = raider(t, { MINING: 99 }, [], I().RUNE_PICKAXE);
  assert.equal(Guardians.pickaxeFactor(rune), (50 + 99 + 41) / 150);
  const none = raider(t, { MINING: 99 }, [], I().RUNE_AXE);
  assert.equal(Guardians.pickaxeFactor(none), 0);
});
