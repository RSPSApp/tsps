"use strict";

const C = require("./Context.Hunter");
const { H, ANIM, level, requireLevel, hasTool, nearby, active, available, roll, exchange, xp, begin, hide, chance } = C;
const tables = require("../data/impling-loot.json");
const falcons = new Map();
const caught = new Map();
// Players wearing a falconer's glove, so leaving the falconry grounds is checked for them only.
const gloved = new Set();
const pendingLoot = new WeakMap();
const IMPLING_CATCH_SOUND = 2623;
// The caught impling plays ii_impling_caught and is removed two ticks after the catch.
const CAUGHT_TICKS = 2;
// Outside Puro-Puro implings have no fixed spawns; the previous one-minute return is kept.
const OUTSIDE_RESPAWN_TICKS = 100;
const JAR_MESSAGE = "You manage to catch the impling and squeeze it into a jar.";
const LOOT_MESSAGE = "You manage to catch the impling and acquire some loot.";
const NO_JAR_MESSAGE = "You don't have an empty impling jar in which to keep an impling.";
const NO_SPACE_MESSAGE = "You'll need to clear some space in your pack to catch this impling without a jar.";
// A barehanded butterfly or moth (rsprox captures 95, 1634, 3279, 4051): the grab, the creature's
// out-of-hands graphic and sound 7870 (45 cycles late) and the spam line on the tick the player
// reaches it; it is gone a tick later.
const RELEASE_SOUND = 7870;
const RELEASE_DELAY = 45;
const RELEASE_HEIGHT = 190;
const RELEASED_TICKS = 1;

function gloves(player, id) {
  if (id > 0) gloved.add(player);
  else gloved.delete(player);
  player.getEquipment().set(H.core.Equipment.WEAPON_SLOT, new H.core.Item(id, id > 0 ? 1 : 0));
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(H.core.Flag.APPEARANCE);
}

function hasFalcon(player) {
  const I = H.core.ItemIdentifiers;
  return [I.FALCONERS_GLOVE, I.FALCONERS_GLOVE_2].includes(player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId());
}

function hire({ player }) {
  const I = H.core.ItemIdentifiers, E = H.core.Equipment;
  if (hasFalcon(player)) { cleanup({ player }); player.sendMessage("You return the falcon to Matthias."); return true; }
  if (!requireLevel(player, 43)) return true;
  if ([E.WEAPON_SLOT, E.SHIELD_SLOT, E.HANDS_SLOT].some(slot => player.getEquipment().get(slot).getId() > 0)) {
    player.sendMessage("Remove your weapon, shield and gloves before borrowing a falcon."); return true;
  }
  if (!exchange(player, [[I.COINS, 500]], [])) { player.sendMessage("It costs 500 coins to borrow a falcon."); return true; }
  gloves(player, I.FALCONERS_GLOVE_2);
  H.players.add(player);
  player.sendMessage("Matthias lends you a falcon. Catch a kebbit, then retrieve the falcon and its prey.");
  return true;
}

function catchFalcon(player, npc, def) {
  const I = H.core.ItemIdentifiers;
  if (!hasFalcon(player)) { player.sendMessage("Borrow a falcon from Matthias first."); return; }
  if (falcons.has(player) || player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId() !== I.FALCONERS_GLOVE_2) {
    player.sendMessage("Retrieve your falcon before sending it out again."); return;
  }
  if (!requireLevel(player, def.level) || !nearby(player, npc, 8) || !available(npc)) return;
  const reservation = { player };
  H.reserved.set(npc, reservation);
  const cancel = () => { if (H.reserved.get(npc) === reservation) H.reserved.delete(npc); if (hasFalcon(player)) gloves(player, I.FALCONERS_GLOVE_2); };
  if (!begin(player, 2, ANIM.FALCON, () => {
    H.reserved.delete(npc);
    if (!hasFalcon(player) || !available(npc) || !nearby(player, npc, 8) || !requireLevel(player, def.level)) { cancel(); return; }
    if (!chance(player, def)) {
      cancel(); player.sendMessage("The kebbit evades your falcon."); return;
    }
    const falcon = H.api.spawnNpc({ id: def.falcon, x: npc.getLocation().getX(), y: npc.getLocation().getY(),
      z: npc.getLocation().getZ(), wanderRadius: 0, owner: player, ownerOnly: true });
    if (!falcon) { cancel(); return; }
    if (player.getPrivateArea()) falcon.setArea(player.getPrivateArea());
    falcon.getMovementQueue().setBlockMovement(true);
    falcon.untargetable = true;
    const state = { falcon, player, def, due: H.tick + 100 };
    falcons.set(player, state); caught.set(falcon, state);
    hide(npc);
    player.sendMessage("Your falcon catches the kebbit. Retrieve it to collect the catch.");
  }, cancel)) cancel();
  else gloves(player, I.FALCONERS_GLOVE);
}

function retrieve({ player, npc }) {
  const state = caught.get(npc);
  if (!state) return false;
  if (state.player !== player) { player.sendMessage("This isn't your falcon."); return true; }
  if (!nearby(player, npc)) return true;
  const loot = [[H.core.ItemIdentifiers.BONES, 1], [state.def.fur, 1]];
  if (!exchange(player, [], loot, false)) { player.getInventory().full(); return true; }
  begin(player, 1, ANIM.PICKUP, () => {
    if (caught.get(npc) !== state || !exchange(player, [], loot)) return;
    xp(player, state.def.xp, "falconry", state.def.npc);
    removeFalcon(state);
  });
  return true;
}

function removeFalcon(state) {
  caught.delete(state.falcon); falcons.delete(state.player);
  H.api.removeNpc(state.falcon);
  state.falcon.getPrivateArea()?.detach(state.falcon);
  if (hasFalcon(state.player)) gloves(state.player, H.core.ItemIdentifiers.FALCONERS_GLOVE_2);
}

function catchNpc({ player, npc, npcId }) {
  const butterfly = H.data.butterflies.find(c => c.npc === npcId);
  const impling = H.data.implings.find(c => c.npcs.includes(npcId));
  const falcon = H.data.falconry.find(c => c.npc === npcId);
  if (falcon) { catchFalcon(player, npc, falcon); return true; }
  if (impling) { catchImpling(player, npc, npcId, impling); return true; }
  if (!butterfly) return false;
  if (!available(npc) || !nearby(player, npc)) return true;
  const I = H.core.ItemIdentifiers;
  const weapon = player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId();
  const net = [I.BUTTERFLY_NET, I.MAGIC_BUTTERFLY_NET].includes(weapon);
  const def = butterfly;
  const name = creatureName(def);
  const required = net ? def.level : def.hands;
  if (level(player) < required) {
    player.sendMessage(`You need a Hunter level of at least ${required} to catch this ${name.endsWith(" moth") ? "moth" : "butterfly"}${net ? "" : " barehanded"}.`);
    return true;
  }
  if (!net) { catchBarehanded(player, npc, npcId, def, name); return true; }
  const jar = I.BUTTERFLY_JAR;
  const jarred = player.getInventory().contains(jar);
  const inputs = jarred ? [[jar, 1]] : [];
  const outputs = jarred ? [[def.jar, 1]] : [];
  if (!exchange(player, inputs, outputs, false)) { player.getInventory().full(); return true; }
  begin(player, 2, weapon === I.MAGIC_BUTTERFLY_NET ? ANIM.NET : ANIM.BUTTERFLY, () => {
    if (!available(npc) || !nearby(player, npc) || !requireLevel(player, required)
      || player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId() !== weapon) return;
    const improved = weapon === I.MAGIC_BUTTERFLY_NET;
    const curve = improved && def.handsLow !== undefined ? { ...def, low: def.handsLow, high: def.handsHigh } : def;
    const catchBonus = improved && (def.handsLow === undefined || def.boost === "restore") ? 20 / 256 : 0;
    if (!chance(player, curve, catchBonus, required)) {
      player.sendMessage("The creature slips away."); return;
    }
    if (!exchange(player, inputs, outputs)) return;
    xp(player, def.xp, "butterfly", npcId);
    if (!jarred) freed(player, def);
    player.sendMessage(jarred ? "You catch the creature in a jar." : "You catch the creature barehanded and release it.");
  });
  return true;
}

/** "snowy knight butterfly", "moonlight moth": the creature as catch lines name it. */
function creatureName(def) {
  const name = String(H.core.CacheDefinitions.getNpc(def.npc)?.name ?? "").toLowerCase();
  return name.endsWith(" moth") ? name : `${name} butterfly`;
}

function catchBarehanded(player, npc, npcId, def, name) {
  if (!active(player) || player.busy()) return;
  C.cancel(player);
  player.getSkillManager().stopSkillable();
  player.performAnimation(new H.core.Animation(ANIM.IMPLING_HANDS));
  const curve = def.handsLow !== undefined ? { ...def, low: def.handsLow, high: def.handsHigh } : def;
  if (!chance(player, curve, def.handsLow === undefined ? 20 / 256 : 0, def.hands)) {
    player.sendMessage("The creature slips away."); return;
  }
  const graphic = H.core.CacheDefinitions.getSpotanimId(def.release);
  if (graphic != null) player.performGraphic(new H.core.Graphic(graphic, RELEASE_DELAY, RELEASE_HEIGHT));
  player.getPacketSender().sendSound(RELEASE_SOUND, 1, RELEASE_DELAY);
  player.getPacketSender().sendTypedMessage(H.core.ChatType.SPAM, `You catch and release the ${name}.`);
  xp(player, def.handsXp, "butterfly", npcId);
  freed(player, def);
  hide(npc, RELEASED_TICKS + 10, RELEASED_TICKS);
}

/** A butterfly let go straight from the hands or net gives its boost (sunlight moths also restore run energy). */
function freed(player, def) {
  bonus(player, def);
  if (def.boost === "restore") player.setRunEnergy(Math.min(100, player.getRunEnergy() + 5));
}

/**
 * rsprox captures resolve a catch on the tick the player reaches the impling: the throw or
 * barehanded grab (hunting_impling_catch), sound 2623, the message, the jar or loot, the XP and
 * the impling's ii_impling_caught all land together (1342, 1389, 1510, 2520; Leagues 92, 95,
 * 1757, 1858), and the impling is removed two ticks later. The refusal messages are from
 * Leagues 95, 164, 1823 and 1858. The Wiki (Implings) sets the Puro-Puro jar rule and respawns.
 */
function catchImpling(player, npc, npcId, def) {
  if (!available(npc) || !nearby(player, npc) || !active(player) || player.busy()) return;
  const I = H.core.ItemIdentifiers;
  const weapon = player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId();
  const net = [I.BUTTERFLY_NET, I.MAGIC_BUTTERFLY_NET].includes(weapon);
  const jarred = player.getInventory().contains(I.IMPLING_JAR);
  const puro = inPuroPuro(player);
  if (!jarred && (net || puro)) { player.sendMessage(NO_JAR_MESSAGE); return; }
  const required = net ? def.level : def.hands;
  if (level(player) < required) {
    player.sendMessage(`You need a Hunter level of at least ${required} to catch this impling${net ? "" : " barehanded"}.`);
    return;
  }
  const inputs = jarred ? [[I.IMPLING_JAR, 1]] : [];
  // Unjarred implings are looted immediately, rather than silently discarding the catch.
  const outputs = jarred ? [[def.jar, 1]] : rewards(player, def);
  if (!outputs) return;
  if (!exchange(player, inputs, outputs, false)) {
    if (jarred) player.getInventory().full();
    else player.sendMessage(NO_SPACE_MESSAGE);
    return;
  }
  C.cancel(player);
  player.getSkillManager().stopSkillable();
  player.performAnimation(new H.core.Animation(net ? weapon === I.MAGIC_BUTTERFLY_NET ? ANIM.NET : ANIM.OLD_NET : ANIM.IMPLING_HANDS));
  const improved = !net || weapon === I.MAGIC_BUTTERFLY_NET;
  if (!chance(player, def, improved ? 20 / 256 : 0, required)) {
    player.sendMessage("The creature slips away."); return;
  }
  if (!exchange(player, inputs, outputs)) return;
  player.getPacketSender().sendSound(IMPLING_CATCH_SOUND, 1, 0);
  player.sendMessage(jarred ? JAR_MESSAGE : LOOT_MESSAGE);
  xp(player, puro ? def.puroXp : def.xp, "impling", npcId);
  npc.performAnimation(new H.core.Animation(ANIM.IMPLING_CAUGHT));
  // Roaming spawns (Puro-Puro's and the overworld's) manage their own removal and respawn.
  const event = { player, npc, npcId, puro, handled: false };
  H.api.emitCustomEvent("hunter:impling-caught", event);
  if (!event.handled) hide(npc, CAUGHT_TICKS + (puro ? def.puroRespawn : OUTSIDE_RESPAWN_TICKS), CAUGHT_TICKS);
}

function inPuroPuro(player) {
  const x = player.getLocation().getX(), y = player.getLocation().getY();
  return x >= 2560 && x <= 2623 && y >= 4288 && y <= 4351;
}

function release({ player, itemId }) {
  const def = H.data.butterflies.find(c => c.jar === itemId);
  if (!def) return false;
  if (exchange(player, [[itemId, 1]], [[H.core.ItemIdentifiers.BUTTERFLY_JAR, 1]])) {
    bonus(player, def); player.sendMessage("You release the butterfly.");
  }
  return true;
}

function bonus(player, def) {
  if (def.boost === "restore") {
    for (const skill of H.core.Skill.values()) {
      if ([H.core.Skill.HITPOINTS, H.core.Skill.PRAYER].includes(skill)) continue;
      const skills = player.getSkillManager(), max = skills.getMaxLevel(skill), current = skills.getCurrentLevel(skill);
      if (current < max) skills.setCurrentLevels(skill, Math.min(max, current + 6 + Math.floor((max - current) * 0.2)));
    }
    const skills = player.getSkillManager(), hp = H.core.Skill.HITPOINTS;
    skills.setCurrentLevels(hp, Math.min(skills.getMaxLevel(hp), skills.getCurrentLevel(hp) + 8));
    return;
  }
  const skills = player.getSkillManager(), max = skills.getMaxLevel(def.boost), current = skills.getCurrentLevel(def.boost);
  if (def.boost === H.core.Skill.PRAYER) skills.setCurrentLevels(def.boost, Math.min(max, current + 22));
  else if (def.boost === H.core.Skill.HITPOINTS) skills.setCurrentLevels(def.boost, Math.min(max, current + 8));
  else skills.setCurrentLevels(def.boost, Math.max(current, max + Math.floor(max * 0.15) + 4));
}

function boost(event) {
  const def = H.data.butterflies.find(c => c.jar === event.itemId);
  if (!def) return;
  event.handled = true;
  const { player, target } = event;
  if (!nearby(player, target) || target.getAttribute("accept-aid") === false || target.getHitpoints() <= 0
    || !exchange(player, [[def.jar, 1]], [[H.core.ItemIdentifiers.BUTTERFLY_JAR, 1]])) return;
  bonus(target, def);
  if (H.api.getAreaManager().inMulti(target)) {
    const others = H.core.World.getNearbyPlayersForUpdate(target).filter(p => p !== target && p !== player
      && nearby(target, p, 2) && p.getAttribute("accept-aid") !== false && p.getHitpoints() > 0);
    for (let i = 0; i < 3 && others.length; i++) bonus(others.splice(roll(0, others.length - 1), 1)[0], def);
  }
  target.sendMessage("A butterfly restores your vigour.");
}

function rewards(player, def) {
  const I = H.core.ItemIdentifiers;
  let result;
  if (def.key === "LUCKY") {
    const request = { player, rewards: null };
    H.api.emitCustomEvent("hunter:lucky-loot", request);
    result = request.rewards ?? require("./LuckyLoot.Hunter").roll(player);
    if (!Array.isArray(result) || !result.length) return null;
  } else {
    const rows = tables[def.key].filter(row => row[0] !== "DRAGON_JAVELIN_TIPS" || C.questComplete(player, "monkey_madness_ii"));
    let draw = roll(1, rows.reduce((sum, r) => sum + r[1], 0)), row;
    for (const candidate of rows) { draw -= candidate[1]; if (draw <= 0) { row = candidate; break; } }
    const base = I[row[0]], id = row[4] ? H.core.ItemDefinition.forId(base).getNoteId() : base;
    result = row[0] === null ? [] : [[id, roll(row[2], row[3])]];
    if (def.key === "GOURMET" && roll(1, 500) === 1) result.push([I.GRUBBY_KEY, 1]);
    if (def.key === "CRYSTAL" && roll(1, 128) === 1) result.push([I.ELVEN_SIGNET, 1]);
  }
  // Content may change the jar's loot before its clue rolls ("hunter:impling-loot", a league relic's doubled notes).
  const request = { player, impling: def.key, rewards: result };
  H.api.emitCustomEvent("hunter:impling-loot", request);
  result = request.rewards;
  const clues = { BABY: [["BEGINNER", 50], ["EASY", 100]], YOUNG: [["BEGINNER", 25], ["EASY", 50]], GOURMET: [["EASY", 25]],
    EARTH: [["MEDIUM", 100]], ESSENCE: [["MEDIUM", 50]], ECLECTIC: [["MEDIUM", 25]], NATURE: [["HARD", 100]],
    MAGPIE: [["HARD", 50]], NINJA: [["HARD", 25]], DRAGON: [["ELITE", 50]], CRYSTAL: [["ELITE", 50]] };
  for (const [tier, denominator] of clues[def.key] ?? []) {
    const id = I[`${C.questComplete(player, "x_marks_the_spot") ? "SCROLL_BOX" : "CLUE_SCROLL"}_${tier}_`];
    // Content may make the jar's clue likelier ("hunter:impling-clue-chance", a league relic): 1 in `oneIn`.
    const chance = { player, impling: def.key, tier: tier.toLowerCase(), oneIn: denominator };
    H.api.emitCustomEvent("hunter:impling-clue-chance", chance);
    const oneIn = Number.isInteger(chance.oneIn) && chance.oneIn > 0 ? chance.oneIn : denominator;
    if (roll(1, oneIn) === 1 && !C.ownsClue(player, tier)) result.push([id, 1]);
  }
  return result;
}

function loot(event) {
  const def = H.data.implings.find(c => c.jar === event.itemId);
  if (!def) return false;
  if (!event.player.getInventory().contains(event.itemId)) return true;
  let pending = pendingLoot.get(event.player);
  if (!pending) pendingLoot.set(event.player, pending = new Map());
  if (!pending.has(event.itemId)) {
    const result = rewards(event.player, def);
    if (!result) return true;
    // Content may keep the jar whole ("hunter:jar-kept", a league relic); one in ten breaks otherwise.
    const jar = { player: event.player, kept: roll(1, 10) !== 1 };
    H.api.emitCustomEvent("hunter:jar-kept", jar);
    if (jar.kept) result.push([H.core.ItemIdentifiers.IMPLING_JAR, 1]);
    pending.set(event.itemId, result);
  }
  if (exchange(event.player, [[event.itemId, 1]], pending.get(event.itemId))) pending.delete(event.itemId);
  else event.player.getInventory().full();
  return true;
}

function equipment(event) {
  if (hasFalcon(event.player) && [H.core.Equipment.WEAPON_SLOT, H.core.Equipment.SHIELD_SLOT, H.core.Equipment.HANDS_SLOT].includes(event.slot)) {
    event.allow = false; event.player.sendMessage("Return your falcon to Matthias first.");
  }
}

/** A glove kept through a crash still needs taking back off the grounds. */
function login({ player }) {
  if (hasFalcon(player)) gloved.add(player);
}

function process() {
  for (const state of caught.values()) if (H.tick >= state.due || !state.falcon.isRegistered()) removeFalcon(state);
  for (const player of gloved) {
    const p = player.getLocation();
    if (!hasFalcon(player)) gloved.delete(player);
    else if (p.getZ() !== 0 || p.getX() < 2360 || p.getX() > 2399 || p.getY() < 3570 || p.getY() > 3620) cleanup({ player });
  }
}

function cleanup({ player }) {
  const state = falcons.get(player);
  if (state) removeFalcon(state);
  if (hasFalcon(player)) gloves(player, -1);
}

module.exports = { catchNpc, hire, retrieve, release, boost, loot, rewards, equipment, login, process, cleanup };
