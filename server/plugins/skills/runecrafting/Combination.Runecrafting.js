"use strict";

/**
 * Combination runes: an elemental rune used on the altar of another element (Wiki: Combination rune).
 *
 * Wiki: the rune used and the altar give the rune (Air altar: water mist, earth dust, fire smoke; Water altar: air
 * mist, earth mud, fire steam; Earth altar: water mud, air dust, fire lava; Fire altar: water steam, air smoke, earth
 * lava), at Runecraft 6 mist, 10 dust, 13 mud, 15 smoke, 19 steam, 23 lava. It takes pure essence and the same
 * number of the elemental runes, and either the used rune's talisman (spent) or an active Magic Imbue (the talisman
 * is then kept). Essence, runes and talisman go whether or not the runes bind; each rune binds on a 50% chance, and a
 * worn Binding necklace (16 uses, one per altar use) binds them all. A batch is refused before spending anything
 * when the bound runes cannot fit in the inventory.
 * XP an essence is each rune's own Recipe infobox on the Wiki, by altar. The Steam rune page's table says 9.3 on the
 * Water altar and its prose 9.5; the table is used.
 * rsprox 1757 (rev 227) tick 18626: an earth rune on the water altar with 6 pure essence gave 2 mud runes with the
 * game message "You partially succeed to bind the temple's power into mud runes." and the plain craft's animation 791,
 * graphic 186 and sound (synth 2710). It shows the six essence going, but NOT the talisman or the runes spent (the
 * earth count before is not in it, the talisman is not shown going): those rest on the Wiki alone. The all-bound and
 * none-bound lines, the refusals, the necklace's last-charge line and its charge count kept per player are ours: no
 * capture has them. Preset items (Item.isPresetItem) are not counted or spent, so a loadout's copies never become
 * real runes; the stacks are taken slot by slot.
 *
 * Not done: Daeyalt essence (the Wiki's recipes pay 1.5 times, mist 12), guardian essence and Twisted extract
 * recipes; the Binding necklace's Check and Destroy options (the Wiki: Check gives the uses left, Destroy restores
 * the next to 16); runic extracts; the Aether rune.
 */

const NECKLACE_ATTRIBUTE = "runecrafting:binding-necklace";
const NECKLACE_USES = 16;
const IMBUE_ATTRIBUTE = "lunar:magic-imbue-until";
const SUCCESS_CHANCE = 0.5;

let api, core, craftGraphic, craftAnimation;

/** altar object -> rune used -> { made, level, xp, talisman } (Wiki Recipe infoboxes). */
function buildTable() {
  const I = core.ItemIdentifiers, O = core.ObjectIdentifiers;
  const air = { rune: I.AIR_RUNE, talisman: I.AIR_TALISMAN };
  const water = { rune: I.WATER_RUNE, talisman: I.WATER_TALISMAN };
  const earth = { rune: I.EARTH_RUNE, talisman: I.EARTH_TALISMAN };
  const fire = { rune: I.FIRE_RUNE, talisman: I.FIRE_TALISMAN };
  const mist = { made: I.MIST_RUNE, name: "mist", level: 6 }, dust = { made: I.DUST_RUNE, name: "dust", level: 10 };
  const mud = { made: I.MUD_RUNE, name: "mud", level: 13 }, smoke = { made: I.SMOKE_RUNE, name: "smoke", level: 15 };
  const steam = { made: I.STEAM_RUNE, name: "steam", level: 19 }, lava = { made: I.LAVA_RUNE, name: "lava", level: 23 };
  const row = (using, rune, xp) => [using.rune, { ...rune, xp, talisman: using.talisman }];
  return new Map([
    [O.ALTAR_33, new Map([row(water, mist, 8), row(earth, dust, 8.3), row(fire, smoke, 8.5)])],
    [O.ALTAR_35, new Map([row(air, mist, 8.5), row(earth, mud, 9.3), row(fire, steam, 9.3)])],
    [O.ALTAR_36, new Map([row(water, mud, 9.5), row(air, dust, 9), row(fire, lava, 10)])],
    [O.ALTAR_37, new Map([row(water, steam, 10), row(air, smoke, 9.5), row(earth, lava, 10.5)])],
  ]);
}
let TABLE;

function imbued(player) {
  const until = player.getAttribute(IMBUE_ATTRIBUTE);
  return typeof until === "number" && until > core.World.getProcessCycle();
}

/** The worn Binding necklace's slot content, or null. */
function wornNecklace(player) {
  const worn = player.getEquipment().getItems()[core.Equipment.AMULET_SLOT];
  return worn && worn.getId() === core.ItemIdentifiers.BINDING_NECKLACE ? worn : null;
}

/**
 * The inventory slots holding `id` that are real items, not a preset's copies, with how many to take from each, for
 * `amount` of them. Returns the plan or null when there are fewer.
 */
function takeable(inventory, id) {
  const slots = [];
  inventory.getItems().forEach((item, slot) => {
    if (item && item.getId() === id && item.isPresetItem?.() !== true) slots.push([slot, item.getAmount()]);
  });
  return slots;
}
const total = (slots) => slots.reduce((sum, [, amount]) => sum + amount, 0);
function takeFrom(inventory, slots, amount, refresh = true) {
  for (const [slot, have] of slots) {
    if (amount <= 0) return;
    const take = Math.min(have, amount);
    inventory.deleteAtSlot(slot, take, refresh);
    amount -= take;
  }
}

function useNecklace(player) {
  const left = (player.getAttribute(NECKLACE_ATTRIBUTE) ?? NECKLACE_USES) - 1;
  if (left > 0) {
    player.setAttribute(NECKLACE_ATTRIBUTE, left);
    return;
  }
  player.setAttribute(NECKLACE_ATTRIBUTE, undefined);
  const equipment = player.getEquipment();
  equipment.setItem(core.Equipment.AMULET_SLOT, new core.Item(-1, 0));
  equipment.refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  player.sendMessage("Your Binding necklace disintegrates.");
}

function combine(event) {
  const rune = !event.handled && TABLE.get(event.objectId)?.get(event.itemId);
  if (!rune) return;
  event.handled = true;
  const { player } = event;
  const I = core.ItemIdentifiers, inventory = player.getInventory();
  if (player.getSkillManager().getCurrentLevel(core.Skill.RUNECRAFTING) < rune.level) {
    player.sendMessage(`You need a Runecrafting level of at least ${rune.level} to craft this.`);
    return;
  }
  const essenceSlots = takeable(inventory, I.PURE_ESSENCE);
  const essence = total(essenceSlots);
  if (essence <= 0) {
    player.sendMessage("You do not have any pure essence to bind.");
    return;
  }
  const useImbue = imbued(player);
  const talismanSlots = takeable(inventory, rune.talisman);
  if (!useImbue && talismanSlots.length === 0) {
    player.sendMessage("You need the talisman of the rune you are using, or Magic Imbue, to combine runes.");
    return;
  }
  const runeSlots = takeable(inventory, event.itemId);
  const amount = Math.min(essence, total(runeSlots));
  if (amount <= 0) return;
  const necklace = wornNecklace(player);
  let bound = 0;
  for (let i = 0; i < amount; i++) if (necklace || Math.random() < SUCCESS_CHANCE) bound++;

  if (bound > 0) {
    // Check the actual rolled output after the same slot-specific debits as the real transaction.
    const preview = new core.Inventory(player).setItems(inventory.getCopiedItems());
    takeFrom(preview, essenceSlots, amount, false);
    takeFrom(preview, runeSlots, amount, false);
    if (!useImbue) takeFrom(preview, talismanSlots, 1, false);
    if (preview.getAddableAmount(new core.Item(rune.made, bound)) < bound) {
      inventory.full();
      return;
    }
  }

  takeFrom(inventory, essenceSlots, amount);
  takeFrom(inventory, runeSlots, amount);
  if (!useImbue) takeFrom(inventory, talismanSlots, 1);
  if (bound > 0) inventory.addItem(new core.Item(rune.made, bound));

  player.performGraphic(craftGraphic);
  player.performAnimation(craftAnimation);
  core.Sounds.sendSound(player, core.Sound.CRAFT_RUNES);
  if (bound === amount) player.sendMessage(`You succeed in binding the temple's power into ${rune.name} runes.`);
  else if (bound > 0) player.sendMessage(`You partially succeed to bind the temple's power into ${rune.name} runes.`);
  else player.sendMessage(`You fail to bind the temple's power into ${rune.name} runes.`);
  if (bound > 0) player.getSkillManager().addExperiences(core.Skill.RUNECRAFTING, bound * rune.xp);
  if (necklace) useNecklace(player);
  // Nothing here says the Rift guardian or a league relic apply to combination runes: amountPerEssence 0 keeps the
  // relic's extra runes off, and no guardian colour matches. The diary hooks read runeAmount.
  if (bound > 0) api.emitCustomEvent("runecrafting:success", {
    player, skill: core.Skill.RUNECRAFTING, rolls: amount, amountPerEssence: 0, runeId: rune.made, runeAmount: bound,
    objectId: event.objectId, altarId: event.objectId, essenceIds: [I.PURE_ESSENCE], combination: true,
  });
}

function attach(pluginApi) {
  api = pluginApi; core = api.core;
  craftGraphic = new core.Graphic(186, 0, 92);
  craftAnimation = new core.Animation(791);
  TABLE = buildTable();
  api.persistAttribute(NECKLACE_ATTRIBUTE);
  api.onItemOnObject(combine, { noted: false });
}

module.exports = { attach, NECKLACE_USES };
