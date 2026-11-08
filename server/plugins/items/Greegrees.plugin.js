/**
 * Greegrees (OSRS Wiki, Greegree): wielding one on Ape Atoll, in its dungeons or in the Ardougne
 * Zoo turns the player into the monkey whose bones went into it. While transformed the island's
 * monsters leave the player alone, the player can't attack, the spellbook tab is closed and the
 * zombie forms can only walk.
 * Leaving the island (walking, a boat, a teleport) wrenches the greegree off: into the inventory,
 * or onto the ground when it is full (Wiki, Ninja monkey greegree (small)).
 *
 * Wielding follows rsprox captures 1440 (Karamjan, rev 224) and 3342 (large zombie, rev 235):
 * on the same tick, spotanim windwave_impact (160) at height 124, the equip sound 2238 (played by
 * the equip itself) and the form's own sound, the spellbook tab closed with its stone's events
 * cleared and the side panel switched to the inventory; no chat message. Wielding in combat is
 * refused with "You cannot use this whilst in combat." (3342). The transformation sounds other
 * than 1677 and 1680, the revert graphic, the off-island refusal, the attack refusal's text and
 * the "wrenches itself" text
 * have no capture (docs/greegrees.md).
 *
 * Other plugins ask for the form through "greegree:form" ({ player, form: null }): the form's key
 * while the player is transformed (the Ape Atoll Agility Course needs a ninja or Kruk).
 */

const FORM_ATTRIBUTE = "greegrees:form";

const Item = Object.freeze({
  SMALL_NINJA: 4024, // mm_monkey_greegree_for_small_ninja_monkey
  MEDIUM_NINJA: 4025, // mm_monkey_greegree_for_medium_ninja_monkey
  GORILLA: 4026, // mm_monkey_greegree_for_normal_gorilla
  BEARDED_GORILLA: 4027, // mm_monkey_greegree_for_bearded_gorilla
  ANCIENT_GORILLA: 4028, // mm_monkey_greegree_for_ancient_monkey_skull
  SMALL_ZOMBIE: 4029, // mm_monkey_greegree_for_small_zombie_monkey
  LARGE_ZOMBIE: 4030, // mm_monkey_greegree_for_large_zombie_monkey
  KARAMJAN: 4031, // mm_monkey_greegree_for_normal_monkey
  KRUK: 19525, // mm2_kruk_greegree
});

/** The transformation NPCs (cache gamevals mm_transmogrification_*). */
const Npc = Object.freeze({
  SMALL_NINJA_MONKEY: 1462, // mm_transmogrification_small_ninja_monkey
  MEDIUM_NINJA_MONKEY: 1463, // mm_transmogrification_medium_ninja_monkey
  GORILLA: 1464, // mm_transmogrification_normal_gorilla
  BEARDED_GORILLA: 1465, // mm_transmogrification_bearded_gorilla
  ANCIENT_MONKEY: 1466, // mm_transmogrification_ancient_monkey
  SMALL_ZOMBIE_MONKEY: 1467, // mm_transmogrification_small_zombie_monkey
  LARGE_ZOMBIE_MONKEY: 1468, // mm_transmogrification_large_zombie_monkey
  MONKEY: 1469, // mm_transmogrification_normal_monkey
  // The cache has no Kruk transmogrification; mm2_kruk_noncombat is the plain Kruk.
  KRUK: 6804, // mm2_kruk_noncombat
});

/** Synth ids: into captured (1677, 1680), the rest unverified. */
const Sound = Object.freeze({
  INTO_MONKEY: 1677,
  MONKEY_OUT: 1681,
  INTO_SMALL_MONKEY: 1671,
  SMALL_MONKEY_OUT: 1683,
  INTO_GORILLA: 1676,
  GORILLA_OUT: 1674,
  INTO_ZOMBIE_MONKEY: 1680,
  ZOMBIE_MONKEY_OUT: 1690,
});

const MONKEY_SOUNDS = { into: Sound.INTO_MONKEY, out: Sound.MONKEY_OUT };
const SMALL_MONKEY_SOUNDS = { into: Sound.INTO_SMALL_MONKEY, out: Sound.SMALL_MONKEY_OUT };
const GORILLA_SOUNDS = { into: Sound.INTO_GORILLA, out: Sound.GORILLA_OUT };
const ZOMBIE_SOUNDS = { into: Sound.INTO_ZOMBIE_MONKEY, out: Sound.ZOMBIE_MONKEY_OUT };

const TRANSFORM_GRAPHIC = 160; // windwave_impact
const TRANSFORM_GRAPHIC_HEIGHT = 124;
const SIDE_SPELLBOOK_UID = (161 << 16) | 82; // toplevel_osrs_stretch:side6
const STONE_SPELLBOOK_UID = (161 << 16) | 65; // toplevel_osrs_stretch:stone6
const SIDEBUTTON_SWITCH_SCRIPT = 915; // toplevel_sidebutton_switch
const INVENTORY_TAB = 3;
const RUN_VARP = 173;

const IN_COMBAT_MESSAGE = "You cannot use this whilst in combat.";
const MONKEY_ATTACK_MESSAGE = "You can't attack while you're a monkey.";
const WRENCHED_MESSAGE = "The Monkey Greegree wrenches itself from your hand as its power begins to fade...";

/** Ape Atoll's two map squares by two, every plane, and the dungeons under it; the zoo pen. */
const APE_ATOLL = { minX: 2688, maxX: 2815, minY: 2688, maxY: 2815 };
const APE_ATOLL_DUNGEONS = { minX: 2688, maxX: 2815, minY: 9088, maxY: 9215 };
const ARDOUGNE_ZOO = { minX: 2594, maxX: 2612, minY: 3272, maxY: 3286, planes: [0] };
const PLANES = [0, 1, 2, 3];

let core;
/** Players whose login has finished; equipment changes before it are the login's own. */
const bootstrapped = new WeakSet();

function form(key, npc, sounds, walkOnly = false) {
  return { key, npc, sounds, walkOnly };
}

/** weapon item id -> the form it gives. */
const FORMS = new Map([
  [Item.KARAMJAN, form("karamjan-monkey", Npc.MONKEY, MONKEY_SOUNDS)],
  [Item.SMALL_NINJA, form("small-ninja-monkey", Npc.SMALL_NINJA_MONKEY, SMALL_MONKEY_SOUNDS)],
  [Item.MEDIUM_NINJA, form("medium-ninja-monkey", Npc.MEDIUM_NINJA_MONKEY, MONKEY_SOUNDS)],
  [Item.GORILLA, form("gorilla", Npc.GORILLA, GORILLA_SOUNDS)],
  [Item.BEARDED_GORILLA, form("bearded-gorilla", Npc.BEARDED_GORILLA, GORILLA_SOUNDS)],
  [Item.ANCIENT_GORILLA, form("ancient-monkey", Npc.ANCIENT_MONKEY, GORILLA_SOUNDS)],
  [Item.SMALL_ZOMBIE, form("small-zombie-monkey", Npc.SMALL_ZOMBIE_MONKEY, ZOMBIE_SOUNDS, true)],
  [Item.LARGE_ZOMBIE, form("large-zombie-monkey", Npc.LARGE_ZOMBIE_MONKEY, ZOMBIE_SOUNDS, true)],
  [Item.KRUK, form("kruk", Npc.KRUK, MONKEY_SOUNDS)],
]);
const FORMS_BY_KEY = new Map([...FORMS.values()].map((entry) => [entry.key, entry]));

function weaponForm(player) {
  return FORMS.get(player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1) ?? null;
}

function within(location, zone) {
  const x = location.getX();
  const y = location.getY();
  return x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY
    && (zone.planes ?? PLANES).includes(location.getZ());
}

/** Where Zooknock's magic reaches. */
function canTransformAt(location) {
  return within(location, APE_ATOLL) || within(location, APE_ATOLL_DUNGEONS) || within(location, ARDOUGNE_ZOO);
}

function boundaries() {
  const { Boundary } = core;
  const zone = ({ minX, maxX, minY, maxY }, z) => new Boundary(minX, maxX, minY, maxY, z);
  return [
    ...PLANES.map((z) => zone(APE_ATOLL, z)),
    ...PLANES.map((z) => zone(APE_ATOLL_DUNGEONS, z)),
    ...ARDOUGNE_ZOO.planes.map((z) => zone(ARDOUGNE_ZOO, z)),
  ];
}

function currentForm(player) {
  return FORMS_BY_KEY.get(player.getAttribute(FORM_ATTRIBUTE)) ?? null;
}

function closeSpellbook(player) {
  player.getPacketSender()
    .closeSubInterface(SIDE_SPELLBOOK_UID)
    .sendInterfaceFlagsRange(STONE_SPELLBOOK_UID, -1, -1, 0)
    .sendClientScript(SIDEBUTTON_SWITCH_SCRIPT, INVENTORY_TAB);
}

function transform(player, form, announce) {
  player.setAttribute(FORM_ATTRIBUTE, form.key);
  player.setNpcTransformationId(form.npc);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  closeSpellbook(player);
  if (announce) {
    player.performGraphic(new core.Graphic(TRANSFORM_GRAPHIC, 0, TRANSFORM_GRAPHIC_HEIGHT));
    player.getPacketSender().sendSoundEffect(form.sounds.into, 1, 0);
  }
}

function revert(player, form) {
  player.setAttribute(FORM_ATTRIBUTE, null);
  player.setNpcTransformationId(-1);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  player.performGraphic(new core.Graphic(TRANSFORM_GRAPHIC, 0, TRANSFORM_GRAPHIC_HEIGHT));
  player.getPacketSender().sendSoundEffect(form.sounds.out, 1, 0);
  player.getPacketSender().sendTabInterface(6, player.getSpellbook().getInterfaceId());
}

/** Brings the player's look in line with their weapon and where they stand. */
function sync(player, announce) {
  const current = currentForm(player);
  const wanted = canTransformAt(player.getLocation()) ? weaponForm(player) : null;
  if (current === wanted) return;
  if (current) revert(player, current);
  if (wanted) transform(player, wanted, announce);
}

/** Off the island the greegree comes off: to the inventory, or the ground when that is full. */
function wrenchOff(player) {
  const slot = core.Equipment.WEAPON_SLOT;
  const greegree = player.getEquipment().getItems()[slot];
  if (!FORMS.has(greegree?.getId?.())) return;
  if (!core.EquipPacketListener.unequip(player, slot)) {
    player.getEquipment().setItem(slot, new core.Item(-1, 0));
    core.EquipPacketListener.resetWeapon(player, true);
    player.getEquipment().refreshItems();
    core.ItemOnGroundManager.registers(player, greegree);
  }
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.StatementDialogue(0, WRENCHED_MESSAGE),
    new core.EndDialogue(1),
  ));
}

function canEquipGreegree(event) {
  const { player, item } = event;
  if (!FORMS.has(item.getId())) return;
  if (core.CombatFactory.inCombat(player)) {
    event.allow = false;
    player.sendMessage(IN_COMBAT_MESSAGE);
    return;
  }
  if (!canTransformAt(player.getLocation())) {
    event.allow = false;
    player.sendMessage(WRENCHED_MESSAGE);
  }
}

function syncOnEquipmentChange({ player }) {
  if (bootstrapped.has(player)) sync(player, true);
}

/** Login: a greegree worn off the island comes off; on it the player is a monkey again. */
function syncOnLogin({ player }) {
  bootstrapped.add(player);
  if (weaponForm(player) && !canTransformAt(player.getLocation())) {
    wrenchOff(player);
    return;
  }
  sync(player, false);
}

function answerForm(request) {
  if (request?.player) request.form = request.player.getAttribute(FORM_ATTRIBUTE) ?? null;
}

function createGreegreeArea() {
  class GreegreeArea extends core.Area {
    /** Zombie monkeys shamble: no running. */
    process(mobile) {
      if (!mobile.isPlayer() || !currentForm(mobile)?.walkOnly || !mobile.isRunningReturn?.()) return;
      mobile.setRunning(false);
      mobile.getPacketSender().sendConfig(RUN_VARP, 0);
    }

    postLeave(mobile, logout) {
      if (logout || !mobile.isPlayer() || canTransformAt(mobile.getLocation())) return;
      wrenchOff(mobile);
      sync(mobile, true);
    }

    /** A monkey doesn't fight. */
    canAttack(attacker) {
      if (!attacker.isPlayer() || !attacker.getAttribute(FORM_ATTRIBUTE)) return null;
      attacker.sendMessage(MONKEY_ATTACK_MESSAGE);
      return false;
    }

    /** "In monkey form, monsters on the island become non-aggressive" (Wiki). */
    npcAggression(player) {
      return player.getAttribute(FORM_ATTRIBUTE) ? false : null;
    }
  }
  return new GreegreeArea(boundaries());
}

module.exports = {
  name: "Greegrees",
  description: "Wielding a monkey greegree on Ape Atoll turns the player into a monkey, calms the island's monsters and removes the greegree on leaving.",
  members: true,
  register(api) {
    core = api.core;
    api.registerArea(createGreegreeArea());
    api.onCanEquip(canEquipGreegree);
    api.onCustomEvent("equipment:changed", syncOnEquipmentChange);
    api.onCustomEvent("player:bootstrap-complete", syncOnLogin);
    api.onCustomEvent("greegree:form", answerForm);
  },
};

module.exports._test = { FORMS, canTransformAt, sync, wrenchOff };
