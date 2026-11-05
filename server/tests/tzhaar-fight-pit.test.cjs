// From server/: node --test tests/tzhaar-fight-pit.test.cjs (after yarn build).
//
// The TzHaar Fight Pit's champion (Wiki: TzHaar_Fight_Pit): the last one standing takes Tokkul
// worth the beaten fighters' combat levels and the red skull for an hour, which goes on a
// teleport of any kind, a change of weapons or armour after leaving the Fight Pits, an overhead
// prayer, logging out, or monster damage.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { PrayerData } = require('../dist/game/content/PrayerHandler');
const core = PluginManager.getCoreApi();
const FightPits = require('../plugins/minigames/TzhaarFightPits.plugin');
const T = FightPits._test;

before(() => {
  const api = new Proxy({ core }, { get: (target, key) => target[key] ?? (() => {}) });
  FightPits.register(api);
});

const ARENA_TILE = [2399, 5150];
const OUTSIDE_PITS = [2440, 5170];

function fighter(name, at = ARENA_TILE) {
  let tile = new core.Location(at[0], at[1], 0);
  const attributes = new Map();
  const player = {
    tokkul: 0, skullTicks: null, skullIcon: null,
    getUsername: () => name, getDisplayName: () => name,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    isRegistered: () => true,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    getHitpoints: () => 99,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    getSkillManager: () => ({ getCombatLevel: () => 100 }),
    getInventory: () => ({ adds: (id, amount) => { if (id === core.ItemIdentifiers.TOKKUL) player.tokkul += amount; } }),
    setSkullTimer: (ticks) => { player.skullTicks = ticks; },
    setSkullIconOverride: (icon) => { player.skullIcon = icon; },
  };
  return player;
}

/** A fresh champion, crowned by the game's end. */
function champion(at = ARENA_TILE) {
  const winner = fighter('champ', at);
  T.endGame(winner);
  assert.equal(T.isChampion(winner), true);
  return winner;
}

const skulled = (player) => T.isChampion(player) && player.skullIcon !== null;

test('the last one standing is champion: the red skull for an hour', () => {
  const winner = champion();
  assert.equal(winner.skullTicks, 6000, 'one hour');
  assert.equal(winner.skullIcon, 1);
});

test('a teleport of any kind takes the skull', () => {
  const winner = champion();
  T.championTeleports({ player: winner, allow: null });
  assert.equal(skulled(winner), false);
  assert.equal(winner.skullTicks, 0);
});

test('changing weapons or armour takes it only after leaving the pits; ammunition does not', () => {
  const inPits = champion();
  T.championChangesGear({ player: inPits, slot: core.Equipment.WEAPON_SLOT });
  assert.equal(skulled(inPits), true, 'still in the pits');
  const outside = champion(OUTSIDE_PITS);
  T.championChangesGear({ player: outside, slot: core.Equipment.AMMUNITION_SLOT });
  assert.equal(skulled(outside), true, 'ammunition is not weapons or armour');
  T.championChangesGear({ player: outside, slot: core.Equipment.BODY_SLOT });
  assert.equal(skulled(outside), false);
});

test('an overhead prayer takes it; other prayers do not', () => {
  const winner = champion();
  T.championPrays({ player: winner, prayer: PrayerData.PIETY });
  assert.equal(skulled(winner), true, 'Piety has no head icon');
  T.championPrays({ player: winner, prayer: PrayerData.PROTECT_FROM_MELEE });
  assert.equal(skulled(winner), false);
  const smite = champion();
  T.championPrays({ player: smite, prayer: PrayerData.SMITE });
  assert.equal(skulled(smite), false);
});

test('monster damage takes it; another player\'s hit does not', () => {
  const winner = champion();
  T.championHitByMonster({ attacker: fighter('rival'), target: winner, hit: {} });
  assert.equal(skulled(winner), true);
  T.championHitByMonster({ attacker: { isNpc: () => true }, target: winner, hit: {} });
  assert.equal(skulled(winner), false);
});

test('a player who is not the champion is left alone', () => {
  const other = fighter('nobody');
  T.championTeleports({ player: other, allow: null });
  T.championPrays({ player: other, prayer: PrayerData.PROTECT_FROM_MAGIC });
  assert.equal(other.skullTicks, null, 'never touched');
});

test('TzHaar-Mej-Kah toggles combat experience inside the arena', () => {
  const NPC = core.NpcIdentifiers.TZHAAR_MEJ_KAH;
  const enabled = 'If Fight Pit experience gain is curently enabled:';
  const disabled = 'If Fight Pit experience gain is currently disabled:';
  const player = fighter('toggle');
  assert.equal(T.fightPitXpEnabled({ player, npcId: NPC, text: enabled }), true);
  assert.equal(T.fightPitXpEnabled({ player, npcId: NPC, text: disabled }), false);

  T.noteXpPrompt({ player, npcId: NPC, prompt: 'Disable XP gains?' });
  T.chooseXpToggle({ player, npcId: NPC, option: 'Yes.' });
  assert.equal(player.getAttribute(T.XP_DISABLED_ATTRIBUTE), true);
  assert.equal(T.fightPitXpEnabled({ player, npcId: NPC, text: disabled }), true);

  const inside = { player, skill: core.Skill.ATTACK, experience: 100, allow: null };
  T.blockFightPitXp(inside);
  assert.equal(inside.allow, false);
  const nonCombat = { player, skill: core.Skill.COOKING, experience: 100, allow: null };
  T.blockFightPitXp(nonCombat);
  assert.equal(nonCombat.allow, null);

  T.noteXpPrompt({ player, npcId: NPC, prompt: 'Enable XP gains?' });
  T.chooseXpToggle({ player, npcId: NPC, option: 'Yes.' });
  assert.equal(player.getAttribute(T.XP_DISABLED_ATTRIBUTE), false);
  const outside = { player: fighter('outside', OUTSIDE_PITS), skill: core.Skill.ATTACK, experience: 100, allow: null };
  player.setAttribute(T.XP_DISABLED_ATTRIBUTE, true);
  T.blockFightPitXp(outside);
  assert.equal(outside.allow, null, 'nothing is blocked outside the arena');
});
