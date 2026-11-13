/**
 * Ferocious gloves (docs/ferocious-gloves.md): the Lithkren Vault machinery that turns hydra
 * leather into ferocious gloves and back, and the hydra leather's Inspect.
 *
 * The machine is the multiloc ds2_lithkren_vault_machine01, which shows the "Investigate" variant
 * (ds2_lithkren_vault_machine01_complete) only once Dragon Slayer II's varbit reaches its end.
 *
 * Sources (rsprox.net index, rev 224/231):
 * - rec 1527 tick 11 and rec 722 tick 470: Investigate with neither the leather nor the gloves
 *   gives the "looks dormant" message box;
 * - rec 1526 tick 817: with the leather but no hammer, "You need a hammer to use the machine.";
 * - rec 1527 ticks 19 and 38, rec 1526 tick 895: with the gloves, then with the leather, a Yes/No
 *   menu; Yes plays human_smithing, 4 ticks later human_casting with sound 140, and 3 ticks after
 *   that the item is swapped and shown in an item box with the line also in the chat. Walk clicks
 *   during it (rec 1526 tick 899) did not stop it;
 * - rec 1521 ticks 1472 and 2391: the hydra leather's Inspect item box.
 *
 * Ours: using the leather or gloves on the machine runs the same as Investigate (the Wiki says to
 * use the leather on it; no capture shows it), the leather wins when both are carried, and the
 * no-hammer check comes after the dormant one.
 */
const { PRESET_TEXT } = require("./PoweredStaff");

const MACHINE = "ds2_lithkren_vault_machine01";
const MACHINE_COMPLETE = "ds2_lithkren_vault_machine01_complete";
const LEATHER = "hydra_leather";
const GLOVES = "ferocious_gloves";

const DORMANT = "The machine seems to have a depression and various mechanisms. It looks dormant.";
const NO_HAMMER = "You need a hammer to use the machine.";
const INSPECT = "This leather looks pretty tough to work with... Maybe the dragonkin had a way.";

const RECIPES = [
  {
    from: LEATHER,
    to: GLOVES,
    question: "Are sure you want to make some ferocious gloves?",
    done: "By feeding the tough to work leather through the machine, you manage to form a pair of gloves.",
  },
  {
    from: GLOVES,
    to: LEATHER,
    question: "Would you like to revert your ferocious gloves into hydra leather?",
    done: "By feeding the gloves through the machine, you manage to revert them into leather.",
  },
];

/** Ticks from the Yes to human_casting with its sound, and to the swap (captures 1526, 1527). */
const CAST_TICK = 4;
const DONE_TICK = 7;
const SMITHING_SEQ = "human_smithing";
const CASTING_SEQ = "human_casting";
const SOUND = 140;

let api;
let core;
const busy = new WeakSet();

const obj = (gameval) => core.CacheDefinitions.getObjId(gameval);
const loc = (gameval) => core.CacheDefinitions.getLocId(gameval);

function box(player, text, itemId = null) {
  const { DialogueChainBuilder, StatementDialogue, ItemStatementDialogue, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    itemId == null ? new StatementDialogue(0, text) : new ItemStatementDialogue(0, itemId, text),
    new EndDialogue(1),
  ));
}

function hasHammer(player) {
  const { ItemIdentifiers: I, Equipment } = core;
  const hammers = [I.HAMMER, I.IMCANDO_HAMMER, I.IMCANDO_HAMMER_OFF_HAND_];
  const equipment = player.getEquipment();
  const held = [Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT].map((slot) => equipment.get(slot)?.getId?.());
  return hammers.some((id) => player.getInventory().contains(id) || held.includes(id));
}

/** The machine as this player sees it: the working variant only after Dragon Slayer II. */
function working(player, objectId) {
  if (objectId !== loc(MACHINE) && objectId !== loc(MACHINE_COMPLETE)) return false;
  return core.ObjectDefinition.forPlayer(objectId, player)?.id === loc(MACHINE_COMPLETE);
}

/** The slot of a plain (non-preset) copy of `gameval`, or -1. */
function plainSlot(player, gameval) {
  const id = obj(gameval);
  return player.getInventory().getItems().findIndex((item) => item?.getId() === id && item.isPresetItem?.() !== true);
}

function recipeFor(player) {
  const inventory = player.getInventory();
  return RECIPES.find((recipe) => inventory.contains(obj(recipe.from))) ?? null;
}

function sequence(player, gameval) {
  const id = core.CacheDefinitions.getSeqId(gameval);
  if (id != null) player.performAnimation(new core.Animation(id));
}

function finish(player, recipe) {
  busy.delete(player);
  const slot = plainSlot(player, recipe.from);
  if (slot < 0) return;
  // The new item takes the old one's slot (captures 1526, 1527: slot 2 both ways).
  player.getInventory().setItem(slot, new core.Item(obj(recipe.to), 1)).refreshItems();
  box(player, recipe.done, obj(recipe.to));
}

function feed(player, recipe) {
  player.getPacketSender().sendInterfaceRemoval();
  if (busy.has(player) || plainSlot(player, recipe.from) < 0 || !hasHammer(player)) return;
  busy.add(player);
  sequence(player, SMITHING_SEQ);
  let elapsed = 0;
  core.TaskManager.submit(new (class FerociousGlovesTask extends core.Task {
    constructor() { super(1, player, false); }
    execute() {
      elapsed++;
      if (elapsed === CAST_TICK) {
        sequence(player, CASTING_SEQ);
        player.getPacketSender().sendSound(SOUND, 1, 0);
      }
      if (elapsed < DONE_TICK) return;
      this.stop();
      finish(player, recipe);
    }
  })());
}

function useMachine(player) {
  const recipe = recipeFor(player);
  if (!recipe) {
    box(player, DORMANT);
    return;
  }
  if (!hasHammer(player)) {
    box(player, NO_HAMMER);
    return;
  }
  if (plainSlot(player, recipe.from) < 0) {
    box(player, PRESET_TEXT);
    return;
  }
  api.sendMultiChatboxPrompt(player, recipe.question,
    "Yes.", () => feed(player, recipe),
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
}

function investigate({ player, objectId }) {
  if (!working(player, objectId)) return false;
  useMachine(player);
  return true;
}

function useOnMachine({ player, objectId }) {
  if (!working(player, objectId)) return false;
  useMachine(player);
  return true;
}

function inspectLeather({ player, itemId }) {
  box(player, INSPECT, itemId);
}

module.exports = {
  name: "FerociousGloves",
  description: "Ferocious gloves: the Lithkren Vault machinery makes them from hydra leather and reverts them, with a hammer, after Dragon Slayer II; and the leather's Inspect.",
  members: true,
  _test: { RECIPES, DORMANT, NO_HAMMER, INSPECT, CAST_TICK, DONE_TICK, SOUND, investigate, useOnMachine, inspectLeather },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onObjectInteraction("Machinery", { Investigate: investigate });
    api.onItemOnObject("Hydra leather", "Machinery", useOnMachine, { noted: false });
    api.onItemOnObject("Ferocious gloves", "Machinery", useOnMachine, { noted: false });
    api.onItemAction("Hydra leather", { Inspect: inspectLeather });
  },
};
