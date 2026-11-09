/**
 * Pennant (Tirannwn, 3292,6120): the crystal tree seedsman who trades a crystal weapon, armour or
 * tool seed for a crystal acorn (Transcript:Pennant).
 *
 * The Wiki transcript (Transcript:Pennant) leaves one step as `missing` because the dump cannot express
 * the seed the player chooses; the plugin fills it with the transcript's own wording, not invented text:
 *  - it answers the two `condition` prose steps ("a suitable crystal seed in their inventory") by
 *    what the player carries,
 *  - on the branch where the player has a seed it shows "Select an option" with "Offer <seed>." and
 *    "Cancel." (Pennant accepts any one of the three seeds, noted or not),
 *  - offering one names the trade in an item box ("You are about to trade 1 x <seed> for 1 x Crystal
 *    acorn."), asks "Are you sure you wish to continue?" (Yes. / Yes, and don't ask again. / No.), and
 *    then takes the seed and gives the acorn.
 *
 * The acorn's obtain is Pennant's own event ("pennant:crystal-acorn"), so the league's
 * "Receive a Crystal Acorn from Pennant" credits only his exchange, not a crystal impling's or the
 * Elven Crystal Chest's acorn.
 */
const SEED_KEYS = ["CRYSTAL_WEAPON_SEED", "CRYSTAL_ARMOUR_SEED", "CRYSTAL_TOOL_SEED"];

/** The prose conditions by the id of the wiki `tcond` they guard (each seed check is one answer). */
const NO_SEED_CONDITIONS = new Set(["ALgg5h", "-X_0_Y"]);
const HAS_SEED_CONDITIONS = new Set(["seWDU3", "Yg10Dx"]);
/** The `missing` steps those true branches fall into, which the plugin fills with the trade. */
const TRADE_STEPS = new Set(["-N8YQe", "jmiq6v"]);

/** Event objects whose missing step has already been filled: a WeakSet so a finished dialogue is not retained past playback. */
const seen = new WeakSet();

let api = null;

const name = (key) => String(api.core.CacheDefinitions.getItem(api.core.ItemIdentifiers[key])?.name ?? key);
const acorn = () => api.core.ItemIdentifiers.CRYSTAL_ACORN;

/** The first crystal seed the player carries, or null. */
function heldSeed(player) {
  const inventory = player.getInventory();
  for (const key of SEED_KEYS) {
    const item = api.core.ItemIdentifiers[key];
    if (item >= 0 && inventory.getAmount(item) > 0) return { key, item, name: name(key) };
  }
  return null;
}

function onCondition({ player, stepId }) {
  if (!player || (!NO_SEED_CONDITIONS.has(stepId) && !HAS_SEED_CONDITIONS.has(stepId))) return null;
  const has = heldSeed(player) !== null;
  return HAS_SEED_CONDITIONS.has(stepId) ? has : !has;
}

/**
 * The transcript's true branch, as the Wiki records it (Transcript:Pennant): the player picks which seed
 * to offer, then an item box states the seed traded for the acorn, "Are you sure you wish to continue?"
 * offers Yes / Yes, and don't ask again / No, and each consenting answer hands over the acorn. The dump
 * cannot express the seed menu ("this server's dump cannot express the seed the player chooses"), which
 * is why the branch is a `missing` step.
 */
function offerMenu(seed) {
  return [
    { type: "choice", prompt: "Select an option", options: [
      { text: `Offer ${seed.name}.`, steps: [{ type: "action", action: "pennant-offer", seed: seed.key }] },
      { text: "Cancel.", steps: [{ type: "end" }] },
    ] },
  ];
}

/**
 * The seed the sequence started with; the confirm asks about that one seed, not whatever is held now.
 * The dialogue runtime emits an action step with its whole `step` on the event, so the key is read off
 * that (a test may pass it directly).
 */
function offeredSeed(event) {
  const key = event.seed ?? event.step?.seed;
  return SEED_KEYS.includes(key)
    ? { key, item: api.core.ItemIdentifiers[key], name: name(key) }
    : null;
}

/** One offer of a seed: an item box naming the trade, then the confirm. */
function offerSteps(seed) {
  return [
    { type: "message", text: `You are about to trade 1 x ${seed.name} for 1 x ${name("CRYSTAL_ACORN")}.`, box: { items: [acorn()] } },
    { type: "choice", prompt: "Are you sure you wish to continue?", options: [
      { text: "Yes.", steps: [{ type: "action", action: "pennant-trade", seed: seed.key }] },
      { text: "Yes, and don't ask again.", steps: [{ type: "action", action: "pennant-trade", seed: seed.key }] },
      { text: "No.", steps: [{ type: "end" }] },
    ] },
  ];
}

/** Fills the dump's `missing` step with the transcript's seed menu (only where the player really has one). */
function onAction(event) {
  if (!event.player || !TRADE_STEPS.has(event.stepId) || seen.has(event)) return;
  seen.add(event);
  const seed = heldSeed(event.player);
  // The Wiki's "if the player has a suitable seed" branch: a player who holds none (the dump cannot ask
  // that condition here) is declined with the transcript's own line rather than shown a menu of nothing.
  event.handled = true;
  event.steps = seed ? offerMenu(seed) : [
    { player: "Actually... I don't think I've got any crystal seeds to trade, right now." },
    { type: "end" },
  ];
}

/** The player chose which seed to offer: the box and confirm that seed's trade. */
function offer(event) {
  if (event.action !== "pennant-offer" || !event.player || event.handled) return;
  const seed = offeredSeed(event);
  if (!seed || seed.item < 0) return;
  event.handled = true;
  event.steps = offerSteps(seed);
}

/**
 * The chosen seed is taken and the acorn given; the acorn's obtain is Pennant's own event. The
 * transcript's line ("Player receives a crystal acorn") is an action, so nothing is said.
 */
function doTrade(event) {
  if (event.action !== "pennant-trade" || !event.player || event.handled) return;
  const player = event.player;
  const seed = offeredSeed(event) ?? heldSeed(player);
  if (!seed || seed.item < 0) return;
  const acornId = acorn();
  if (acornId < 0) return;
  event.handled = true;
  // The seed chosen can leave the pack while the confirm is open; then nothing more is said (the
  // transcript gives no line) and the acorn is not given.
  if (player.getInventory().getAmount(seed.item) < 1) return;
  // As any other hand-out: the pack is full.
  if (player.getInventory().getAddableAmount(new api.core.Item(acornId, 1)) < 1) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  player.getInventory().deleteNumber(seed.item, 1);
  player.getInventory().adds(acornId, 1);
  api.emitCustomEvent("pennant:crystal-acorn", { player, itemId: acornId });
}

module.exports = {
  name: "Pennant",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.onNpcDialogueCondition(onCondition);
    api.onCustomEvent("npc-dialogue:action", onAction);
    api.onCustomEvent("npc-dialogue:action", offer);
    api.onCustomEvent("npc-dialogue:action", doTrade);
  },
  _test: { heldSeed, offerMenu, offerSteps, onCondition, onAction, offer, doTrade, SEED_KEYS, NO_SEED_CONDITIONS, HAS_SEED_CONDITIONS, TRADE_STEPS },
};
