"use strict";

const { CacheDefinitions, CombatType, HitDamage, HitMask, PluginManager, Skill } = require("./Core.Construction");
const House = require("./House.Construction");
const Prizes = require("./Prizes.Construction");

// Attack stones (rsprox captures, Wiki): Set-up ("You activate the stone.", "The stone is already
// set up.", "You cannot set up an attack stone while in building mode.") puts out the combat stone
// (poh_tbt_<stone>_000), which players Hit and which never fights back. Its three digits crack
// with the crush, stab and slash damage it has taken (an elder maul hit of 32 on clay shows _300),
// and at no hitpoints "You shatter the stone!" leaves poh_tbt_<stone>_destroyed. Now and then
// "Fragments of stone hit you in the face!" for 1-2 damage. Hits give 2.5% of their damage as
// experience in the attack style's skills and none in Hitpoints (Wiki); whoever dealt the most
// damage wins. How often fragments fly is this server's.
// poh_tbt_<stone>_<crush><stab><slash>: the 64 crack forms and the broken one, by gameval name.
const FORMS = Object.fromEntries(["clay", "limestone", "marble"].map((stone) => {
  const forms = { destroyed: CacheDefinitions.getNpcId(`poh_tbt_${stone}_destroyed`) };
  for (let crack = 0; crack < 64; crack++) {
    const digits = [crack >> 4, (crack >> 2) & 3, crack & 3].join("");
    forms[digits] = CacheDefinitions.getNpcId(`poh_tbt_${stone}_${digits}`);
  }
  return [stone, forms];
}));
const STONES = { CLAY_ATTACK_STONE: "clay", LIMESTONE_ATTACK_STONE: "limestone", MARBLE_ATTACK_STONE: "marble" };
const XP_SHARE = 0.025;
const CHIP_CHANCE = 1 / 10;
const CHIP_DAMAGE = 2;
const CRUSH = 0, STAB = 1, SLASH = 2;
const BONUS_TO_DIGIT = { 0: STAB, 1: SLASH, 2: CRUSH };

/** house -> { npc, forms, furniture, damage: Map(player -> damage), styles: [crush, stab, slash] } */
const stones = new WeakMap();
/** npc -> house */
const houseOfStone = new WeakMap();
function setUp(event) {
  const player = event.player;
  const house = House.houseFor(player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const forms = furniture && FORMS[STONES[furniture.buildableKey]];
  if (!forms) return false;
  if (house.buildingMode) return player.sendMessage("You cannot set up an attack stone while in building mode."), true;
  if (stones.has(house)) return player.sendMessage("The stone is already set up."), true;
  Prizes.offer(player, house, "stone", () => {
    if (stones.has(house) || House.houseFor(player) !== house || house.buildingMode) return;
    const { x, y, z } = event.location;
    const npc = PluginManager.spawnNpc({ id: forms["000"], x, y, z, wanderRadius: 0 });
    if (!npc) return;
    npc.__skipDefaultRespawn = true;
    npc.setFlag?.("combat:no-retaliate", true);
    house.enter(npc);
    house.hideFurniture(furniture);
    stones.set(house, { npc, forms, furniture, damage: new Map(), owed: new Map(), styles: [0, 0, 0] });
    houseOfStone.set(npc, house);
    player.sendMessage("You activate the stone.");
  });
  return true;
}

function hit(event) {
  if (!houseOfStone.has(event.npc)) return false;
  event.player.getCombat().attack(event.npc);
  return true;
}

/** onCombatHitDamage: no usual combat experience off the stone. */
function noUsualExperience(event) {
  if (houseOfStone.has(event.target) && event.attacker?.isPlayer?.()) event.hit.experience = false;
}

/** onCombatHitResolved: tally the damage, give the stone's experience, crack it, throw fragments. */
function stoneHit({ attacker, target, hit }) {
  const house = houseOfStone.get(target);
  const stone = house && stones.get(house);
  if (!stone || stone.npc !== target || !attacker?.isPlayer?.()) return;
  const player = attacker.getAsPlayer();
  const damage = hit.getTotalDamage();
  stone.damage.set(player, (stone.damage.get(player) ?? 0) + damage);
  giveExperience(stone, player, hit.getSkills(), damage * XP_SHARE);
  // The hit queue applies the damage after this hook.
  if (target.getHitpoints() - damage <= 0) {
    target.setNpcTransformationId(stone.forms.destroyed);
    player.sendMessage("You shatter the stone!");
    return;
  }
  const melee = hit.getCombatType?.() === CombatType.MELEE;
  const digit = melee ? (BONUS_TO_DIGIT[player.getFightType().getBonusType()] ?? CRUSH) : STAB;
  stone.styles[digit] += damage;
  const max = target.getDefinition().getHitpoints();
  const digits = stone.styles.map(dealt => Math.min(3, Math.floor((4 * dealt) / max)));
  const id = stone.forms[digits.join("")];
  if (id) target.setNpcTransformationId(id === stone.forms["000"] ? -1 : id);
  if (damage > 0 && Math.random() < CHIP_CHANCE) {
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(1 + Math.floor(Math.random() * CHIP_DAMAGE), HitMask.RED)]);
    player.sendMessage("Fragments of stone hit you in the face!");
  }
}

/** A few points of damage earn a fraction of a point, so the remainder carries to the next hit. */
function giveExperience(stone, player, indexes, experience) {
  const owed = stone.owed.get(player) ?? new Map();
  stone.owed.set(player, owed);
  for (const index of indexes) {
    const total = (owed.get(index) ?? 0) + experience / indexes.length;
    const whole = Math.floor(total);
    owed.set(index, total - whole);
    if (whole > 0) player.getSkillManager().addExperiences(Skill.values()[index], whole);
  }
}

function stoneBroke({ npc }) {
  const house = houseOfStone.get(npc);
  const stone = house && stones.get(house);
  if (!stone || stone.npc !== npc) return;
  const ranked = [...stone.damage].sort((a, b) => b[1] - a[1]);
  const winner = ranked[0] && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
  if (winner && stone.damage.size > 1) {
    for (const occupant of house.getPlayers()) occupant.sendMessage(`${winner.getDisplayName()} dealt the most damage to the stone!`);
  }
  Prizes.award(house, "stone", winner);
  finish(house, stone);
}

function finish(house, stone) {
  stones.delete(house);
  houseOfStone.delete(stone.npc);
  Prizes.withdraw(house, "stone");
  if (stone.npc.isRegistered()) {
    house.leave(stone.npc, false);
    PluginManager.removeNpc(stone.npc);
  }
  house.showFurniture(stone.furniture);
}

/** Instance.rebuild in building mode: the stone is put away. */
function resetStone(house) {
  const stone = stones.get(house);
  if (stone && house.buildingMode) finish(house, stone);
}

function attachAttackStone(api) {
  api.onObjectInteraction("Attack stone", { "Set-up": setUp });
  api.onNpcInteraction("Combat stone", { Hit: hit });
  api.onCombatHitDamage(noUsualExperience);
  api.onCombatHitResolved(stoneHit);
  api.onNpcDeath(stoneBroke);
}

Object.assign(module.exports, { attachAttackStone, resetStone });
