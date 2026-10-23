// OSRS Wiki: https://oldschool.runescape.wiki/w/Warped_sceptre
const MAX_CHARGES = 20000;
const CHAOS_RUNES_PER_CHARGE = 2;
const EARTH_RUNES_PER_CHARGE = 5;
const CHARGES_META_KEY = "warped-sceptre";
const ATTACK_SPEED = 4; // Wiki combat stats: 25 casts per minute.
const ATTACK_RANGE = 7; // Wiki combat stats; Powered Staff Longrange adds two tiles.
const CAST_ANIMATION = 10500; // client gameval AnimationID.VFX_WARPED_SCEPTRE_CAST
const CAST_START_GRAPHIC = 2567; // client gameval SpotanimID.VFX_WARPED_SCEPTRE_CAST
const CAST_PROJECTILE_GRAPHIC = 2569; // client gameval SpotanimID.VFX_WARPED_SCEPTRE_PROJECTILE_PROJECTILE
const CAST_IMPACT_GRAPHIC = 2568; // client gameval SpotanimID.VFX_WARPED_SCEPTRE_PROJECTILE_IMPACT
const CHARGES_WARPED_SCEPTRE_QUANTITY_VARBIT = 16155; // client gameval VarbitID.CHARGES_WARPED_SCEPTRE_QUANTITY
const MAGIC_LEVEL_REQUIRED = 62; // OSRS Wiki item page

let core = null;
let ItemIdentifiers = null;
let chargedIds = new Set();
let unchargedByCharged = new Map();
let chargedByUncharged = new Map();
let SceptreCombatMethod = null;
const spells = new WeakMap();

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function weaponOf(player) {
  return player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] ?? null;
}

function syncWornCharges(player) {
  const weapon = weaponOf(player);
  const wornCharges = chargedIds.has(Number(weapon?.getId?.() ?? -1)) ? charges(weapon) : 0;
  player.getPacketSender().sendVarbit(CHARGES_WARPED_SCEPTRE_QUANTITY_VARBIT, wornCharges);
}

function wieldsSceptre(player, chargedOnly = false) {
  const id = Number(weaponOf(player)?.getId?.() ?? -1);
  return chargedIds.has(id) || (!chargedOnly && chargedByUncharged.has(id));
}

function baseMaxHit(player) {
  // Wiki formula: floor((8 * current Magic level + 96) / 37).
  const magic = player.getSkillManager().getCurrentLevel(core.Skill.MAGIC);
  return Math.floor((8 * magic + 96) / 37);
}

function spellFor(player) {
  let spell = spells.get(player);
  if (spell) return spell;
  const { Animation, CombatNormalSpell, Graphic, GraphicHeight, Projectile } = core;
  spell = new CombatNormalSpell({
    spellId: () => core.ItemIdentifiers.WARPED_SCEPTRE,
    maximumHit: () => baseMaxHit(player),
    castAnimation: () => new Animation(CAST_ANIMATION),
    startGraphic: () => new Graphic(CAST_START_GRAPHIC, GraphicHeight.HIGH),
    castProjectile: (cast, castOn) =>
      Projectile.createProjectile(cast, castOn, CAST_PROJECTILE_GRAPHIC, 0, 20, 43, 31),
    endGraphic: () => new Graphic(CAST_IMPACT_GRAPHIC),
    baseExperience: () => 0,
    levelRequired: () => MAGIC_LEVEL_REQUIRED,
  });
  spells.set(player, spell);
  return spell;
}

function useCharge(player, item) {
  const left = charges(item) - 1;
  if (left < 0) return;
  if (left > 0) {
    item.setMetaValue(CHARGES_META_KEY, left);
    syncWornCharges(player);
    return;
  }
  // No charges left, revert to uncharged form.
  const unchargedId = unchargedByCharged.get(item.getId());
  if (unchargedId !== undefined) {
    item.setId(unchargedId);
  }
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.getUpdateFlag()?.flag?.(core.Flag.APPEARANCE);
  syncWornCharges(player);
  player.sendMessage("Your warped sceptre has run out of charges.");
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your warped sceptre has ${charges(item).toLocaleString("en-US")} charges left.`);
  return true;
}

function chargeSceptre(player, sceptre) {
  const inventory = player.getInventory();
  const current = charges(sceptre);
  if (current >= MAX_CHARGES) {
    player.sendMessage("Your warped sceptre is already fully charged.");
    return true;
  }
  const added = Math.min(
    Math.floor(inventory.getAmount(ItemIdentifiers.CHAOS_RUNE) / CHAOS_RUNES_PER_CHARGE),
    Math.floor(inventory.getAmount(ItemIdentifiers.EARTH_RUNE) / EARTH_RUNES_PER_CHARGE),
    MAX_CHARGES - current,
  );
  if (added <= 0) {
    player.sendMessage("You need two chaos runes and five earth runes for each charge.");
    return true;
  }
  inventory.deleteNumber(ItemIdentifiers.CHAOS_RUNE, added * CHAOS_RUNES_PER_CHARGE);
  inventory.deleteNumber(ItemIdentifiers.EARTH_RUNE, added * EARTH_RUNES_PER_CHARGE);
  if (chargedByUncharged.has(sceptre.getId())) {
    sceptre.setId(chargedByUncharged.get(sceptre.getId()));
  }
  sceptre.setMetaValue(CHARGES_META_KEY, current + added);
  refresh(player);
  syncWornCharges(player);
  player.sendMessage(`You add ${added.toLocaleString("en-US")} charge${added === 1 ? "" : "s"} to your warped sceptre.`);
  return true;
}

function chargeOption(event) {
  const { player, item } = event;
  if (!item || !(chargedIds.has(item.getId()) || chargedByUncharged.has(item.getId()))) {
    return false;
  }
  return chargeSceptre(player, item);
}

function chargeWithRunes(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const sceptre = chargedIds.has(usedItemId) || chargedByUncharged.has(usedItemId)
    ? usedItem
    : chargedIds.has(usedWithItemId) || chargedByUncharged.has(usedWithItemId)
      ? usedWithItem
      : null;
  const otherItemId = sceptre === usedItem ? usedWithItemId : usedItemId;
  if (!sceptre || ![ItemIdentifiers.CHAOS_RUNE, ItemIdentifiers.EARTH_RUNE].includes(otherItemId)) {
    return;
  }
  event.handled = chargeSceptre(player, sceptre);
}

function uncharge({ player, item }) {
  const amount = charges(item);
  if (amount <= 0) {
    player.sendMessage("Your warped sceptre has no charges to remove.");
    return true;
  }
  const inventory = player.getInventory();
  const neededSlots =
    (inventory.contains(ItemIdentifiers.CHAOS_RUNE) ? 0 : 1) +
    (inventory.contains(ItemIdentifiers.EARTH_RUNE) ? 0 : 1);
  if (inventory.getFreeSlots() < neededSlots) {
    player.sendMessage("Your inventory is too full to uncharge your warped sceptre.");
    return true;
  }
  const { Item } = core;
  inventory.addItem(new Item(ItemIdentifiers.CHAOS_RUNE, amount * CHAOS_RUNES_PER_CHARGE));
  inventory.addItem(new Item(ItemIdentifiers.EARTH_RUNE, amount * EARTH_RUNES_PER_CHARGE));
  const unchargedId = unchargedByCharged.get(item.getId()) ?? ItemIdentifiers.WARPED_SCEPTRE_UNCHARGED_;
  item.setId(unchargedId);
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  syncWornCharges(player);
  player.sendMessage(`You uncharge your warped sceptre, regaining ${amount * CHAOS_RUNES_PER_CHARGE} chaos runes and ${amount * EARTH_RUNES_PER_CHARGE} earth runes.`);
  return true;
}

function sceptreMethod() {
  if (SceptreCombatMethod) return SceptreCombatMethod;
  const { MagicCombatMethod, PendingHit } = core;
  SceptreCombatMethod = new (class extends MagicCombatMethod {
    constructor() {
      super();
      this.warpedSceptreBuiltInSpell = true;
    }

    canAttack(character, target) {
      const player = character.getAsPlayer();
      const staff = weaponOf(player);
      if (!chargedIds.has(staff?.getId?.()) || charges(staff) <= 0) {
        player.sendMessage("Your warped sceptre has no charges left. Charge it with runes to use its built-in spell.");
        player.getCombat().reset();
        return false;
      }
      player.getCombat().setCastSpell(spellFor(player));
      return true;
    }

    start(character, target) {
      const player = character.getAsPlayer();
      useCharge(player, weaponOf(player));
      super.start(character, target);
    }

    canPursue(character) {
      const player = character.getAsPlayer();
      return wieldsSceptre(player, true) && charges(weaponOf(player)) > 0;
    }

    hits(character, target) {
      const spell = spellFor(character.getAsPlayer());
      const hit = new PendingHit(
        character,
        target,
        this,
        MagicCombatMethod.hitDelay(character, target, spell),
      );
      spell.onHitCalc(hit);
      return [hit];
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    attackDistance(character) {
      const { FightStyle } = core;
      return ATTACK_RANGE +
        (character.getFightType?.()?.getStyle?.() === FightStyle.DEFENSIVE ? 2 : 0);
    }

    finished(character) {
      const combat = character.getCombat();
      combat.setPreviousCast(spellFor(character.getAsPlayer()));
      combat.setCastSpell(null);
    }
  })();
  return SceptreCombatMethod;
}

function resolveSceptre(attacker) {
  if (!attacker?.isPlayer?.()) return null;
  return wieldsSceptre(attacker.getAsPlayer()) ? sceptreMethod() : null;
}

module.exports = {
  name: "WarpedSceptre",
  members: true,
  _test: {
    charges,
    useCharge,
    checkCharges,
    chargeSceptre,
    chargeWithRunes,
    chargeOption,
    uncharge,
    baseMaxHit,
    resolveSceptre,
    MAX_CHARGES,
    ATTACK_SPEED,
    ATTACK_RANGE,
    CHARGES_META_KEY,
    CHARGES_WARPED_SCEPTRE_QUANTITY_VARBIT,
    syncWornCharges,
  },
  register(api) {
    core = api.core;
    ItemIdentifiers = core.ItemIdentifiers;
    const I = ItemIdentifiers;
    chargedIds = new Set([I.WARPED_SCEPTRE, I.WARPED_SCEPTRE_2]);
    unchargedByCharged = new Map([
      [I.WARPED_SCEPTRE, I.WARPED_SCEPTRE_UNCHARGED_],
      [I.WARPED_SCEPTRE_2, I.WARPED_SCEPTRE_UNCHARGED__2],
    ]);
    chargedByUncharged = new Map([
      [I.WARPED_SCEPTRE_UNCHARGED_, I.WARPED_SCEPTRE],
      [I.WARPED_SCEPTRE_UNCHARGED__2, I.WARPED_SCEPTRE_2],
    ]);

    // Named actions resolve the inventory option from the item definition.
    api.onItemAction("Warped sceptre", {
      Check: checkCharges,
      Uncharge: uncharge,
      Charge: chargeOption,
    });
    api.onItemAction("Warped sceptre (uncharged)", {
      Charge: chargeOption,
    });
    api.onItemOnItem(chargeWithRunes, { noted: false });
    api.onCustomEvent("equipment:changed", ({ player }) => syncWornCharges(player));
    api.onPlayerLogin(({ player }) => syncWornCharges(player));
    api.registerCombatMethodResolver({ resolve: resolveSceptre });
  },
};