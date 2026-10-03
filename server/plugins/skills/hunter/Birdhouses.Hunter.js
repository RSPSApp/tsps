"use strict";

const { H, ANIM, level, requireLevel, hasTool, nearby, roll, exchange, drop, xp, begin } = require("./Context.Hunter");
const ATTRIBUTE = "hunter.birdhouses";
const DURATION = 50 * 60 * 1000;
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

function status(state) {
  if (state.seeds < 10) return 0;
  return Date.now() >= state.filled + DURATION ? 2 : 1;
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

function place(player, object, tier) {
  if (!bases.has(object.getId()) || !nearby(player, object) || !requireLevel(player, tier.level)) return;
  if (valid(houses(player)[object.getId()])) { player.sendMessage("There is already a birdhouse here."); return; }
  begin(player, 2, ANIM.SMALL, () => {
    const state = houses(player);
    if (!requireLevel(player, tier.level) || valid(state[object.getId()]) || !exchange(player, [[tier.item, 1]], [])) return;
    state[object.getId()] = { tier: tier.index, seeds: 0, filled: 0 };
    sync({ player });
    player.sendMessage("You place the birdhouse. Fill it with seeds to start catching birds.");
  });
}

function seedValue(itemId) {
  const I = H.core.ItemIdentifiers;
  const low = [I.GUAM_SEED, I.MARRENTILL_SEED, I.TARROMIN_SEED, I.HARRALANDER_SEED,
    I.BARLEY_SEED, I.HAMMERSTONE_SEED, I.ASGARNIAN_SEED, I.JUTE_SEED, I.YANILLIAN_SEED, I.KRANDORIAN_SEED,
    I.POTATO_SEED, I.ONION_SEED, I.CABBAGE_SEED, I.TOMATO_SEED, I.SWEETCORN_SEED, I.STRAWBERRY_SEED,
    I.REDBERRY_SEED, I.CADAVABERRY_SEED, I.DWELLBERRY_SEED, I.JANGERBERRY_SEED,
    I.MARIGOLD_SEED, I.ROSEMARY_SEED, I.NASTURTIUM_SEED, I.WOAD_SEED, I.LIMPWURT_SEED];
  const high = [I.RANARR_SEED, I.TOADFLAX_SEED, I.IRIT_SEED, I.AVANTOE_SEED, I.KWUARM_SEED,
    I.SNAPDRAGON_SEED, I.CADANTINE_SEED, I.LANTADYME_SEED, I.DWARF_WEED_SEED, I.TORSTOL_SEED,
    I.WILDBLOOD_SEED, I.WATERMELON_SEED, I.SNAPE_GRASS_SEED, I.WHITEBERRY_SEED, I.POISON_IVY_SEED];
  return high.includes(itemId) ? 2 : low.includes(itemId) ? 1 : 0;
}

function seed(player, object, itemId) {
  const state = houses(player)[object.getId()];
  const value = seedValue(itemId);
  if (!valid(state)) { player.sendMessage("Build a birdhouse here first."); return; }
  if (!value) { player.sendMessage("You need suitable hop, herb, allotment, flower or bush seeds."); return; }
  if (state.seeds >= 10) { player.sendMessage("This birdhouse is already full of seeds."); return; }
  const amount = Math.min(Math.ceil((10 - state.seeds) / value), player.getInventory().getAmount(itemId));
  if (!amount || !exchange(player, [[itemId, amount]], [])) return;
  state.seeds = Math.min(10, state.seeds + amount * value);
  if (state.seeds === 10) state.filled = Date.now();
  sync({ player });
  player.sendMessage(state.seeds === 10 ? "The birdhouse is ready. Come back in 50 minutes." : "You add some seeds to the birdhouse.");
}

function use(event) {
  if (!bases.has(event.objectId)) return;
  event.handled = true;
  if (!nearby(event.player, event.object)) return;
  const tier = H.data.birdhouses.find(t => t.item === event.itemId);
  if (tier) place(event.player, event.object, tier);
  else seed(event.player, event.object, event.itemId);
}

function build({ player, object }) {
  if (!bases.has(object.getId())) return false;
  const tier = [...H.data.birdhouses].reverse().find(t => player.getInventory().contains(t.item) && level(player) >= t.level);
  if (tier) place(player, object, tier);
  else player.sendMessage("Bring a birdhouse suited to your Hunter level, or craft one with logs, clockwork, a hammer and a chisel.");
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
  const result = [[I.CLOCKWORK, 1], [I.RAW_BIRD_MEAT, 10], [I.FEATHER, roll(30, 100)]];
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
        if (!require("./Context.Hunter").ownsClue(player,tier) && roll(1,1500) <= numerator) { clue = tier; break; }
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

function collect(event, destroy = false, rebuild = false) {
  const { player, object } = event;
  if (!bases.has(object.getId())) return false;
  if (!nearby(player, object)) return true;
  const state = houses(player)[object.getId()];
  if (!valid(state)) return true;
  if (!destroy && status(state) !== 2) {
    player.sendMessage(state.seeds < 10 ? "The birdhouse needs more seeds." : `The birdhouse will be ready in ${Math.ceil((state.filled + DURATION - Date.now()) / 60000)} minutes.`);
    return true;
  }
  const next = rebuild ? [...H.data.birdhouses].reverse().find(t => player.getInventory().contains(t.logs)
    && level(player) >= t.level && level(player, H.core.Skill.CRAFTING) >= t.crafting) : null;
  if (rebuild && (!next || !hasTool(player, H.core.ItemIdentifiers.HAMMER) || !hasTool(player, H.core.ItemIdentifiers.CHISEL))) {
    player.sendMessage("Bring suitable logs, a hammer and a chisel to reset this birdhouse."); return true;
  }
  begin(player, 2, next ? makeAnimation(player) : ANIM.SMALL, () => {
    if (houses(player)[object.getId()] !== state) return;
    if (next && (!requireLevel(player,next.level) || !requireLevel(player,next.crafting,H.core.Skill.CRAFTING) || !hasTool(player, H.core.ItemIdentifiers.HAMMER) || !hasTool(player, H.core.ItemIdentifiers.CHISEL)
      || !exchange(player, [[next.logs, 1]], []))) return;
    const items = (destroy ? [[H.core.ItemIdentifiers.CLOCKWORK, 1]] : loot(player, state))
      .filter(item => !next || item[0] !== H.core.ItemIdentifiers.CLOCKWORK);
    delete houses(player)[object.getId()];
    for (const item of items) if (!exchange(player, [], [item])) drop(player, [item], player.getLocation());
    if (!destroy) xp(player, H.data.birdhouses[state.tier].xp, "birdhouse");
    if (next) {
      houses(player)[object.getId()] = { tier: next.index, seeds: 0, filled: 0 };
      player.getSkillManager().addExperiences(H.core.Skill.CRAFTING, next.craftXp);
    }
    sync({ player });
    player.sendMessage(next ? "You collect the birds and reuse the clockwork to build a new birdhouse. Add seeds to set it." :
      destroy ? "You dismantle the birdhouse and recover the clockwork." : "You collect the birds and recover the clockwork.");
  });
  return true;
}

function empty(event) { return collect(event); }
function reset(event) { return collect(event, false, true); }
function dismantle(event) { return collect(event, true); }
function seeds({ player, object }) {
  if (!bases.has(object.getId())) return false;
  if (!nearby(player, object)) return true;
  const item = player.getInventory().getItems().find(i => i && seedValue(i.getId()) > 0);
  if (item) seed(player, object, item.getId());
  else player.sendMessage("You don't have any suitable seeds.");
  return true;
}

module.exports = { initialize, login, sync, use, build, craft, empty, reset, dismantle, seeds, ATTRIBUTE, DURATION, bases, status, seedValue };
