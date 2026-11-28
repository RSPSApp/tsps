"use strict";

const C = require("./Context.Hunter");
const { H, ANIM, level, requireLevel, hasTool, nearby, active, available, roll, exchange, catchExchange, xp, begin, hide, chance } = C;
const tables = require("../data/impling-loot.json");
const Matthias = require("./Matthias.Hunter");
const { boostSkill } = require("../../items/ConsumableEffects");
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
// Wiki (Falconry): "Your falcon has left its prey. You see it heading back toward the falconer."
// Matthias's transcript (npc-dialogues.json): the line that shows the falcon landing on the lent glove.
const GLOVE_HAND_OUT = "The falconer gives you a large leather glove";
const LOST_PREY_MESSAGE = "Your falcon has left its prey. You see it heading back toward the falconer.";
const NO_SPACE_MESSAGE = "You'll need to clear some space in your pack to catch this impling without a jar.";
// A barehanded butterfly or moth (rsprox captures 95, 1634, 3279, 4051): the grab, the creature's
// out-of-hands graphic and sound 7870 (45 cycles late) and the spam line on the tick the player
// reaches it; it is gone a tick later.
const RELEASE_SOUND = 7870;
const RELEASE_DELAY = 45;
const RELEASE_HEIGHT = 190;
const RELEASED_TICKS = 1;
// A miss on a butterfly or moth is followed by another try this many ticks later (reported for net
// throws in rsprox capture 1001961, rev 242; ours: barehanded misses wait the same).
const RETRY_TICKS = 4;
// Ours: clicking again throws the net no sooner than this after the last throw.
const NET_THROW_TICKS = 2;
const lastNetThrow = new WeakMap();
// The falcon's own graphics (cache gamevals falcon_launch_anim, falcon_travel_anim, falcon_hit_anim) with
// the numbers rsprox capture 3414 records for the Falconry grounds' falconers: spotanim 918 at height 150
// on the sender, then falcon_travel_anim 922 starting at client cycle 24 and flying 8 cycles per tile
// (start height 150, angle 10, progress 64) locked on to the kebbit. On a kebbit the hit is spotanim 923 on
// the kebbit, delayed to the projectile's end. The falconers use 918 and 927 whichever way the kebbit lies, so there is no
// direction-picked graphic here.
const FALCON_LAUNCH_GRAPHIC = 918;
const FALCON_TRAVEL_PROJECTILE = 922;
const FALCON_HIT_GRAPHIC = 923;
const FALCON_LAUNCH_CYCLES = 24;
const FALCON_CYCLES_PER_TILE = 8;
// falcon_hit (seq 5200) is 26 client cycles long.
const FALCON_HIT_CYCLES = 26;
const FALCON_START_HEIGHT = 150;
const FALCON_END_HEIGHT = 5;
const FALCON_ANGLE = 10;
const FALCON_PROGRESS = 64;

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
  if (hasFalcon(player)) { cleanup({ player }); player.sendMessage("You return the falcon to Matthias."); return true; }
  lend(player);
  return true;
}

/** Puts the glove and falcon on, taking the 500-coin fee unless invested; false (with the reason) when refused. */
function lend(player) {
  const I = H.core.ItemIdentifiers, E = H.core.Equipment;
  if (!requireLevel(player, Matthias.FALCONRY_LEVEL)) return false;
  if ([E.WEAPON_SLOT, E.SHIELD_SLOT, E.HANDS_SLOT].some(slot => player.getEquipment().get(slot).getId() > 0)) {
    player.sendMessage("Remove your weapon, shield and gloves before borrowing a falcon."); return false;
  }
  // Wiki (Falconry): an investor borrows falcons without the 500-coin fee.
  if (!Matthias.invested(player) && !exchange(player, [[I.COINS, Matthias.FEE]], [])) { player.sendMessage("It costs 500 coins to borrow a falcon."); return false; }
  gloves(player, I.FALCONERS_GLOVE_2);
  H.players.add(player);
  player.sendMessage("Matthias lends you a falcon. Catch a kebbit, then retrieve the falcon and its prey.");
  return true;
}

/**
 * Talk-to "could I have a go?": the payer's transcript lends on its receive-glove step, an investor's
 * (no receive step) on the glove hand-out line. A refusal ends the conversation before that line.
 */
function dialogueLend(event) {
  if (event.definition?.getName?.() !== "Matthias") return;
  const receive = event.action === "receive" && (event.target ?? event.text) === "Falconer's glove";
  const handOut = event.kind === "message" && String(event.text ?? "").startsWith(GLOVE_HAND_OUT) && !hasFalcon(event.player);
  if (!receive && !handOut) return;
  if (receive) event.handled = true;
  if (hasFalcon(event.player) || lend(event.player)) return;
  event.handled = true;
  event.end = true;
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
  // The farther the kebbit, the longer the falcon flies (Wiki: running up to it shortens the travel). The catch
  // resolves on the last tick that starts before the projectile lands; the hit graphic covers the rest.
  const from = player.getLocation().clone(), to = npc.getLocation().clone();
  const arrival = H.core.Projectile.arrivalCycles(from, npc, FALCON_LAUNCH_CYCLES, FALCON_CYCLES_PER_TILE);
  const ticks = Math.max(1, Math.floor(arrival / 30));
  const hitDelay = Math.max(0, arrival - ticks * 30);
  const hitTicks = Math.ceil((hitDelay + FALCON_HIT_CYCLES) / 30);
  if (!begin(player, ticks, ANIM.FALCON, () => {
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
    // The falcon strikes first (its hit graphic), then settles on the prey and can be retrieved.
    falcon.setVisible(false);
    const state = { falcon, player, def, due: H.tick + 100, appearAt: H.tick + hitTicks };
    falcons.set(player, state); caught.set(falcon, state);
    npc.performGraphic(H.core.Graphic.delayed(FALCON_HIT_GRAPHIC, hitDelay));
    hide(npc, 10, hitTicks);
    player.sendMessage("Your falcon catches the kebbit. Retrieve it to collect the catch.");
  }, cancel)) cancel();
  else {
    gloves(player, I.FALCONERS_GLOVE);
    player.performGraphic(H.core.Graphic.delayed(FALCON_LAUNCH_GRAPHIC, 0, FALCON_START_HEIGHT));
    new H.core.Projectile(from, to, npc, FALCON_TRAVEL_PROJECTILE, FALCON_LAUNCH_CYCLES, arrival,
      FALCON_START_HEIGHT, FALCON_END_HEIGHT, player.getPrivateArea()).withAngle(FALCON_ANGLE).withProgress(FALCON_PROGRESS).sendProjectile();
  }
}

/** Wiki (Falconry): bones and fur always, plus a raw dashing kebbit from the dashing kebbit. */
function prey(def) {
  return [H.core.ItemIdentifiers.BONES, def.fur, ...(def.meat === null ? [] : [def.meat])].map(itemId => ({ itemId, amount: 1, noted: false }));
}

/**
 * Wiki (Falconry, "Full inventory"): what doesn't fit is discarded, not dropped, and the falcon is
 * retrieved all the same. A bonecrusher takes the bones through `npc-drops:generated`, as for a kill.
 */
function collect(player, npc, def) {
  const generated = { player, npc, npcId: def.npc, drops: prey(def), handled: false };
  H.api.emitCustomEvent("npc-drops:generated", generated);
  if (generated.handled) return;
  for (const drop of generated.drops) catchExchange(player, [], [[drop.itemId, drop.amount]]);
}

function retrieve({ player, npc }) {
  const state = caught.get(npc);
  if (!state) return false;
  if (state.player !== player) { player.sendMessage("This isn't your falcon."); return true; }
  if (!npc.isVisible() || !nearby(player, npc)) return true;
  begin(player, 1, ANIM.PICKUP, () => {
    if (caught.get(npc) !== state) return;
    collect(player, npc, state.def);
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
  if (!net) catchBarehanded(player, npc, npcId, def, name);
  else catchNetted(player, npc, npcId, def, weapon);
  return true;
}

/**
 * A net throw resolves on the tick the player reaches the creature, as implings do: animation, outcome
 * and XP together.
 */
function catchNetted(player, npc, npcId, def, weapon) {
  if (!active(player) || player.busy()) return;
  const wait = (lastNetThrow.get(player) ?? -Infinity) + NET_THROW_TICKS - H.tick;
  if (wait > 0) { tryAgain(player, npc, npcId, wait); return; }
  const I = H.core.ItemIdentifiers;
  const jarred = player.getInventory().contains(I.BUTTERFLY_JAR);
  const inputs = jarred ? [[I.BUTTERFLY_JAR, 1]] : [];
  const outputs = jarred ? [[def.jar, 1]] : [];
  if (!exchange(player, inputs, outputs, false)) { player.getInventory().full(); return; }
  C.cancel(player);
  player.getSkillManager().stopSkillable();
  const improved = weapon === I.MAGIC_BUTTERFLY_NET;
  player.performAnimation(new H.core.Animation(improved ? ANIM.NET : ANIM.BUTTERFLY));
  lastNetThrow.set(player, H.tick);
  const curve = improved && def.handsLow !== undefined ? { ...def, low: def.handsLow, high: def.handsHigh } : def;
  const catchBonus = improved && (def.handsLow === undefined || def.boost === "restore") ? 20 / 256 : 0;
  if (!chance(player, curve, catchBonus, def.level)) {
    player.sendMessage("The creature slips away.");
    tryAgain(player, npc, npcId, RETRY_TICKS);
    return;
  }
  if (!exchange(player, inputs, outputs)) return;
  xp(player, def.xp, "butterfly", npcId);
  if (!jarred) freed(player, def);
  player.sendMessage(jarred ? "You catch the creature in a jar." : "You catch the creature in your net and release it.");
}

/**
 * The next try at a butterfly or moth that got away: up to it, wherever it has flown, and Catch again.
 * A walk or another interaction cancels the wait and a teleport drops the interaction, as for a repeating
 * pickpocket; it also ends once the creature is gone, the weapon changes or the player is busy or fighting.
 */
function tryAgain(player, npc, npcId, ticks) {
  const slot = H.core.Equipment.WEAPON_SLOT;
  const weapon = player.getEquipment().get(slot).getId();
  H.core.TaskManager.submit(new H.core.CountdownTask(player.getIndex(), ticks, () => {
    if (player.getInteractingMobile() !== npc || !active(player) || player.busy() || !available(npc)
      || player.getCombat().getTarget() || player.getCombat().getAttacker()
      || player.getEquipment().get(slot).getId() !== weapon) return;
    player.getMovementQueue().walkToEntity(npc, () => catchNpc({ player, npc, npcId }));
  }));
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
    player.sendMessage("The creature slips away.");
    tryAgain(player, npc, npcId, RETRY_TICKS);
    return;
  }
  const graphic = H.core.CacheDefinitions.getSpotanimId(def.release);
  if (graphic != null) player.performGraphic(new H.core.Graphic(graphic, RELEASE_DELAY, RELEASE_HEIGHT));
  player.getPacketSender().sendSound(RELEASE_SOUND, 1, RELEASE_DELAY);
  player.getPacketSender().sendTypedMessage(H.core.ChatType.SPAM, `You catch and release the ${name}.`);
  // `hunter:barehand-caught` { player, name }: "moonlight moth" (a league's "Catch a moonlight moth bare-handed").
  H.api.emitCustomEvent("hunter:barehand-caught", { player, name });
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
  // Spam in every recording: the jar line 395 times, the loot line 7.
  player.getPacketSender().sendTypedMessage(H.core.ChatType.SPAM, jarred ? JAR_MESSAGE : LOOT_MESSAGE);
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
  else boostSkill(player, def.boost, 4, 0.15);
}

function boost(event) {
  const def = H.data.butterflies.find(c => c.jar === event.itemId);
  if (!def) return;
  event.handled = true;
  const { player, target } = event;
  if (!nearby(player, target) || target.getAttribute("accept-aid") === false || target.getHitpoints() <= 0
    || !exchange(player, [[def.jar, 1]], [[H.core.ItemIdentifiers.BUTTERFLY_JAR, 1]])) return;
  bonus(target, def);
  share(target, def, player);
  target.sendMessage("A butterfly restores your vigour.");
}

/** In a multicombat area up to three other players within two tiles of `centre` who accept aid get the same bonus. */
function share(centre, def, user = null) {
  if (!H.api.getAreaManager().inMulti(centre)) return;
  const others = H.core.World.getNearbyPlayersForUpdate(centre).filter(p => p !== centre && p !== user
    && nearby(centre, p, 2) && p.getAttribute("accept-aid") !== false && p.getHitpoints() > 0);
  for (let i = 0; i < 3 && others.length; i++) bonus(others.splice(roll(0, others.length - 1), 1)[0], def);
}

// Wiki (Hunter's mix and each mix's page): a jarred butterfly or moth mixed with raw hunter meat, two
// doses, each giving the jar's own bonus (Attack, Defence or Strength 4 + 15%; 8 Hitpoints; the
// sunlight moth's restore and 8 Hitpoints; 22 Prayer) to the drinker and, in a multicombat area, to
// up to three players within two tiles of them who have Accept Aid on. They share the potions' 3-tick
// delay but add no eating or attack delay (`eatingDelay: false`); the chugging barrel can't store
// them (Wiki: Chugging barrel, `chuggable: false`). Ours: what the last dose leaves
// (the Wiki doesn't say); the butterfly jar the mix was made in.
const MIXES = [
  ["Ruby harvest mix", "RUBY_HARVEST_MIX", "RUBY_HARVEST"],
  ["Sapphire glacialis mix", "SAPPHIRE_GLACIALIS_MIX", "SAPPHIRE_GLACIALIS"],
  ["Snowy knight mix", "SNOWY_KNIGHT_MIX", "SNOWY_KNIGHT"],
  ["Black warlock mix", "BLACK_WARLOCK_MIX", "BLACK_WARLOCK"],
  ["Sunlight moth mix", "SUNLIGHT_MOTH_MIX", "SUNLIGHT_MOTH_2"],
  ["Moonlight moth mix", "MOONLIGHT_MOTH_MIX", "MOONLIGHT_MOTH_2"],
];

/** Drink on the hunter's mixes, through the potions plugin's doses and delay ("potions:register"). */
function registerMixes() {
  const I = H.core.ItemIdentifiers;
  for (const [name, key, jar] of MIXES) {
    const def = H.data.butterflies.find(c => c.jar === I[jar]);
    if (!def) continue;
    H.api.emitCustomEvent("potions:register", {
      name, chains: [[I[`${key}_2_`], I[`${key}_1_`]]], emptyItemId: I.BUTTERFLY_JAR, eatingDelay: false, chuggable: false,
      effect: (player) => { bonus(player, def); share(player, def); },
    });
  }
}

/** The crystal impling's elven signet: its row on a league's Boosted drops page, and its 1-in-n. */
const SIGNET_SOURCE = "Crystal impling";
const SIGNET_CHANCE = 128;

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
    // The elven signet is 1 in 128 (a league's boosted drops: "drops:chance", source "Crystal impling").
    if (def.key === "CRYSTAL" && roll(1, SIGNET_CHANCE) <= C.dropMultiplier(player, SIGNET_SOURCE, I.ELVEN_SIGNET)) result.push([I.ELVEN_SIGNET, 1]);
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
    if (roll(1, oneIn) !== 1) continue;
    // A hit the player cannot take is lost; the tier's clue scroll warning mentions it.
    if (C.ownsClue(player, tier)) H.api.emitCustomEvent("treasure-trails:missed-clue", { player, tier: tier.toLowerCase() });
    else result.push([id, 1]);
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
  for (const state of caught.values()) {
    if (state.appearAt !== undefined && H.tick >= state.appearAt && state.falcon.isRegistered()) {
      state.falcon.setVisible(true);
      state.appearAt = undefined;
    }
    if (H.tick < state.due && state.falcon.isRegistered()) continue;
    if (H.tick >= state.due) state.player.sendMessage(LOST_PREY_MESSAGE);
    removeFalcon(state);
  }
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

module.exports = { catchNpc, hire, dialogueLend, retrieve, release, boost, registerMixes, loot, rewards, equipment, login, process, cleanup };
