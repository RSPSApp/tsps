/**
 * Pennant (Tirannwn, 3292,6120): the crystal tree seedsman who trades a crystal weapon, armour or
 * tool seed for a crystal acorn (Transcript:Pennant).
 *
 * The Wiki transcript leaves the actual exchange as a `missing` step (this server's dump cannot
 * express the seed the player chooses), so the plugin supplies it:
 *  - it answers the two `condition` prose steps ("a suitable crystal seed in their inventory") by
 *    what the player carries, and
 *  - on the branches where the player has a seed, it fills that branch's `missing` step with the
 *    OSRS trade the transcript omits: an item box naming the seed traded for the acorn, a Yes/No
 *    confirm, then the seed is taken and the acorn given.
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

const seen = new Set();

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

/** The trade the transcript leaves as `missing`: the seed named, a confirm, then the swap. */
function tradeSteps(seed) {
  return [
    { type: "message", text: `You are about to trade 1 x ${seed.name} for 1 x ${name("CRYSTAL_ACORN")}.`, box: { items: [acorn()] } },
    { type: "choice", prompt: "Are you sure you wish to continue?", options: [
      { text: "Yes.", steps: [{ type: "action", action: "pennant-trade", seed: seed.key }] },
      { text: "Yes, and don't ask again.", steps: [{ type: "action", action: "pennant-trade", seed: seed.key }] },
      { text: "No.", steps: [{ type: "end" }] },
    ] },
  ];
}

/** Fills the dump's `missing` step with the exchange (only where the player really has a seed). */
function onAction(event) {
  if (!event.player || !TRADE_STEPS.has(event.stepId) || seen.has(event)) return;
  seen.add(event);
  const seed = heldSeed(event.player);
  if (!seed) return;
  event.handled = true;
  event.steps = tradeSteps(seed);
}

/** The chosen seed is taken and the acorn given; the acorn's obtain is Pennant's own event. */
function doTrade(event) {
  if (event.action !== "pennant-trade" || !event.player || event.handled) return;
  const player = event.player;
  const seed = SEED_KEYS.includes(event.seed)
    ? { key: event.seed, item: api.core.ItemIdentifiers[event.seed], name: name(event.seed) }
    : heldSeed(player);
  if (!seed || seed.item < 0) return;
  const acornId = acorn();
  if (acornId < 0) return;
  event.handled = true;
  if (player.getInventory().getAmount(seed.item) < 1) {
    player.sendMessage("You don't have a suitable crystal seed to trade.");
    return;
  }
  if (player.getInventory().getAddableAmount(new api.core.Item(acornId, 1)) < 1) {
    player.sendMessage("You don't have enough room for the crystal acorn.");
    return;
  }
  player.getInventory().deleteNumber(seed.item, 1);
  player.getInventory().adds(acornId, 1);
  player.sendMessage(`Pennant takes your ${seed.name} and gives you a ${name("CRYSTAL_ACORN")}.`);
  api.emitCustomEvent("pennant:crystal-acorn", { player, itemId: acornId });
}

module.exports = {
  name: "Pennant",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.onNpcDialogueCondition(onCondition);
    api.onCustomEvent("npc-dialogue:action", onAction);
    api.onCustomEvent("npc-dialogue:action", doTrade);
  },
  _test: { heldSeed, tradeSteps, onCondition, onAction, doTrade, SEED_KEYS, NO_SEED_CONDITIONS, HAS_SEED_CONDITIONS, TRADE_STEPS },
};
