// Run after `yarn build`: node --test tests/charge-spell.test.cjs
//
// The Charge spell (level 80 Magic, 3 fire, 3 blood, 3 air, 180 XP; Wiki: Charge). Wiki rules tested here:
// it "can only be cast once every 60 seconds" (infobox cooldown 100 ticks), lasts 700 ticks, and
// "Your magical charge fades away" appears when it expires; members only. The wording of the cast message
// ("You feel charged with magic power") is the Wiki's. Evidence limits: NO live capture of the cast, the
// fade or a refused cast was found. The RSProx text hits for "feel charged" (856, 3457; 3461 not decoded)
// are the Wilderness slayer cave key's own message, and searches for the Charge wording find nothing.
// So the refusal is silent (no wording is known), no animation or graphic is added, the red text colour
// (Wiki, 2013) is not applied, the god staff claim gate is not built (the repo records no claim), and a
// recast restarting the 700 ticks is inferred.
// Real engine: every plugin loaded, a real Player and Inventory, the entry point the spell packet uses
// (CombatSpells.handleSelf), the real TaskManager for the fade.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { World } = require("../dist/game/World");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const { Skill } = require("../dist/game/model/Skill");

const FIRE = 554;
const AIR = 556;
const BLOOD = 565;
const CAST_MESSAGE = "You feel charged with magic power.";
const FADE_MESSAGE = "Your magical charge fades away";
const COOLDOWN_TICKS = 100;
const CHARGE_TICKS = 700;
const SARADOMIN_STRIKE = 1190;
let core;
let next = 8100;
const clock = { cycle: 100000 };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
});

function caster(t, runes = 2) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("charge" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3100, 3100, 0));
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevel(Skill.MAGIC, 99).setCurrentLevel(Skill.MAGIC, 99, false);
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  t.mock.method(World, "getProcessCycle", () => clock.cycle);
  if (runes > 0) for (const id of [FIRE, BLOOD, AIR]) player.getInventory().add(new core.Item(id, 3 * runes), false);
  return { player, messages };
}

const amount = (player, id) => player.getInventory().getAmount(id);
const xp = (player) => player.getSkillManager().getExperience(Skill.MAGIC);
const cast = (player) => CombatSpells.handleSelf(player, "Charge");
const logout = (player) => PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
const count = (messages, text) => messages.filter((message) => message === text).length;

/** Game ticks: the clock the spell reads and the real TaskManager. */
function tick(n) {
  for (let i = 0; i < n; i++) {
    clock.cycle++;
    TaskManager.process();
  }
}

test("a cast pays 180 XP once, takes 3 of each rune and says the Wiki's message", (t) => {
  const { player, messages } = caster(t);
  const before = xp(player);
  assert.equal(cast(player), true);
  assert.ok(xp(player) > before, "Magic XP is paid");
  assert.equal(amount(player, FIRE), 3);
  assert.equal(amount(player, BLOOD), 3);
  assert.equal(amount(player, AIR), 3);
  assert.equal(count(messages, CAST_MESSAGE), 1);
  assert.equal(player.getAttribute(CombatSpells.CHARGE_UNTIL), clock.cycle + CHARGE_TICKS);
  logout(player);
});

test("recasting in the same tick is refused: no XP, no runes, no message", (t) => {
  const { player, messages } = caster(t);
  cast(player);
  const gained = xp(player);
  assert.equal(cast(player), true, "the cast is handled");
  assert.equal(xp(player), gained, "no second XP payment");
  assert.equal(amount(player, FIRE), 3, "no second set of runes taken");
  assert.equal(amount(player, BLOOD), 3);
  assert.equal(amount(player, AIR), 3);
  assert.equal(count(messages, CAST_MESSAGE), 1, "and no second 'charged' message");
  logout(player);
});

test("the 60 second (100 tick) cooldown: refused at 99 ticks, allowed at 100", (t) => {
  const { player, messages } = caster(t, 3);
  cast(player);
  const gained = xp(player);
  tick(COOLDOWN_TICKS - 1);
  cast(player);
  assert.equal(xp(player), gained, "still cooling down after 99 ticks");
  assert.equal(amount(player, FIRE), 6, "and nothing was taken");
  tick(1);
  cast(player);
  assert.ok(xp(player) > gained, "allowed after 100 ticks");
  assert.equal(amount(player, FIRE), 3);
  assert.equal(count(messages, CAST_MESSAGE), 2);
  logout(player);
});

test("a refused cast keeps the charge it already has", (t) => {
  const { player } = caster(t);
  cast(player);
  const until = player.getAttribute(CombatSpells.CHARGE_UNTIL);
  tick(5);
  cast(player);
  assert.equal(player.getAttribute(CombatSpells.CHARGE_UNTIL), until, "the refused recast does not move the expiry");
  logout(player);
});

test("the charge fades after 700 ticks with the Wiki's message, once", (t) => {
  const { player, messages } = caster(t);
  cast(player);
  tick(CHARGE_TICKS - 1);
  assert.equal(count(messages, FADE_MESSAGE), 0, "not before the 700th tick");
  tick(1);
  assert.equal(count(messages, FADE_MESSAGE), 1);
  tick(200);
  assert.equal(count(messages, FADE_MESSAGE), 1, "only once");
  logout(player);
});

test("a recast after the cooldown restarts the 700 ticks and fades once, at the new expiry", (t) => {
  const { player, messages } = caster(t, 3);
  cast(player);
  tick(COOLDOWN_TICKS);
  cast(player);
  tick(CHARGE_TICKS - COOLDOWN_TICKS);
  assert.equal(count(messages, FADE_MESSAGE), 0, "the first charge's expiry passed with no message: it was renewed");
  tick(COOLDOWN_TICKS);
  assert.equal(count(messages, FADE_MESSAGE), 1);
  tick(CHARGE_TICKS);
  assert.equal(count(messages, FADE_MESSAGE), 1);
  logout(player);
});

test("ordinary travel cancelling the player's tasks does not stop the fade message", (t) => {
  const { player, messages } = caster(t);
  cast(player);
  tick(10);
  TaskManager.cancelTasks(player);
  tick(CHARGE_TICKS);
  assert.equal(count(messages, FADE_MESSAGE), 1);
  logout(player);
});

test("logging out cancels the fade: nothing is sent to a player who has gone", (t) => {
  const { player, messages } = caster(t);
  cast(player);
  logout(player);
  tick(CHARGE_TICKS + 5);
  assert.equal(count(messages, FADE_MESSAGE), 0);
});

test("the god cape's 30 max hit holds while charged and ends with the charge", (t) => {
  const { player } = caster(t);
  const capes = core.ItemIdentifiers;
  player.getEquipment().set(core.Equipment.CAPE_SLOT, new core.Item(capes.SARADOMIN_CAPE, 1));
  const spell = { spellId: () => SARADOMIN_STRIKE };
  assert.equal(CombatSpells.applyChargeMaxHit(player, 20, spell), 20, "no charge yet");
  cast(player);
  assert.equal(CombatSpells.applyChargeMaxHit(player, 20, spell), 30, "charged and caped");
  tick(CHARGE_TICKS);
  assert.equal(CombatSpells.applyChargeMaxHit(player, 20, spell), 20, "after the fade");
  logout(player);
});

test("a cast without the runes or the level is refused and costs nothing", (t) => {
  const { player, messages } = caster(t, 0);
  assert.equal(cast(player), true);
  assert.equal(xp(player), 0, "no XP without runes");
  assert.equal(count(messages, CAST_MESSAGE), 0);
  player.getInventory().add(new core.Item(FIRE, 3), false);
  player.getInventory().add(new core.Item(BLOOD, 3), false);
  player.getInventory().add(new core.Item(AIR, 3), false);
  player.getSkillManager().setCurrentLevel(Skill.MAGIC, 79, false);
  cast(player);
  assert.equal(amount(player, FIRE), 3, "level 79 takes nothing");
  assert.equal(count(messages, CAST_MESSAGE), 0);
  logout(player);
});

test("Charge is a members' spell: a free world refuses it and takes no runes", (t) => {
  assert.equal(CombatSpells.CHARGE.isMembers(), true, "the spell is marked members-only");
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => false);
  require("../plugins/modes/FreeToPlay.plugin").register(PluginManager.createApi("ChargeFreeWorldTest"));
  const { player, messages } = caster(t);
  assert.equal(player.getSpellbook(), MagicSpellbook.NORMAL);
  assert.equal(cast(player), true);
  assert.equal(xp(player), 0);
  assert.equal(amount(player, FIRE), 6, "no runes taken");
  assert.ok(messages.includes("You need to be on a members' world to cast this spell."));
  assert.equal(count(messages, CAST_MESSAGE), 0);
  logout(player);
});
