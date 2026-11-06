"use strict";

const { H, ANIM, level, requireLevel, hasTool, nearby, roll, exchange, drop, xp, begin } = require("./Context.Hunter");
const ATTRIBUTE = "hunter.birdhouses";
const DURATION = 50 * 60 * 1000;
const SEEDS = 10;
// Wiki Bird house trapping: raw bird meat always goes to the floor; feathers come in tens.
const BIRDS = 10;
const FEATHERS = [30, 40, 50, 60];
const PICKUP_SOUND = 2433;
const MAKE_SOUND = 2605;
// Hunter actions reset the player's animation before finishing; -1 starts none of its own.
const NO_ANIMATION = -1;
const bases = new Map();
const lastConfigs = new WeakMap();

function initialize() {
  bases.clear();
  for (let id = 0; id < H.core.CacheDefinitions.getCounts().objects; id++) {
    const def = H.core.CacheDefinitions.getObject(id);
    if (def.transforms?.[0] === H.core.ObjectIdentifiers.SPACE && def.transformVarp >= 0) bases.set(id, def);
  }
}

function houses(player) {
  let state = player.getAttribute(ATTRIBUTE);
  if (!state || typeof state !== "object" || Array.isArray(state)) { state = {}; player.setAttribute(ATTRIBUTE, state); }
  return state;
}

function valid(state) {
  return state && Number.isInteger(state.tier) && state.tier >= 0 && state.tier < H.data.birdhouses.length
    && Number.isInteger(state.seeds) && state.seeds >= 0 && state.seeds <= 10 && Number.isFinite(state.filled) && state.filled >= 0;
}

/** Multiloc variant: 0 waiting for seed, 2 once full (live sends the Empty/Reset variant as the
 * last seed goes in, not the Dismantle one). */
function status(state) {
  return state.seeds < SEEDS ? 0 : 2;
}

function ready(state) {
  return state.seeds >= SEEDS && Date.now() >= state.filled + DURATION;
}

/** Seed left: one bird is caught, and one seed eaten, every tenth of the wait. */
function seedLevel(state) {
  if (state.seeds < SEEDS) return state.seeds;
  return Math.max(0, SEEDS - Math.floor((Date.now() - state.filled) / (DURATION / BIRDS)));
}

function statement(player, text) {
  player.getDialogueManager().startDialogues(new H.core.DialogueChainBuilder().add(new H.core.StatementDialogue(0, text)));
}

function pickup(player) {
  player.performAnimation(new H.core.Animation(ANIM.PICKUP));
  player.getPacketSender().sendSound(PICKUP_SOUND, 1, 0);
}

function sync({ player }, force = false) {
  const state = houses(player);
  let previous = lastConfigs.get(player);
  if (!previous || force) { previous = new Map(); lastConfigs.set(player, previous); }
  for (const [id, def] of bases) {
    const house = state[id];
    const value = valid(house) ? 1 + house.tier * 3 + status(house) : 0;
    if (previous.get(id) !== value) { player.getPacketSender().sendConfig(def.transformVarp, value); previous.set(id, value); }
  }
}

function login(event) { sync(event, true); }

/** Captures: a carried birdhouse goes down on the arrival tick, with no message. */
function place(player, object, tier) {
  if (!bases.has(object.getId()) || !nearby(player, object) || !requireLevel(player, tier.level)) return;
  const state = houses(player);
  if (valid(state[object.getId()])) { player.sendMessage("There is already a birdhouse here."); return; }
  if (player.busy() || H.actions.has(player) || !exchange(player, [[tier.item, 1]], [])) return;
  pickup(player);
  state[object.getId()] = { tier: tier.index, seeds: 0, filled: 0 };
  sync({ player });
}

function seedValue(itemId) {
  const I = H.core.ItemIdentifiers;
  const low = [I.GUAM_SEED, I.MARRENTILL_SEED, I.TARROMIN_SEED, I.HARRALANDER_SEED,
    I.BARLEY_SEED, I.HAMMERSTONE_SEED, I.ASGARNIAN_SEED, I.JUTE_SEED, I.YANILLIAN_SEED, I.KRANDORIAN_SEED,
    I.POTATO_SEED, I.ONION_SEED, I.CABBAGE_SEED, I.TOMATO_SEED, I.SWEETCORN_SEED, I.STRAWBERRY_SEED,
    I.REDBERRY_SEED, I.CADAVABERRY_SEED, I.DWELLBERRY_SEED, I.JANGERBERRY_SEED,
    I.MARIGOLD_SEED, I.ROSEMARY_SEED, I.NASTURTIUM_SEED, I.WOAD_SEED, I.LIMPWURT_SEED, I.WHITE_LILY_SEED,
    I.WATERMELON_SEED, I.SNAPE_GRASS_SEED, I.WHITEBERRY_SEED, I.POISON_IVY_SEED];
  // Wiki Bird house trapping/Seeds: only these take 5 to fill a house.
  const high = [I.RANARR_SEED, I.TOADFLAX_SEED, I.IRIT_SEED, I.AVANTOE_SEED, I.KWUARM_SEED,
    I.SNAPDRAGON_SEED, I.CADANTINE_SEED, I.LANTADYME_SEED, I.DWARF_WEED_SEED, I.TORSTOL_SEED,
    I.WILDBLOOD_SEED];
  return high.includes(itemId) ? 2 : low.includes(itemId) ? 1 : 0;
}

function seed(player, object, itemId) {
  const state = houses(player)[object.getId()];
  const value = seedValue(itemId);
  if (!valid(state)) { player.sendMessage("Build a birdhouse here first."); return; }
  if (!value) { player.sendMessage("You need suitable hop, herb, allotment, flower or bush seeds."); return; }
  if (state.seeds >= SEEDS) { player.sendMessage("This birdhouse is already full of seeds."); return; }
  const amount = Math.min(Math.ceil((SEEDS - state.seeds) / value), player.getInventory().getAmount(itemId));
  if (!amount || !exchange(player, [[itemId, amount]], [])) return;
  state.seeds = Math.min(SEEDS, state.seeds + amount * value);
  if (state.seeds === SEEDS) state.filled = Date.now();
  // rsprox captures (545-572, 1835-1851): seeding is a pick-up with its sound; a full house sends the
  // line as spam and in a message box.
  pickup(player);
  sync({ player });
  if (state.seeds === SEEDS) {
    const full = "Your birdhouse trap is now full of seed and will start to catch birds.";
    player.getPacketSender().sendTypedMessage(H.core.ChatType.SPAM, full);
    statement(player, full);
  } else player.sendMessage("You add some seeds to the birdhouse.");
}

function use(event) {
  if (!bases.has(event.objectId)) return;
  event.handled = true;
  if (!nearby(event.player, event.object)) return;
  const tier = H.data.birdhouses.find(t => t.item === event.itemId);
  if (tier) place(event.player, event.object, tier);
  else seed(event.player, event.object, event.itemId);
}

/** The best tier the player's logs, Hunter and Crafting levels allow. */
function logTier(player) {
  return [...H.data.birdhouses].reverse().find(t => player.getInventory().contains(t.logs)
    && level(player) >= t.level && level(player, H.core.Skill.CRAFTING) >= t.crafting);
}

/** Gives a clockwork held back for a rebuild to the player, or drops it when the bag is full. */
function returnClockwork(player) {
  const item = [H.core.ItemIdentifiers.CLOCKWORK, 1];
  if (!exchange(player, [], [item])) drop(player, [item], player.getLocation());
}

/**
 * Captures (recording 716): birdhouse_make, the birdhouse made two ticks later and placed a tick after that.
 * Reset passes `heldClockwork` when the emptied house's clockwork found no free slot: it goes straight
 * into the new house, and is given back (or dropped) if the rebuild stops.
 */
function makeAndPlace(player, object, delay = 0, heldClockwork = false) {
  const I = H.core.ItemIdentifiers;
  const giveBack = heldClockwork ? () => returnClockwork(player) : undefined;
  const making = () => {
    const tier = logTier(player);
    const fail = message => { player.sendMessage(message); giveBack?.(); };
    if (!tier) { fail("You need logs to make a birdhouse."); return; }
    if (!hasTool(player, I.HAMMER) || !hasTool(player, I.CHISEL)) { fail("You need a hammer and a chisel."); return; }
    const inputs = heldClockwork ? [[tier.logs, 1]] : [[tier.logs, 1], [I.CLOCKWORK, 1]];
    if (!exchange(player, inputs, [[tier.item, 1]])) { fail("You need a clockwork to make a birdhouse."); return; }
    player.getSkillManager().addExperiences(H.core.Skill.CRAFTING, tier.craftXp);
    begin(player, 1, NO_ANIMATION, () => place(player, object, tier));
  };
  const make = () => {
    if (!begin(player, 2, makeAnimation(player), making)) return;
    player.getPacketSender().sendSound(MAKE_SOUND, 1, 0);
  };
  if (delay) { if (!begin(player, delay, ANIM.PICKUP, making, giveBack)) giveBack?.(); }
  else make();
}

/** Wiki: a carried birdhouse is used first; otherwise one is made from logs on the spot. */
function build({ player, object }) {
  if (!bases.has(object.getId())) return false;
  if (!nearby(player, object)) return true;
  const carried = H.data.birdhouses.filter(t => player.getInventory().contains(t.item));
  const tier = [...carried].reverse().find(t => level(player) >= t.level);
  if (tier) place(player, object, tier);
  else if (carried.length) player.sendMessage("You do not have a birdhouse with the required hunter level to build here.");
  else makeAndPlace(player, object);
  return true;
}

function makeAnimation(player) {
  const I = H.core.ItemIdentifiers;
  return player.getEquipment().getItems().some(item => [I.IMCANDO_HAMMER, I.IMCANDO_HAMMER_OFF_HAND_].includes(item?.getId()))
    ? ANIM.BIRDHOUSE_IMCANDO : ANIM.BIRDHOUSE;
}

function craft(event) {
  const I = H.core.ItemIdentifiers;
  const pair = [event.usedItemId, event.usedWithItemId];
  const tier = H.data.birdhouses.find(t => pair.includes(t.logs));
  if (!tier || !pair.some(id => [I.CLOCKWORK, I.CHISEL, I.HAMMER].includes(id))) return;
  event.handled = true;
  const { player } = event;
  if (!requireLevel(player, tier.crafting, H.core.Skill.CRAFTING)) return;
  if (!hasTool(player, I.HAMMER) || !hasTool(player, I.CHISEL)) { player.sendMessage("You need a hammer and a chisel."); return; }
  const inputs = [[tier.logs, 1], [I.CLOCKWORK, 1]], outputs = [[tier.item, 1]];
  if (!exchange(player, inputs, outputs, false)) { player.sendMessage("You need logs and a clockwork, and room for the birdhouse."); return; }
  begin(player, 2, makeAnimation(player), () => {
    if (!requireLevel(player, tier.crafting, H.core.Skill.CRAFTING) || !hasTool(player, I.HAMMER) || !hasTool(player, I.CHISEL) || !exchange(player, inputs, outputs)) return;
    player.getSkillManager().addExperiences(H.core.Skill.CRAFTING, tier.craftXp);
    player.sendMessage("You craft a birdhouse.");
  });
}

function loot(player, state) {
  const I = H.core.ItemIdentifiers;
  const result = [[I.CLOCKWORK, 1], [I.FEATHER, FEATHERS[roll(0, FEATHERS.length - 1)]]];
  const hunter = level(player);
  if (Math.random() < require("./Context.Hunter").probability(0, 200, Math.min(99, hunter))) result.push([I.BIRD_NEST_4, 1]);
  const chance = [0.1, 0.125, 0.128, 0.13, 0.14, 0.15, 0.16, 0.17, 0.175][state.tier]
    * 3 * (hunter <= 50 ? 0.5 : 0.5 + (hunter - 50) / 98);
  let clueGiven = false;
  for (let i = 0; i < 5; i++) {
    if (Math.random() >= chance) continue;
    // ponytail: Wiki marks these clue-nest probabilities as approximate.
    if (!clueGiven) {
      let clue = null;
      for (const [tier, numerator] of [["ELITE",1],["HARD",2],["MEDIUM",3],["EASY",4],["BEGINNER",30]]) {
        // Content may make clue nests commoner ("treasure-trails:vessel-chance", a league relic).
        const boost = { player, vessel: "nest", tier: tier.toLowerCase(), multiplier: 1 };
        H.api.emitCustomEvent("treasure-trails:vessel-chance", boost);
        if (boost.allowed === false) continue;
        if (!require("./Context.Hunter").ownsClue(player,tier) && roll(1,1500) <= numerator * (boost.multiplier > 1 ? boost.multiplier : 1)) { clue = tier; break; }
      }
      if (clue) {
        const boxes = require("./Context.Hunter").questComplete(player,"x_marks_the_spot");
        result.push([I[`${boxes ? "SCROLL_BOX" : "CLUE_NEST"}_${clue}_`],1]);
        if (boxes) drop(player,[[I.BIRD_NEST_6,1]],player.getLocation());
        clueGiven = true; continue;
      }
    }
    const foot = player.getEquipment().getItems().some(item => item?.getId() === I.STRUNG_RABBIT_FOOT);
    const draw = roll(1, foot ? 95 : 100);
    const nest = draw <= 65 - (foot ? 5 : 0) ? I.BIRD_NEST_6 : draw <= (foot ? 92 : 97) ? I.BIRD_NEST_5 : [I.BIRD_NEST, I.BIRD_NEST_2, I.BIRD_NEST_3][roll(0, 2)];
    result.push([nest, 1]);
  }
  return result;
}

function nests(items) {
  const count = items.filter(([id]) => /^(Bird|Clue) nest/.test(H.core.ItemDefinition.forId(id).getName())).length;
  return count === 1 ? "a nest" : `${count} nests`;
}

/**
 * Empties a full birdhouse (captures: human_pickupfloor a tick after arrival, ten raw bird meat on
 * the floor, the loot and one summary message). Reset then makes and places a new one from logs,
 * reusing the clockwork: the logs are checked two ticks after the empty (recording 716).
 */
function collect(event, destroy = false, rebuild = false) {
  const { player, object } = event;
  if (!bases.has(object.getId())) return false;
  if (!nearby(player, object)) return true;
  const state = houses(player)[object.getId()];
  if (!valid(state)) return true;
  if (!destroy && !ready(state)) {
    player.sendMessage(state.seeds < SEEDS ? "The birdhouse needs more seeds." : `The birdhouse will be ready in ${Math.ceil((state.filled + DURATION - Date.now()) / 60000)} minutes.`);
    return true;
  }
  begin(player, 1, NO_ANIMATION, () => {
    if (houses(player)[object.getId()] !== state) return;
    pickup(player);
    const items = destroy ? [[H.core.ItemIdentifiers.CLOCKWORK, 1]] : loot(player, state);
    delete houses(player)[object.getId()];
    // Reset keeps a clockwork that doesn't fit for the new house rather than dropping it.
    let held = false;
    for (const item of items) {
      if (exchange(player, [], [item])) continue;
      if (rebuild && item[0] === H.core.ItemIdentifiers.CLOCKWORK) held = true;
      else drop(player, [item], player.getLocation());
    }
    sync({ player });
    if (destroy) { player.sendMessage("You dismantle the birdhouse and recover the clockwork."); return; }
    drop(player, [[H.core.ItemIdentifiers.RAW_BIRD_MEAT, BIRDS]], player.getLocation());
    const hunterXp = H.data.birdhouses[state.tier].xp;
    xp(player, hunterXp, "birdhouse");
    const feathers = items.find(([id]) => id === H.core.ItemIdentifiers.FEATHER)[1];
    player.sendMessage(`You dismantle and discard the trap, retrieving ${nests(items)}, ${BIRDS} dead birds, ${feathers} feathers and ${hunterXp} Hunter XP.`);
    if (rebuild) makeAndPlace(player, object, 2, held);
  });
  return true;
}

function empty(event) { return collect(event); }
function reset(event) { return collect(event, false, true); }
function dismantle(event) { return collect(event, true); }

/** Seeds: the seed level only (captures 545, 1863, 1875); seeds go in by using them on the house. */
function seeds({ player, object }) {
  if (!bases.has(object.getId())) return false;
  if (!nearby(player, object)) return true;
  const state = houses(player)[object.getId()];
  if (!valid(state)) return true;
  if (state.seeds < SEEDS) {
    statement(player, `Your birdhouse seed level is: ${state.seeds}/${SEEDS}. <col=800000>It must be full of seed before it<br><col=800000>will start catching birds.</col>`);
  } else {
    statement(player, `Your birdhouse trap is set and consuming seed. Seed level is: ${seedLevel(state)}/${SEEDS}.`);
  }
  return true;
}

/** Interact on a full birdhouse: the captured menu (recording 716). */
function interact(event) {
  const { player, object } = event;
  if (!bases.has(object.getId())) return false;
  if (!nearby(player, object)) return true;
  if (!valid(houses(player)[object.getId()])) return true;
  require("./Context.Hunter").choose(player, [
    ["Check seed levels.", () => seeds(event)],
    ["Dismantle my trap.", () => empty(event)],
    ["Dismantle and rebuild my trap.", () => reset(event)],
    ["Do nothing.", () => {}],
  ], object);
  return true;
}

/** Test hook: moves this player's bird houses `ms` closer to full. */
function advanceTime(event) {
  const { player, ms } = event;
  let moved = false;
  for (const house of Object.values(houses(player))) {
    if (valid(house) && house.seeds === SEEDS) { house.filled -= ms; moved = true; }
  }
  if (!moved) return;
  sync({ player });
  event.handledBy.push("Hunter");
}

module.exports = { initialize, login, sync, use, build, craft, interact, empty, reset, dismantle, seeds, advanceTime, ATTRIBUTE, DURATION, bases, status, ready, seedLevel, seedValue, loot };
