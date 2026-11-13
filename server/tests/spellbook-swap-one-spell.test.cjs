// Run after `yarn build`: node --test tests/spellbook-swap-one-spell.test.cjs
// Spellbook Swap gives one spell from the other book, then the Lunar book back (Wiki). High Alchemy (and Telekinetic
// Grab) pay their runes outside Spell.canCast, and a cast whose runes a weapon saves skipped the revert, so either kept
// the swapped book for the full two minutes. Real engine: every plugin loaded, a real Player, High Alchemy through a
// widget_target packet on ClientConnection.dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const HOME = [3222, 3218];
let core, LunarSpells, Spell;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  ({ LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells"));
  ({ Spell } = require("../dist/game/content/combat/magic/Spell"));
});
after(() => PM.emitServerShutdown({}));

let next = 9920;
function swapper(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("swapper" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  const quests = require("../plugins/quests/QuestRuntime").getRegisteredQuests();
  for (const key of ["lunar_diplomacy", "dream_mentor"]) { const q = quests.find((quest) => quest.key === key); q.setStage(p, q.completionValue); }
  p.setSpellbook(core.MagicSpellbook.LUNAR);
  const I = core.ItemIdentifiers;
  for (const [id, n] of [[I.ASTRAL_RUNE, 10], [I.COSMIC_RUNE, 10], [I.LAW_RUNE, 10], [I.NATURE_RUNE, 10], [I.FIRE_RUNE, 50], [I.AIR_RUNE, 10], [I.MIND_RUNE, 10]]) p.getInventory().add(new core.Item(id, n), false);
  const c = new ClientConnection(channel);
  c.player = p;
  return { p, c };
}

test("Spellbook Swap ends Magic Imbue's effect but not its 21-tick cooldown (#1942 review)", (t) => {
  const f = swapper(t);
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.WATER_RUNE, 20), false);
  let cycle = 5000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const astral = () => f.p.getInventory().getAmount(core.ItemIdentifiers.ASTRAL_RUNE);
  const messages = [];
  t.mock.method(f.p, "sendMessage", (text) => messages.push(text));
  LunarSpells.handleSelf(f.p, "magic imbue");
  assert.equal(f.p.getAttribute("lunar:magic-imbue-until"), 5021, "imbued");
  cycle += 2;
  LunarSpells.handleSelf(f.p, "spellbook swap", 2);
  assert.equal(f.p.getAttribute("lunar:magic-imbue-until"), null, "the swap ends the effect");
  f.p.setSpellbook(core.MagicSpellbook.LUNAR); // as if the swap's one spell was used
  cycle += 2;
  const before = astral();
  LunarSpells.handleSelf(f.p, "magic imbue");
  assert.equal(messages.at(-1), "You can't use that spell yet.", "still on cooldown");
  assert.equal(astral(), before, "nothing spent");
  cycle = 5021;
  LunarSpells.handleSelf(f.p, "magic imbue");
  assert.equal(f.p.getAttribute("lunar:magic-imbue-until"), 5042, "castable again 21 ticks after the first cast");
});

test("High Alchemy is the swap's one spell: the Lunar book comes straight back", async (t) => {
  const f = swapper(t);
  LunarSpells.handleSelf(f.p, "spellbook swap", 2);
  assert.equal(f.p.getSpellbook(), core.MagicSpellbook.NORMAL, "swapped to the standard book");
  const platelegs = core.ItemIdentifiers.RUNE_PLATELEGS;
  f.p.getInventory().setItem(20, new core.Item(platelegs, 1));
  const spell = core.CacheDefinitions.getSpellByName("High Level Alchemy");
  const coins = f.p.getInventory().getAmount(core.ItemIdentifiers.COINS);
  await f.c.dispatch([{ type: "widget_target", sourceWidgetId: spell.widgetId, sourceItemId: spell.itemId ?? -1, sourceSlot: -1,
    targetWidgetId: (149 << 16) | 0, targetSlot: 20, targetItemId: platelegs }]);
  f.c.processTurnPackets();
  assert.ok(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS) > coins, "the alchemy was cast");
  assert.equal(f.p.getSpellbook(), core.MagicSpellbook.LUNAR, "the swap ends after the one spell");
});

test("a cast whose runes a weapon saves still ends the swap", (t) => {
  const f = swapper(t);
  LunarSpells.handleSelf(f.p, "spellbook swap", 2);
  assert.equal(f.p.getSpellbook(), core.MagicSpellbook.NORMAL);
  const saving = PM.createApi("SwapRuneSavingTest");
  let save = true;
  saving.onCustomEvent("magic:rune-saving", (request) => { if (save) request.saved = true; });
  t.after(() => { save = false; });
  const strike = core.CombatSpells.WIND_STRIKE.getSpell();
  assert.equal(strike.canCast(f.p, true), true);
  assert.equal(f.p.getSpellbook(), core.MagicSpellbook.LUNAR, "a saved cast is still the one spell");
});

test("a save taken during the swap keeps the Lunar book, not the swapped one", (t) => {
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const f = swapper(t);
  LunarSpells.handleSelf(f.p, "spellbook swap", 2);
  assert.equal(f.p.getSpellbook(), core.MagicSpellbook.NORMAL, "swapped to the standard book");
  const strike = core.CombatSpells.WIND_STRIKE.getSpell();
  f.p.getCombat().setAutocastSpell(strike);
  const save = PlayerSave.fromPlayer(f.p);
  assert.equal(save.getSpellBook(), core.MagicSpellbook.LUNAR, "logging out mid-swap returns to Lunar");
  assert.equal(f.p.getSpellbook(), core.MagicSpellbook.NORMAL, "the live swap is untouched until it ends");
  assert.equal(f.p.getCombat().getAutocastSpell(), strike);
  const back = swapper(t).p;
  back.setSpellbook(core.MagicSpellbook.NORMAL);
  save.applyToPlayer(back);
  assert.equal(back.getSpellbook(), core.MagicSpellbook.LUNAR, "the reloaded character is on Lunar");
  assert.equal(back.getCombat().getAutocastSpell(), null, "no standard autocast left on the Lunar book");
  LunarSpells.handleSelf(f.p, "spellbook swap", 2);
  Spell.endSpellbookSwap(f.p);
  f.p.setSpellbook(core.MagicSpellbook.NORMAL);
  assert.equal(PlayerSave.fromPlayer(f.p).getSpellBook(), core.MagicSpellbook.NORMAL, "with no swap the live book is saved");
});
