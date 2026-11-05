/**
 * Waterskins (docs/desert-heat.md): https://oldschool.runescape.wiki/w/Waterskin
 *
 * A waterskin holds four drinks for the desert heat. It is topped up by cutting a Kharidian
 * cactus, or by pouring a bucket (4 doses), bowl (3), jug (2) or vial (1) of water into it.
 * Water sources fill it in the WaterSources plugin, and Humidify in the Lunar spells.
 *
 * Captures (rsprox), cactus: a knife chops (human_knife_chop) or a wielded slashing weapon
 * hacks (human_axe_hack) a tick after arrival, with synth 2500; the cactus turns dry whatever
 * the outcome. A success gives 10 Woodcutting xp and tops the emptiest skin up by one, with
 * synth 2401; with every skin full (or none) it says so instead.
 */
const FULL_CACTUS_TO_DRY = new Map([[2670, 2671], [44029, 44030]]); // desert_cactus_full(_alt) -> desert_cactus_empty(_alt)
const CACTUS_REGROW_TICKS = 100; // Wiki: a dry cactus is healthy again after 1 minute
const KNIFE_ANIMATION = 911; // human_knife_chop
const WEAPON_ANIMATION = 395; // human_axe_hack
const CUT_SOUND = 2500;
const FILL_SOUND = 2401;
const ATTACK_SLASH_BONUS = 1;
const SUCCESS_XP = 10;
const FAIL_XP = 0.4;
/** Wiki (Mod Ash): a direct roll on Woodcutting, from about 12% at level 1 to 99% at 99. */
const LOW_CHANCE = 0.12;
const HIGH_CHANCE = 0.99;
/** Doses each container of water pours into a waterskin (Wiki: Waterskin). */
const POURED_DOSES = [["BUCKET_OF_WATER", "BUCKET", 4], ["BOWL_OF_WATER", "BOWL", 3], ["JUG_OF_WATER", "JUG", 2], ["VIAL_OF_WATER", "VIAL", 1]];

let core;
let api;
/** Waterskin ids by doses, 0 to 4. */
let WATERSKINS = [];
let POURS = new Map();

function defineItems({ ItemIdentifiers: Items }) {
  WATERSKINS = [Items.WATERSKIN_0_, Items.WATERSKIN_1_, Items.WATERSKIN_2_, Items.WATERSKIN_3_, Items.WATERSKIN_4_];
  POURS = new Map(POURED_DOSES.map(([full, empty, doses]) => [Items[full], { empty: Items[empty], doses }]));
}

function dosesOf(itemId) {
  return WATERSKINS.indexOf(itemId);
}

/** The emptiest waterskin that isn't full, as its inventory slot, or -1. */
function emptiestSkinSlot(inventory) {
  for (let doses = 0; doses < WATERSKINS.length - 1; doses++) {
    const slot = inventory.getSlotForItemId(WATERSKINS[doses]);
    if (slot >= 0) return slot;
  }
  return -1;
}

function cutChance(level) {
  const clamped = Math.max(1, Math.min(99, level));
  return LOW_CHANCE + ((HIGH_CHANCE - LOW_CHANCE) * (clamped - 1)) / 98;
}

function slashesWithWeapon(player) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  const id = weapon?.getId?.() ?? -1;
  return id > 0 && (core.ItemDefinition.forId(id).getBonuses()?.[ATTACK_SLASH_BONUS] ?? 0) > 0;
}

function dryCactus(cactus, dryId) {
  const { GameObject, ObjectManager, MapObjects, TaskManager, Task } = core;
  const dry = new GameObject(dryId, cactus.getLocation().clone(), cactus.getType(), cactus.getFace(), cactus.getPrivateArea());
  ObjectManager.deregister(cactus, true);
  ObjectManager.register(dry, true);
  TaskManager.submit(new (class extends Task {
    constructor() { super(CACTUS_REGROW_TICKS); }
    execute() {
      this.stop();
      const current = MapObjects.get(dryId, dry.getLocation(), dry.getPrivateArea());
      if (current) ObjectManager.deregister(current, true);
      ObjectManager.register(cactus, true);
    }
  })());
}

function finishCut(player, cactus, dryId, animation) {
  const { Skill, Item } = core;
  player.performAnimation(new core.Animation(animation));
  player.getPacketSender().sendSoundEffect(CUT_SOUND, 1, 15);
  dryCactus(cactus, dryId);
  const skills = player.getSkillManager();
  if (Math.random() >= cutChance(skills.getCurrentLevel(Skill.WOODCUTTING))) {
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, "You fail to cut the cactus correctly and it gives no water this time.");
    skills.addExperiences(Skill.WOODCUTTING, FAIL_XP);
    return;
  }
  skills.addExperiences(Skill.WOODCUTTING, SUCCESS_XP);
  const inventory = player.getInventory();
  const slot = emptiestSkinSlot(inventory);
  if (slot < 0) {
    player.sendMessage("You have no empty waterskins to put the water in.");
    return;
  }
  inventory.setItem(slot, new Item(WATERSKINS[dosesOf(inventory.getItems()[slot].getId()) + 1], 1)).refreshItems();
  player.getPacketSender().sendSoundEffect(FILL_SOUND, 1, 0);
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, "You top up your skin with water from the cactus.");
  api.emitCustomEvent("diary:task", { player, diary: "desert", task: "cut-a-desert-cactus-open-to-fill-a-waterskin" });
}

function cutCactus({ player, object }) {
  const dryId = FULL_CACTUS_TO_DRY.get(object.getId());
  if (dryId === undefined) return false;
  player.setPositionToFace(object.getLocation());
  const knife = player.getInventory().contains(core.ItemIdentifiers.KNIFE);
  if (!knife && !slashesWithWeapon(player)) {
    player.sendMessage("You need a knife or other slashing weapon to cut the cactus...");
    return true;
  }
  const animation = knife ? KNIFE_ANIMATION : WEAPON_ANIMATION;
  // Keyed to the player's index, so walking off cancels the cut (walkToReset).
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player.getIndex()); }
    execute() {
      this.stop();
      const current = core.MapObjects.get(object.getId(), object.getLocation(), object.getPrivateArea());
      if (player.isRegistered() && current) finishCut(player, current, dryId, animation);
    }
  })());
  return true;
}

/** Wiki: a container of water pours its doses into a waterskin that isn't full. */
function pourIntoSkin(event) {
  const { player } = event;
  const usedIsSkin = dosesOf(event.usedItemId) >= 0;
  const skinId = usedIsSkin ? event.usedItemId : event.usedWithItemId;
  const pour = POURS.get(usedIsSkin ? event.usedWithItemId : event.usedItemId);
  const doses = dosesOf(skinId);
  if (!pour || doses < 0 || doses >= WATERSKINS.length - 1) return;
  event.handled = true;
  const inventory = player.getInventory();
  const skinSlot = usedIsSkin ? event.usedItemSlot : event.usedWithItemSlot;
  const containerSlot = usedIsSkin ? event.usedWithItemSlot : event.usedItemSlot;
  inventory.setItem(skinSlot, new core.Item(WATERSKINS[Math.min(WATERSKINS.length - 1, doses + pour.doses)], 1));
  inventory.setItem(containerSlot, new core.Item(pour.empty, 1)).refreshItems();
  player.getPacketSender().sendSoundEffect(FILL_SOUND, 1, 0);
  player.sendMessage("You fill the waterskin.");
}

module.exports = {
  name: "Waterskins",
  members: true,
  _test: { cutChance, emptiestSkinSlot, FULL_CACTUS_TO_DRY },
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    defineItems(core);
    api.onObjectInteraction("Kharidian cactus (Healthy)", { Cut: cutCactus });
    api.onItemOnItem(pourIntoSkin, { noted: false });
  },
};
