/**
 * Charge Water, Earth, Fire and Air Orb, cast on the matching obelisk (Wiki; data in
 * data/crafting-spells.json): an unpowered orb, 3 cosmic runes and 30 of the element's runes
 * become the charged orb. Casting repeats while the player has orbs and runes and stays put.
 * While Guthix Sleeps' own orb puzzle handles its tile first.
 */
const { DATA, itemId, runes } = require("./Data.CraftingSpells");

const ORBS = DATA.chargeOrbs;
const CHARGING_ATTRIBUTE = "crafting-spells:charging";

let core = null;
let spells = null;

/** Spell name (lower case) -> spell, built on first use. */
function orbSpells() {
  if (spells) return spells;

  class ChargeOrbSpell extends core.Spell {
    constructor(data) {
      super();
      this.data = data;
      this.members = true;
      this.orbId = itemId(core, data.orb);
      // The unpowered orb is used up by chargeOnce, not the rune pipeline, so staves and rune
      // pouches never stand in for it.
      this.runeItems = runes(core, data.runes);
      const widget = core.CacheDefinitions.getSpellByName(data.name);
      if (!widget) throw new Error(`Missing cache spell: ${data.name}`);
      this.id = widget.widgetId;
    }
    spellId() { return this.id; }
    levelRequired() { return this.data.level; }
    baseExperience() { return this.data.xp; }
    itemsRequired() { return this.runeItems; }
    equipmentRequired() { return []; }
    startCast() {}
  }

  return spells = new Map(ORBS.spells.map((data) => [data.name.toLowerCase(), new ChargeOrbSpell(data)]));
}

function unpoweredOrb() {
  return itemId(core, ORBS.orb);
}

function stopCharging(player) {
  player.getAttribute(CHARGING_ATTRIBUTE)?.stop();
}

/** One cast: false when the player can no longer cast it. */
function chargeOnce(player, spell) {
  if (!player.getInventory().contains(unpoweredOrb()) || !spell.canCast(player, true)) return false;
  player.performAnimation(new core.Animation(ORBS.seq));
  player.performGraphic(new core.Graphic(spell.data.spotanim, 0, core.GraphicHeight.HIGH));
  player.getInventory().deleteNumber(unpoweredOrb(), 1);
  player.getInventory().addItem(new core.Item(spell.orbId, 1));
  player.getSkillManager().addExperiences(core.Skill.MAGIC, spell.baseExperience());
  return true;
}

function startCharging(player, spell) {
  stopCharging(player);
  if (!chargeOnce(player, spell)) return;

  class ChargingTask extends core.Task {
    constructor() {
      super(ORBS.intervalTicks, player);
      this.from = player.getLocation().clone();
    }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 || player.getInterfaceId() !== -1 ||
          !player.getLocation().equals(this.from) || !chargeOnce(player, spell)) {
        this.stop();
      }
    }
    stop() {
      super.stop();
      if (player.getAttribute(CHARGING_ATTRIBUTE) === this) player.setAttribute(CHARGING_ATTRIBUTE, null);
    }
  }

  const task = new ChargingTask();
  player.setAttribute(CHARGING_ATTRIBUTE, task);
  core.TaskManager.submit(task);
}

function chargeOrb(event) {
  const name = core.CacheDefinitions.getSpellName(event.spellWidget, event.spellItemId)?.trim().toLowerCase();
  const spell = orbSpells().get(name);
  if (!spell) return;
  if (event.object?.getDefinition?.()?.getName?.() !== spell.data.obelisk) return;
  event.handled = true;
  const { player } = event;
  if (!player.getInventory().contains(unpoweredOrb())) {
    // ponytail: not captured; the live text may differ.
    player.sendMessage("You need an unpowered orb to cast this spell.");
    return;
  }
  startCharging(player, spell);
}

module.exports = function attach(api) {
  core = api.core;
  api.onSpellOnObject(chargeOrb);
};
