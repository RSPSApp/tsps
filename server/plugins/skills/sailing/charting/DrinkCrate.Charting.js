// Drink crates (rsprox, 24 recordings): a sealed crate (59283) at each drink task's spot, pried
// open from the deck with a crowbar for that spot's drink; drinking it charts the task (75 XP).
//   Pry-open: the helm let go of; with no crowbar: "You require a crowbar to do that."; else
//   sound 67 and the drink with "You pry open the crate and take a bottle of {drink} to sample.",
//   or "The crate contains a bottle of {drink}, but you don't take it as you already have one."
//   Drink: unless told not to ask again, the box "This drink has been sealed in a crate for an
//   unknown amount of time. It could do anything to you, good or bad. Are you sure you want to
//   drink it?" and the choice "Yes. / Yes, and don't ask again. / No." Then "You drink the bottle
//   of {drink}." with the drink's own lines, the drinking animation and graphic, sound 2401, the
//   bottle gone, and the charting.
const common = require("./Common.Charting");
const poteen = require("./Poteen.Charting");
const effects = require("./DrinkEffects.Charting");
const fishier = require("./FishierStout.Charting");

const LOC_CRATE = 59283;
const ITEM_CROWBAR = 31807;
const SEQ_DRINK = 11288; // wgs_thaersk_drinks_potion
const SPOTANIM_DRINK = 2871; // wgs_truth_potion_spot
const SPOTANIM_HEIGHT = 92;
const SOUND_PRY = 67;
const SOUND_DRINK = 2401;
const VARBIT_NO_WARNING = 19609; // sailing_charting_drink_crate_warning
const LEVEL = 12;
const PRYING_TIMES_DRINK = "drink_crate_prying_times";
/** Drinking warns until told not to (persisted, sent at login as its varbit). */
const NO_WARNING_ATTRIBUTE = "charting:drink-no-warning";
/** All Settings > Warnings: "Forgotten drink crate warning", the warning's own "don't ask again". */
const WARNING_SETTING = 455;

const NO_CROWBAR = "You require a crowbar to do that.";
const NO_ROOM = "You don't have enough inventory space.";
const WARNING = "This drink has been sealed in a crate for an unknown amount of time. It could do anything to you, good or bad. Are you sure you want to drink it?";
const CHOICE = "Are you sure you want to drink this?";

let byItem;
const pendingChoices = new WeakMap();

function interfaceChanged({ player, interfaceId }) {
  // A bank/trade/modal takes ownership before the old chatbox option can resume.
  // MultiChatboxPrompt closes interfaces (and clears status) before its callback runs.
  if (interfaceId < 0) return;
  const target = pendingChoices.get(player);
  if (target) target.cancelled = true;
  pendingChoices.delete(player);
}

function onLogout({ player }) {
  const target = pendingChoices.get(player);
  if (target) target.cancelled = true;
  pendingChoices.delete(player);
}

/** Each drink task's crate tile and drink item: the item named after the task (31831-31905). */
function drinks() {
  if (byItem) return byItem;
  const { CacheDefinitions } = common.core();
  byItem = new Map();
  for (const spot of common.spotsOfType("drink_crate")) {
    const item = CacheDefinitions.getObjId(`sailing_charting_${spot.key}`);
    if (item === null || item === undefined) continue;
    spot.item = item;
    byItem.set(item, spot);
  }
  return byItem;
}

function drinkName(spot) {
  return spot.drink?.name ?? (common.core().CacheDefinitions.getItem(spot.item)?.name ?? "drink").replace(/^Bottle of /, "").toLowerCase();
}

function crateAt(x, y) {
  return common.spotsOfType("drink_crate").find((spot) => spot.location?.[0] === x && spot.location?.[1] === y);
}

function itemBox(player, item, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = common.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, item, text)));
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  common.api().emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function pryOpen(event) {
  if (event.objectId !== LOC_CRATE || event.clickType !== 1) return;
  const spot = crateAt(event.location.x, event.location.y);
  if (!spot) return;
  event.handled = true;
  const { player } = event;
  drinks();
  common.leaveHelm(player);
  if (!player.getInventory().contains(ITEM_CROWBAR)) {
    common.core().StatementDialogue.send(player, NO_CROWBAR);
    return;
  }
  // Prying Times unlocks the crates; ours: under it or 12 Sailing, the crate stays shut.
  if (!questComplete(player, "prying_times") || player.getSkillManager().getCurrentLevel(common.core().Skill.SAILING) < LEVEL) {
    common.core().StatementDialogue.send(player, NO_CROWBAR);
    return;
  }
  const name = drinkName(spot);
  if (player.getInventory().contains(spot.item)) {
    itemBox(player, spot.item, `The crate contains a bottle of ${name}, but you don't take it as you already have one.`);
    return;
  }
  const bottle = new (common.core().Item)(spot.item, 1);
  // Ours: a full inventory isn't captured; the crate stays shut, as the other charting rewards do.
  if (player.getInventory().getAddableAmount(bottle) < 1) {
    player.sendMessage(NO_ROOM);
    return;
  }
  player.getPacketSender().sendSoundEffect(SOUND_PRY, 1, 0);
  player.getInventory().add(bottle, true);
  itemBox(player, spot.item, `You pry open the crate and take a bottle of ${name} to sample.`);
}

function drink(event) {
  const spot = drinks().get(event.itemId);
  if (!spot || event.option !== "Drink") return;
  const { player } = event;
  // Until Prying Times is done its stout is the quest's to drink.
  if (spot.key === PRYING_TIMES_DRINK && !questComplete(player, "prying_times")) return;
  event.handled = true;
  const target = { slot: event.slot, item: player.getInventory().getItems()[event.slot] };
  pendingChoices.set(player, target);
  const consume = () => swallow(player, spot, target);
  if (spot.key === fishier.KEY) return fishier.warn(player, consume);
  if (player.getAttribute(NO_WARNING_ATTRIBUTE) === true) {
    consume();
    return;
  }
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = common.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new StatementDialogue(0, WARNING))
    .add(new ActionDialogue(1, { execute: () => choose(player, consume) })));
}

function choose(player, consume) {
  common.api().sendMultiChatboxPrompt(player, CHOICE,
    "Yes.", consume,
    "Yes, and don't ask again.", () => {
      setNoWarning(player, true);
      consume();
    },
    "No.", () => {});
}

function swallow(player, spot, target) {
  const { PlayerStatus } = common.core();
  if (player.isRegistered?.() === false || player.getHitpoints?.() <= 0
    || (player.getStatus && player.getStatus() !== PlayerStatus.NONE)) return;
  if (target && (target.cancelled || pendingChoices.get(player) !== target
    || player.getInventory().getItems()[target.slot] !== target.item
    || target.item?.getId() !== spot.item || target.item.getAmount() < 1)) return;
  if (!player.getInventory().contains(spot.item)) return;
  pendingChoices.delete(player);
  const { Animation, Graphic } = common.core();
  if (target) player.getInventory().deleteAtSlot(target.slot, 1, true);
  else player.getInventory().delete(spot.item, 1);
  player.performAnimation(new Animation(SEQ_DRINK));
  player.performGraphic(new Graphic(SPOTANIM_DRINK, 0, SPOTANIM_HEIGHT));
  player.getPacketSender().sendSoundEffect(SOUND_DRINK, 1, 0);
  common.complete(player, spot, { lines: [`You drink the bottle of ${drinkName(spot)}.`, ...(spot.drink?.lines ?? [])] });
  if (spot.key === "drink_crate_puzzlers_poteen") poteen.start(player);
  effects.start(player, spot);
  if (spot.key === fishier.KEY) fishier.start(player);
}

/** The crates, placed where every drink task's crate floats (rsprox: the Wiki's tiles, shape 10). */
function placeCrates() {
  const { GameObject, Location, ObjectManager } = common.core();
  for (const spot of common.spotsOfType("drink_crate")) {
    // Prying Times keeps its own crate (58405) on the grog's tile.
    if (!spot.location || spot.key === PRYING_TIMES_DRINK) continue;
    ObjectManager.register(new GameObject(LOC_CRATE, new Location(spot.location[0], spot.location[1], 0), 10, 0, null), true);
  }
}

function setNoWarning(player, noWarning) {
  player.setAttribute(NO_WARNING_ATTRIBUTE, noWarning);
  player.getPacketSender().sendVarbit(VARBIT_NO_WARNING, noWarning ? 1 : 0);
}

function warningSettingClicked(request) {
  if (request.settingId !== WARNING_SETTING) return;
  request.handled = true;
  setNoWarning(request.player, request.player.getAttribute(NO_WARNING_ATTRIBUTE) !== true);
}

function onLogin({ player }) {
  if (player.getAttribute(NO_WARNING_ATTRIBUTE) === true) player.getPacketSender().sendVarbit(VARBIT_NO_WARNING, 1);
}

function attach(api) {
  common.init(api);
  poteen.attach(api);
  effects.attach(api);
  fishier.attach(api);
  require("./TrollCombat.Charting")(api);
  api.persistAttribute(NO_WARNING_ATTRIBUTE, false);
  api.setUsableFromDeck([LOC_CRATE]);
  api.onObjectInteraction(pryOpen);
  api.onItemAction(drink);
  api.onServerStartup(placeCrates);
  api.onPlayerLogin(onLogin);
  api.onCustomEvent("settings:setting-clicked", warningSettingClicked);
  api.onPlayerLogout(onLogout);
  api.onCustomEvent("interface:changed", interfaceChanged);
}

module.exports = attach;
module.exports.pryOpen = pryOpen;
module.exports.drink = drink;
module.exports.swallow = swallow;
module.exports.drinks = drinks;
module.exports.warningSettingClicked = warningSettingClicked;
module.exports.NO_WARNING_ATTRIBUTE = NO_WARNING_ATTRIBUTE;
