/**
 * Frostweaver, the Blue Moon set effect (OSRS Wiki: Blue Moon armour, "Set effects"): wearing the full
 * Blue Moon armour (broken pieces count) with the Blue Moon spear, a cast of Bind, Snare, Entangle or an
 * Ancient ice spell has a 20% chance, and an Arceuus grasp a 50% chance, to make one instant melee attack
 * with the spear, whether or not the spell bound anything. The Wiki gives no accuracy or damage change,
 * so the attack is an ordinary melee hit (a special armed on the spear is neither used nor spent).
 * The spear must reach the target as in melee, diagonals included (the Wiki: it "can hit targets across
 * diagonal spaces"), so a cast from range gives no attack. Not implemented: hitting over small fences or walls,
 * The combat tab's "Toggle set effect" button (cache widget 593 child 37, CS2 4907 reads varbit 9870: 1 = "Set
 * Effect (On)", else "(Off)") switches it; the varbit starts at 0, so the effect starts off (the Wiki: "by enabling
 * it in the combat options menu"). The button is shared by the Moons sets in the client; only Frostweaver reads it here.
 */
const CHANCE = { standard: 0.2, grasp: 0.5 };
const ENABLED = "frostweaver:enabled";
const TOGGLE_VARBIT = 9870;
const TOGGLE_BUTTON = (593 << 16) | 37;
let core;
let pieces;
let spears;
let spellChance;

function initialize(api) {
  core = api.core;
  const I = core.ItemIdentifiers;
  const E = core.Equipment;
  pieces = [
    [E.HEAD_SLOT, [I.BLUE_MOON_HELM, I.BLUE_MOON_HELM_4, I.BLUE_MOON_HELM_BROKEN_, I.BLUE_MOON_HELM_6]],
    [E.BODY_SLOT, [I.BLUE_MOON_CHESTPLATE, I.BLUE_MOON_CHESTPLATE_4, I.BLUE_MOON_CHESTPLATE_BROKEN_, I.BLUE_MOON_CHESTPLATE_6]],
    [E.LEG_SLOT, [I.BLUE_MOON_TASSETS, I.BLUE_MOON_TASSETS_4, I.BLUE_MOON_TASSETS_BROKEN_, I.BLUE_MOON_TASSETS_6]],
  ];
  // The two spears with equipment data, as BlueMoonSpear.SpecialAttack.js lists them.
  spears = new Set([I.BLUE_MOON_SPEAR, I.BLUE_MOON_SPEAR_4]);
  spellChance = new Map();
  const S = core.CombatSpells;
  for (const name of ["BIND", "SNARE", "ENTANGLE", "ICE_RUSH", "ICE_BURST", "ICE_BLITZ", "ICE_BARRAGE"]) spellChance.set(S[name].spellId(), CHANCE.standard);
  for (const name of ["GHOSTLY_GRASP", "SKELETAL_GRASP", "UNDEAD_GRASP"]) spellChance.set(S[name].spellId(), CHANCE.grasp);
}

function wearsSet(player) {
  const items = player.getEquipment().getItems();
  if (!spears.has(items[core.Equipment.WEAPON_SLOT]?.getId())) return false;
  return pieces.every(([slot, ids]) => ids.includes(items[slot]?.getId()));
}

/** Within melee reach: the footprints touch (diagonals count) on the same floor. */
function inReach(player, target) {
  return player.getLocation().getZ() === target.getLocation().getZ() && core.CombatRange.beside(player, target);
}

function toggle(event) {
  const player = event.player;
  const on = player.getAttribute(ENABLED) !== true;
  player.setAttribute(ENABLED, on);
  player.getPacketSender().sendVarbit(TOGGLE_VARBIT, on ? 1 : 0);
  return true;
}

function login({ player }) {
  if (player.getAttribute(ENABLED) === true) player.getPacketSender().sendVarbit(TOGGLE_VARBIT, 1);
}

function committed({ player, spell }) {
  if (player.getAttribute(ENABLED) !== true) return;
  const chance = spellChance.get(spell.spellId());
  if (chance === undefined || !wearsSet(player)) return;
  const target = player.getCombat().getTarget();
  if (!target || !target.isRegistered() || target.getHitpoints() <= 0) return;
  if (!inReach(player, target)) return;
  if (Math.random() >= chance) return;
  // An ordinary melee swing: a special armed since the cast neither shapes it nor is spent on it.
  const armed = player.isSpecialActivated();
  if (armed) player.setSpecialActivated(false);
  try {
    core.CombatFactory.addPendingHit(new core.PendingHit(player, target, core.CombatFactory.MELEE_COMBAT, { delay: 0 }));
  } finally {
    if (armed) player.setSpecialActivated(true);
  }
}

module.exports = {
  name: "Frostweaver",
  description: "Blue Moon set effect: binding and ice casts sometimes add an instant spear attack.",
  register(api) {
    initialize(api);
    api.persistAttribute(ENABLED, false);
    api.onInterfaceActionButton(TOGGLE_BUTTON, toggle);
    api.onPlayerLogin(login);
    api.onCustomEvent("magic:cast-committed", committed);
  },
};
