/**
 * Lighting a light source with a tinderbox (https://oldschool.runescape.wiki/w/Light_sources and each
 * item's page): the unlit item becomes its lit version, at the Firemaking level the Wiki gives. Lit by
 * other code: the oil lamp, oil lantern, bullseye lantern and sapphire lantern (OilLights.plugin.js, they
 * need lamp oil first), the black candle (Merlin's Crystal) and the mining helmet (Logs.Firemaking.js,
 * which also credits the Lumbridge diary). Everything else a tinderbox lights is here. The bug lantern is
 * lit the same way (Firemaking 33) though the Wiki notes it is not a light source for darkness.
 *
 * An empty candle lantern also accepts a white or black candle, in either use direction (Wiki:
 * Candle lantern, revision 15184430). Unlit candles make the matching unlit lantern at Firemaking 1;
 * lit candles make the lit lantern at 4. Only the selected candle is consumed, and the selected
 * lantern changes in place to retain its metadata. Refusing restricted candles is a TSPS safeguard
 * against losing preset, untradeable or unbankable marks; the assembly refusal messages are our
 * wording, not Wiki text or recorded dialogue.
 *
 * Captured (rsprox 70 tick 1626, 75 tick 11666): lighting a torch says "You light your torch." and plays
 * no sequence and no sound. Nothing else was captured, so no other item gets a message or an animation, and
 * the level refusal reuses OilLights' wording. The lit item replaces the unlit one in its slot (setId), so a
 * preset, untradeable or unbankable copy stays one, and the current level counts, so a boost lights what it
 * should (Wiki).
 *
 * The lit mining helmet can be put out again (Wiki: "You can extinguish it if you want it unlit"): the
 * old click that turned it unlit was the only way back, so a helmet lit outside the Lumbridge basement
 * could never be lit there for the diary. A lit torch can also be extinguished except when it is
 * the player's only light in the currently modelled dark area (Wiki: Light sources).
 *
 * The torch used on a fire or range lights it (Wiki: "may be used with a tinderbox or dry sticks, or
 * used on a fire or range"). It needs a handler of its own because Cooking registers a `fallback`
 * that otherwise answers "You can't cook that." for every item used on a range.
 *
 * Dry sticks are not a tool here: the Wiki's Dry sticks page says "Unlike a tinderbox, clicking to
 * use the sticks on an unlit torch has no effect" — they light it through their own Rub-together
 * option, which Sea Slug owns (30 Firemaking, can fail, uses the sticks, moves the quest on).
 */
const { isCooker } = require("../skills/Cooking.plugin");
const Darkness = require("../world/Darkness.plugin");

let core;
/** Unlit item id -> { lit, level, message? }. */
let lights;

function build(I) {
  return new Map([
    [I.UNLIT_TORCH, { lit: I.LIT_TORCH, level: 1, message: "You light your torch." }],
    [I.CANDLE, { lit: I.LIT_CANDLE, level: 1 }],
    [I.CANDLE_LANTERN, { lit: I.CANDLE_LANTERN_3, level: 4 }], // white
    [I.CANDLE_LANTERN_4, { lit: I.CANDLE_LANTERN_6, level: 4 }], // black
    [I.UNLIT_BUG_LANTERN, { lit: I.LIT_BUG_LANTERN, level: 33 }],
    [I.EMERALD_LANTERN, { lit: I.EMERALD_LANTERN_2, level: 49 }],
  ]);
}

function candleRecipe(I, id) {
  if (id === I.CANDLE) return { result: I.CANDLE_LANTERN, level: 1 };
  if (id === I.BLACK_CANDLE) return { result: I.CANDLE_LANTERN_4, level: 1 };
  if (id === I.LIT_CANDLE) return { result: I.CANDLE_LANTERN_3, level: 4 };
  if (id === I.LIT_BLACK_CANDLE) return { result: I.CANDLE_LANTERN_6, level: 4 };
}

/** A candle can be placed in an empty lantern; lit candles need 4 Firemaking. */
function assembleCandleLantern(event) {
  const I = core.ItemIdentifiers;
  const lanternFirst = event.usedItemId === I.EMPTY_CANDLE_LANTERN;
  if (!lanternFirst && event.usedWithItemId !== I.EMPTY_CANDLE_LANTERN) return;
  const candleId = lanternFirst ? event.usedWithItemId : event.usedItemId;
  const recipe = candleRecipe(I, candleId);
  if (!recipe) return;
  event.handled = true;
  const { player } = event;
  const inventory = player.getInventory();
  const lantern = lanternFirst ? event.usedItem : event.usedWithItem;
  const candle = lanternFirst ? event.usedWithItem : event.usedItem;
  const lanternSlot = lanternFirst ? event.usedItemSlot : event.usedWithItemSlot;
  const candleSlot = lanternFirst ? event.usedWithItemSlot : event.usedItemSlot;
  if (lanternSlot === candleSlot || inventory.getItems()[lanternSlot] !== lantern ||
      inventory.getItems()[candleSlot] !== candle || lantern?.getId() !== I.EMPTY_CANDLE_LANTERN ||
      candle?.getId() !== candleId || lantern.getAmount() !== 1 || candle.getAmount() !== 1) return;
  // The lantern retains its own metadata; refusing restricted candles prevents their marks being lost.
  if (candle.isPresetItem() || candle.isUntradeable() || candle.isUnbankable()) {
    player.sendMessage("You cannot use that candle to make a lantern.");
    return;
  }
  if (player.getSkillManager().getCurrentLevel(core.Skill.FIREMAKING) < recipe.level) {
    player.sendMessage(`You need ${recipe.level} Firemaking to do this.`);
    return;
  }
  inventory.deleteAtSlot(candleSlot, 1, false);
  lantern.setId(recipe.result);
  inventory.refreshItems();
}

/** Lights `item` from `source`, or refuses on the level. Shared by both ways of lighting. */
function applyLight(player, item, source) {
  if (player.getSkillManager().getCurrentLevel(core.Skill.FIREMAKING) < source.level) {
    player.sendMessage(`You need ${source.level} Firemaking to light this.`);
    return;
  }
  item.setId(source.lit);
  player.getInventory().refreshItems();
  if (source.message) player.sendMessage(source.message);
}

function light(event) {
  const { player } = event;
  const ids = [event.usedItemId, event.usedWithItemId];
  if (!ids.includes(core.ItemIdentifiers.TINDERBOX)) return;
  const id = ids.find((candidate) => candidate !== core.ItemIdentifiers.TINDERBOX);
  const source = lights.get(id);
  if (!source) return;
  event.handled = true;
  const item = [event.usedItem, event.usedWithItem].find((held) => held?.getId() === id);
  if (!item || !player.getInventory().contains(core.ItemIdentifiers.TINDERBOX)) return;
  applyLight(player, item, source);
}

/** The torch used on a fire or range (Wiki). Cooking's fallback would otherwise refuse it. */
function lightOnObject(event) {
  const { player } = event;
  if (event.itemId !== core.ItemIdentifiers.UNLIT_TORCH) return;
  if (!isCooker(event.object.getDefinition())) return;
  event.handled = true;
  applyLight(player, event.item, lights.get(core.ItemIdentifiers.UNLIT_TORCH));
}

/** "Extinguish" on the lit mining helmet (5013): the unlit one (5014), on the same instance. */
function extinguishHelmet({ player, item }) {
  if (item?.getId() !== core.ItemIdentifiers.MINING_HELMET) return false;
  item.setId(core.ItemIdentifiers.MINING_HELMET_2);
  player.getInventory().refreshItems();
  return true;
}

/** Extinguish only the clicked torch, unless it is the last light in the dark. */
function extinguishTorch({ player, item }) {
  if (item?.getId() !== core.ItemIdentifiers.LIT_TORCH) return false;
  const inDarkness = Darkness.LUMBRIDGE_SWAMP_CAVES_BOUNDS.some((bounds) => bounds.inside(player.getLocation()));
  if (inDarkness && !Darkness.hasLightSource(player, item)) return true;
  item.setId(core.ItemIdentifiers.UNLIT_TORCH);
  player.getInventory().refreshItems();
  return true;
}

/**
 * Lit item id -> its put-out form, for every flame a fall into water puts out (Wiki: failing a
 * Lumbridge Swamp Caves stepping stone "will extinguish the player's light source"): torches,
 * candles, candle lanterns, oil lamps and lanterns (left filled) and the mining helmet.
 */
function putOutForms(I) {
  return new Map([
    [I.LIT_TORCH, I.UNLIT_TORCH],
    [I.LIT_CANDLE, I.CANDLE],
    [I.LIT_BLACK_CANDLE, I.BLACK_CANDLE],
    [I.CANDLE_LANTERN_3, I.CANDLE_LANTERN], // white
    [I.CANDLE_LANTERN_6, I.CANDLE_LANTERN_4], // black
    [I.OIL_LAMP_3, I.OIL_LAMP],
    [I.OIL_LANTERN_3, I.OIL_LANTERN],
    [I.BULLSEYE_LANTERN_3, I.BULLSEYE_LANTERN],
    [I.SAPPHIRE_LANTERN_3, I.SAPPHIRE_LANTERN_2],
    [I.EMERALD_LANTERN_2, I.EMERALD_LANTERN],
    [I.MINING_HELMET, I.MINING_HELMET_2],
  ].filter(([from, to]) => Number.isInteger(from) && Number.isInteger(to)));
}

let putOut;

/** Puts out every lit light the player carries or wears. Returns how many went out. */
function extinguishAll(player) {
  if (!core || !player) return 0;
  putOut ??= putOutForms(core.ItemIdentifiers);
  let count = 0;
  for (const container of [player.getInventory(), player.getEquipment()]) {
    let changed = false;
    for (const item of container?.getItems?.() ?? []) {
      const unlit = item && putOut.get(item.getId());
      if (unlit === undefined) continue;
      item.setId(unlit);
      changed = true;
      count++;
    }
    if (changed) container.refreshItems();
  }
  if (count > 0 && player.getEquipment) player.getUpdateFlag?.().flag?.(core.Flag.APPEARANCE);
  return count;
}

module.exports = {
  name: "LightSources",
  description: "Lets a tinderbox light unlit torches, candles and lanterns at the right Firemaking level, and lets lit torches and mining helmets be put out again.",
  members: true,
  register(api) {
    core = api.core;
    lights = build(core.ItemIdentifiers);
    api.onItemOnItem(light, { noted: false });
    api.onItemOnItem(assembleCandleLantern, { noted: false });
    api.onItemOnObject(lightOnObject, { noted: false });
    api.onItemAction("Mining helmet", { Extinguish: extinguishHelmet });
    api.onItemAction("Lit torch", { Extinguish: extinguishTorch });
  },
  extinguishAll,
  _test: { build, lightOnObject, putOutForms },
};
