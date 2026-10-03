"use strict";

const C = require("./Context.Hunter");
const { H, ANIM, level, requireLevel, hasTool, nearby, available, roll, exchange, xp, begin, hide, chance } = C;
const tables = require("./ImplingLoot.json");
const falcons = new Map();
const caught = new Map();
const pendingLoot = new WeakMap();

function gloves(player, id) {
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
  if (!butterfly && !impling) return false;
  if (!available(npc) || !nearby(player, npc)) return true;
  const I = H.core.ItemIdentifiers;
  const weapon = player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId();
  const net = [I.BUTTERFLY_NET, I.MAGIC_BUTTERFLY_NET].includes(weapon);
  const def = butterfly ?? impling;
  const jar = butterfly ? I.BUTTERFLY_JAR : I.IMPLING_JAR;
  const jarred = player.getInventory().contains(jar);
  const puro = player.getLocation().getX() >= 2560 && player.getLocation().getX() <= 2623
    && player.getLocation().getY() >= 4288 && player.getLocation().getY() <= 4351;
  if (impling && !jarred && (net || puro)) { player.sendMessage("You need an empty impling jar."); return true; }
  const required = net ? def.level : def.hands;
  if (!requireLevel(player, required)) return true;
  const inputs = jarred ? [[jar, 1]] : [];
  // Unjarred implings are looted immediately, rather than silently discarding the catch.
  const outputs = jarred ? [[def.jar, 1]] : impling ? rewards(player, def) : [];
  if (!outputs) return true;
  if (!exchange(player, inputs, outputs, false)) { player.getInventory().full(); return true; }
  const token = { player };
  if (!butterfly) H.reserved.set(npc, token);
  const cancel = () => { if (H.reserved.get(npc) === token) H.reserved.delete(npc); };
  if (!begin(player, 2, net ? weapon === I.MAGIC_BUTTERFLY_NET ? ANIM.NET : butterfly ? ANIM.BUTTERFLY : ANIM.OLD_NET : ANIM.HANDS, () => {
    cancel();
    if (!available(npc) || !nearby(player, npc) || !requireLevel(player, required)
      || player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId() !== weapon) return;
    const improved = !net || weapon === I.MAGIC_BUTTERFLY_NET;
    const curve = improved && def.handsLow !== undefined ? { ...def, low: def.handsLow, high: def.handsHigh } : def;
    const catchBonus = improved && def.handsLow === undefined || net && weapon === I.MAGIC_BUTTERFLY_NET && def.boost === "restore" ? 20 / 256 : 0;
    if (!chance(player, curve, catchBonus, required)) {
      player.sendMessage("The creature slips away."); return;
    }
    if (!exchange(player, inputs, outputs)) return;
    xp(player, butterfly ? (net ? def.xp : def.handsXp) : (puro ? def.puroXp : def.xp), butterfly ? "butterfly" : "impling", npcId);
    if (butterfly && !jarred) { bonus(player, def); if (def.boost === "restore") player.setRunEnergy(Math.min(100, player.getRunEnergy() + 5)); }
    if (impling) hide(npc, 100);
    player.sendMessage(jarred ? "You catch the creature in a jar." : "You catch the creature barehanded and release it.");
  }, cancel)) cancel();
  return true;
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
  const clues = { BABY: [["BEGINNER", 50], ["EASY", 100]], YOUNG: [["BEGINNER", 25], ["EASY", 50]], GOURMET: [["EASY", 25]],
    EARTH: [["MEDIUM", 100]], ESSENCE: [["MEDIUM", 50]], ECLECTIC: [["MEDIUM", 25]], NATURE: [["HARD", 100]],
    MAGPIE: [["HARD", 50]], NINJA: [["HARD", 25]], DRAGON: [["ELITE", 50]], CRYSTAL: [["ELITE", 50]] };
  for (const [tier, denominator] of clues[def.key] ?? []) {
    const id = I[`CLUE_SCROLL_${tier}_`];
    if (roll(1, denominator) === 1 && !C.ownsClue(player, tier)) result.push([id, 1]);
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
    if (roll(1, 10) !== 1) result.push([H.core.ItemIdentifiers.IMPLING_JAR, 1]);
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

function processPlayer({ player }) {
  const p = player.getLocation();
  if (hasFalcon(player) && (p.getZ() !== 0 || p.getX() < 2360 || p.getX() > 2399 || p.getY() < 3570 || p.getY() > 3620)) cleanup({ player });
}

function process() {
  for (const state of caught.values()) if (H.tick >= state.due || !state.falcon.isRegistered()) removeFalcon(state);
}

function cleanup({ player }) {
  const state = falcons.get(player);
  if (state) removeFalcon(state);
  if (hasFalcon(player)) gloves(player, -1);
}

module.exports = { catchNpc, hire, retrieve, release, boost, loot, rewards, equipment, process, processPlayer, cleanup };
