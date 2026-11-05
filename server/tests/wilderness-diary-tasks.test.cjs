// Run after `yarn build`: node --test tests/wilderness-diary-tasks.test.cjs
//
// Wilderness Diary tasks whose activity the server has and whose credit was missing (OSRS Wiki:
// Wilderness Diary; audit of #2430): a Bloodveld (medium), Spiritual warrior (hard) and Spiritual mage
// (elite) killed in the Wilderness God Wars Dungeon, the Trollheim agility shortcut into the Wilderness
// (hard), a god spell that hits another player in the Wilderness (hard), and talking to the Edgeville Emblem
// Trader about emblems (medium).
// Real engine: every plugin loaded, real Players and NPCs, the real diary progress ("diary:task" ->
// Progress.completeTask), the events the producers emit (npc death, combat hit resolved with a real
// PendingHit, agility obstacle, the transcript runner's first line, the Ent trunk's own chop loop). Evidence limits: no capture of the diary notification or of the
// Emblem Trader task was searched for; where the credit fires for him is the Wiki's "talk to the Emblem
// Trader ... about emblems" and is inferred (the conversation's own emblems line).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
// The bots keep the process alive after the tests, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { MagicCombatMethod } = require("../dist/game/content/combat/method/impl/MagicCombatMethod");
const { MeleeCombatMethod } = require("../dist/game/content/combat/method/impl/MeleeCombatMethod");
const { TaskManager } = require("../dist/game/task/TaskManager");
const EntTrunk = require("../plugins/skills/woodcutting/EntTrunk.Woodcutting");

const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const { SHORTCUTS } = require("../plugins/skills/agility/shortcuts/Shortcuts.Agility");
const SPAWNS = require("../data/definitions/npc-spawns.json");

const EDGEVILLE_EMBLEM_TRADER = 308;
const TROLLHEIM_SHORTCUT = "Rocks (Wilderness, Trollheim)";
const DIARY = Diaries.BY_KEY.get("wilderness");
let core;
let next = 9100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
});

function actor(t, x = 3000, y = 3600) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("wildtask" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  player.messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => { player.messages.push(message); return player.getPacketSender(); });
  return player;
}

const credited = (player, task) => DiaryProgress.doneTasks(player, DIARY).has(task);

const inDungeon = (row) => row.x >= 3010 && row.x <= 3065 && row.y >= 10110 && row.y <= 10170;
const spawn = (name, wanted) => {
  const row = SPAWNS.find((entry) => entry.name === name && inDungeon(entry) === wanted && entry.level === 0);
  assert.ok(row, `a ${name} spawn ${wanted ? "in" : "outside"} the Wilderness God Wars Dungeon`);
  return row;
};

function kill(killer, id, x, y) {
  const npc = core.NPC.create(id, new core.Location(x, y, 0));
  PluginManager.emitNpcDeath({ killer, npc, npcId: id, location: { x, y, z: 0 } });
}

for (const [name, task] of [
  ["Bloodveld", "kill-a-bloodveld-in-the-wilderness-godwars-dunge"],
  ["Spiritual warrior", "kill-a-spiritual-warrior-in-the-wilderness-godwa"],
  ["Spiritual mage", "slay-a-spiritual-mage-inside-the-wilderness-godw"],
]) {
  test(`${name}: killed in the Wilderness God Wars Dungeon it counts`, (t) => {
    const player = actor(t);
    const row = spawn(name, true);
    assert.equal(credited(player, task), false, "not yet");
    kill(player, row.id, row.x, row.y);
    assert.equal(credited(player, task), true);
  });

  test(`${name}: the same NPC in the main God Wars Dungeon, or elsewhere in the Wilderness, does not count`, (t) => {
    const player = actor(t);
    const row = spawn(name, false);
    kill(player, row.id, row.x, row.y);
    assert.equal(credited(player, task), false, "the main dungeon");
    const dungeon = spawn(name, true);
    kill(player, dungeon.id, 3340, 10130);
    assert.equal(credited(player, task), false, "the Wilderness Slayer Cave");
    kill(player, dungeon.id, 3000, 3600);
    assert.equal(credited(player, task), false, "the surface Wilderness");
  });

  test(`${name}: someone else's NPC kill, or a kill with no player, does not count`, (t) => {
    const player = actor(t);
    const row = spawn(name, true);
    const other = actor(t);
    kill(other, row.id, row.x, row.y);
    assert.equal(credited(player, task), false);
    // No killer at all, as a death with no player behind it: an NPC passed as the killer is taken for a player by the drops.
    kill(null, row.id, row.x, row.y);
    assert.equal(credited(player, task), false);
  });
}

test("the Trollheim shortcut into the Wilderness counts when it succeeds; the neighbouring shortcuts do not", (t) => {
  const entry = SHORTCUTS.find((shortcut) => shortcut.name === TROLLHEIM_SHORTCUT);
  assert.ok(entry, "the shortcut exists under that name");
  const task = "take-the-agility-shortcut-from-trollheim-into-th";
  const player = actor(t, 2947, 3677);
  const crossed = (name) => PluginManager.emitCustomEvent("agility:obstacle", {
    player, objectId: 16545, location: { x: 2947, y: 3678, z: 0 }, shortcut: name,
  });
  crossed("Rocks (God Wars Dungeon path)");
  crossed("Rocks (God Wars Dungeon path, from above)");
  crossed(null);
  assert.equal(credited(player, task), false, "other rocks, a course obstacle");
  crossed(TROLLHEIM_SHORTCUT);
  assert.equal(credited(player, task), true);
});

const GOD_TASK = "cast-one-of-the-3-god-spells-against-another-pla";

/** A real PendingHit (fixed damage, so its accuracy is known) from `method`, carrying `spell` if given. */
function hit(attacker, target, { method = new MagicCombatMethod(), spell = null, accurate = true } = {}) {
  const pending = new PendingHit(attacker, target, method, { statusDamage: true, damage: 3 });
  if (spell) pending.setSpell(spell);
  // A miss or splash leaves the hit inaccurate.
  pending.accurate = accurate;
  PluginManager.emitCombatHitResolved({ attacker, target, hit: pending });
}

for (const spell of ["SARADOMIN_STRIKE", "CLAWS_OF_GUTHIX", "FLAMES_OF_ZAMORAK"]) {
  test(`${spell}: a hit on another player in the Wilderness counts`, (t) => {
    const attacker = actor(t, 3000, 3600);
    const target = actor(t, 3001, 3601);
    assert.equal(credited(attacker, GOD_TASK), false, "not yet");
    hit(attacker, target, { spell: CombatSpells[spell] });
    assert.equal(credited(attacker, GOD_TASK), true);
  });
}

test("a god spell that splashes, an ordinary spell, an NPC target and the target's credit do not count", (t) => {
  const attacker = actor(t, 3000, 3600);
  const target = actor(t, 3001, 3601);
  hit(attacker, target, { spell: CombatSpells.SARADOMIN_STRIKE, accurate: false });
  assert.equal(credited(attacker, GOD_TASK), false, "a splash is not a hit");
  hit(attacker, core.NPC.create(1610, new core.Location(3001, 3601, 0)), { spell: CombatSpells.SARADOMIN_STRIKE });
  assert.equal(credited(attacker, GOD_TASK), false, "an NPC");
  hit(attacker, target, { spell: CombatSpells.WIND_STRIKE });
  assert.equal(credited(attacker, GOD_TASK), false, "not a god spell");
  assert.equal(credited(target, GOD_TASK), false, "and the target gains nothing");
});

test("a god spell cast earlier does not turn a later melee hit into the task", (t) => {
  const attacker = actor(t, 3000, 3600);
  const target = actor(t, 3001, 3601);
  // MagicCombatMethod.finished leaves the cast in previousCast; a whip swing after it is not a god spell.
  attacker.getCombat().setPreviousCast(CombatSpells.SARADOMIN_STRIKE);
  hit(attacker, target, { method: new MeleeCombatMethod() });
  assert.equal(credited(attacker, GOD_TASK), false, "an accurate melee hit after a god spell cast");
  attacker.getCombat().setCastSpell(CombatSpells.SARADOMIN_STRIKE);
  hit(attacker, target, { method: new MeleeCombatMethod() });
  assert.equal(credited(attacker, GOD_TASK), false, "even with the spell still selected");
});

test("the spell is the hit's own: a later cast while a god spell hit is in flight does not change it", (t) => {
  const attacker = actor(t, 3000, 3600);
  const target = actor(t, 3001, 3601);
  attacker.getCombat().setPreviousCast(CombatSpells.WIND_STRIKE);
  hit(attacker, target, { spell: CombatSpells.CLAWS_OF_GUTHIX });
  assert.equal(credited(attacker, GOD_TASK), true);
});

test("a god spell hit outside the Wilderness does not count, on either side", (t) => {
  const safe = actor(t, 3222, 3218);
  const wild = actor(t, 3000, 3600);
  const other = actor(t, 3223, 3218);
  hit(safe, other, { spell: CombatSpells.SARADOMIN_STRIKE });
  assert.equal(credited(safe, GOD_TASK), false, "both outside");
  hit(safe, wild, { spell: CombatSpells.SARADOMIN_STRIKE });
  assert.equal(credited(safe, GOD_TASK), false, "caster outside, target inside");
  hit(wild, other, { spell: CombatSpells.SARADOMIN_STRIKE });
  assert.equal(credited(wild, GOD_TASK), false, "caster inside, target outside");
});

const YEW_TASK = "chop-some-yew-logs-from-a-fallen-ent";
const WILDERNESS_ENT = 6594;
const GUILD_ENT = 7234;

/**
 * Kills an Ent next to a player who holds a rune axe at level 99 and chops its trunk until it yields
 * a Yew log or `limit` ticks pass. The log is the trunk's own weighted roll: Math.random is swept
 * through its range for that roll alone (found by the caller's name in the stack), every other roll is a
 * success (0), and bird nests are never dropped (0.999), so the roll lands on yew within a few chops.
 */
function chopEnt(t, ent, at, { wantYew = true, limit = 600 } = {}) {
  const player = actor(t, at.x, at.y + 1);
  const messages = player.messages;
  if (Math.random.mock) Math.random.mock.restore();
  player.getSkillManager().setMaxLevel(core.Skill.WOODCUTTING, 99).setCurrentLevel(core.Skill.WOODCUTTING, 99, false);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.RUNE_AXE, 1), false);
  let sweep = 0;
  t.mock.method(Math, "random", () => {
    const stack = new Error().stack;
    if (stack.includes("maybeDropBirdNest")) return 0.999;
    if (stack.includes("rollLog")) return wantYew ? ((sweep++ * 0.07) % 1) : 0;
    return 0;
  });
  const npc = core.NPC.create(ent, new core.Location(at.x, at.y, 0));
  // A spawned Ent is in the world; the trunk's tick task drops any trunk whose NPC is not registered.
  npc.setRegistered(true);
  PluginManager.emitNpcDeath({ killer: player, npc, npcId: ent, location: { x: at.x, y: at.y, z: 0 } });
  for (let i = 0; i < 5; i++) TaskManager.process();
  assert.ok(EntTrunk.trunks.has(npc), "the dead Ent became a trunk");
  EntTrunk.chopTrunk({ player, npc });
  let announced = false;
  for (let i = 0; i < limit && !announced; i++) {
    TaskManager.process();
    announced = messages.some((message) => /^The ent carcass yields: \d+ x Yew logs$/.test(message));
  }
  return { player, messages, announced };
}

test("a yew log chopped from a Wilderness Ent's trunk counts", (t) => {
  const { player, announced, messages } = chopEnt(t, WILDERNESS_ENT, { x: 3299, y: 3586 });
  assert.equal(announced, true, `a yew log came: ${messages.join(" | ")}`);
  assert.equal(credited(player, YEW_TASK), true);
});

test("other logs from a Wilderness Ent's trunk, and yew from the Woodcutting Guild's Ent, do not count", (t) => {
  const other = chopEnt(t, WILDERNESS_ENT, { x: 3299, y: 3586 }, { wantYew: false, limit: 60 });
  assert.ok(other.messages.some((message) => /^The ent carcass yields/.test(message)), "it yielded logs");
  assert.equal(other.announced, false, "none of them yew");
  assert.equal(credited(other.player, YEW_TASK), false, "not yew, not credited");
  const guild = chopEnt(t, GUILD_ENT, { x: 1548, y: 9893 });
  assert.equal(guild.announced, true, "the guild Ent gave yew");
  assert.equal(credited(guild.player, YEW_TASK), false, "but the guild is not the Wilderness");
});

test("talking to the Edgeville Emblem Trader about emblems counts; the other traders and NPCs do not", (t) => {
  const task = "talk-to-the-emblem-trader-in-edgeville-about-emb";
  const talk = (player, id, x, y) => {
    const npc = core.NPC.create(id, new core.Location(x, y, 0));
    const clickType = npc.getDefinition().getActions().indexOf("Talk-to") + 1;
    assert.ok(clickType > 0, "a Talk-to option");
    return PluginManager.emitNpcInteraction({ player, npc, npcId: id, definition: npc.getDefinition(), clickType, handled: false });
  };
  const player = actor(t, 3096, 3503);
  assert.equal(credited(player, task), false, "not yet");
  talk(player, 7943, 3196, 10224);
  assert.equal(credited(player, task), false, "the Daimon's Crater trader is not in Edgeville");
  player.getDialogueManager().reset?.();
  assert.equal(talk(player, EDGEVILLE_EMBLEM_TRADER, 3096, 3505), true);
  assert.equal(credited(player, task), true);
});
