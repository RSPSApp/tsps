/**
 * Warriors' Guild: Jimmy's keg balancing. With the head and both hands empty, up to five kegs are
 * stacked on the player's head; the stack costs run energy and falls more often as energy runs
 * low, hurting for up to 4 (Wiki). The Wiki gives no reward numbers, so Strength XP and tokens
 * when the stack falls, the energy drain and the fall chance are Near-Reality's. Jimmy writes the
 * tokens in the guild ledger for the staff to pay out.
 */
const Guild = require("./Common.WarriorsGuild");

/** The five kegs (multilocs that hide for the player carrying them) and their varbits. */
const KEGS = new Map([[15669, 2253], [15670, 2254], [15671, 2255], [15672, 2256], [15673, 2252]]);
const ROOM = { minX: 2861, maxX: 2878, minY: 3535, maxY: 3543, z: 1 };
const PICK_UP_ANIMATION = 4180;
const PICK_UP_TICKS = 2;
/** Stand 4179 and walk 4178 while balancing; the turns stay the default ones. */
const BALANCE_ANIMATIONS = [4179, 823, 4178, 820, 821, 822, 4178];
/** Graphic of the falling stack, by keg count (one keg 688 ... five 684). */
const FALL_GRAPHIC_BASE = 689;
const DRAIN_EVERY = 10;
const DRAIN = 9;
const KEG_LEDGER_ATTRIBUTE = "warriors-guild:keg-tokens";

/** player -> { kegs, ticks, taken: keg loc ids }. */
const balancing = new Map();

function kegLedger(player) {
  return Number(player.getAttribute(KEG_LEDGER_ATTRIBUTE)) || 0;
}

function inRoom(player) {
  const at = player.getLocation();
  return at.getZ() === ROOM.z && at.getX() >= ROOM.minX && at.getX() <= ROOM.maxX && at.getY() >= ROOM.minY && at.getY() <= ROOM.maxY;
}

function setHead(player, itemId) {
  const { Equipment, Item, Flag } = Guild.core;
  player.getEquipment().setItem(Equipment.HEAD_SLOT, new Item(itemId, itemId > 0 ? 1 : 0));
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(Flag.APPEARANCE);
}

function pickUpKeg({ player, objectId }) {
  if (!KEGS.has(objectId)) return false;
  const { Equipment, Animation } = Guild.core;
  const state = balancing.get(player);
  const items = player.getEquipment().getItems();
  const busy = [Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT, Equipment.HANDS_SLOT, ...(state ? [] : [Equipment.HEAD_SLOT])]
    .some((slot) => items[slot]?.getId() > 0);
  if (busy) {
    // ponytail: Near-Reality's wording; the Wiki gives the rule but not the message.
    player.sendMessage("You must have both your hands as well as your head completely free to balance kegs.");
    return;
  }
  if (state?.taken.has(objectId)) return;
  player.performAnimation(new Animation(PICK_UP_ANIMATION));
  Guild.later(player, PICK_UP_TICKS, () => {
    if (!inRoom(player)) return;
    const current = balancing.get(player) ?? { kegs: 0, ticks: 0, taken: new Set() };
    current.kegs++;
    current.taken.add(objectId);
    balancing.set(player, current);
    player.getPacketSender().sendVarbit(KEGS.get(objectId), 1);
    setHead(player, Guild.ITEMS.ONE_BARREL + current.kegs - 1);
    player.setRenderAnimations(BALANCE_ANIMATIONS);
    const jimmy = Guild.npcNear(player, Guild.NPCS.JIMMY);
    jimmy?.forceChat(current.kegs <= 3
      ? `Ya got no chance o' beatin' me ${player.getUsername()}!`
      : `No one's stronger than me, 'speshly not ${player.getUsername()}!`);
  });
}

/** Puts the kegs back where they came from and the player's look back to normal. */
function clearKegs(player, state) {
  balancing.delete(player);
  for (const objectId of state.taken) player.getPacketSender().sendVarbit(KEGS.get(objectId), 0);
  setHead(player, -1);
  player.setRenderAnimations(null);
}

function loseBalance(player, state) {
  const { Graphic, Skill } = Guild.core;
  clearKegs(player, state);
  player.performGraphic(new Graphic(FALL_GRAPHIC_BASE - state.kegs));
  player.getMovementQueue().reset();
  Guild.damage(player, Guild.random(2, 4));
  player.sendMessage("You lose balance and the kegs fall onto your head.");
  player.forceChat("Ouch!");
  if (state.kegs > 1) {
    player.getSkillManager().addExperiences(Skill.STRENGTH, 10 * state.kegs);
    player.setAttribute(KEG_LEDGER_ATTRIBUTE, kegLedger(player) + 10 * state.kegs + Math.floor(state.ticks / 2));
  }
  if (state.kegs >= 5) {
    Guild.npcNear(player, Guild.NPCS.JIMMY)
      ?.forceChat(`Wow! That'sh bery impr....imp...impresh.... good ${player.getUsername()}! Equalsh my record!`);
  }
}

function balance({ player }) {
  const state = balancing.get(player);
  if (!state) return;
  if (!inRoom(player)) {
    // "Any kegs being balanced disappear if the player leaves the room."
    clearKegs(player, state);
    return;
  }
  if (state.ticks++ % DRAIN_EVERY === 0) {
    player.setRunEnergy(player.getRunEnergy() - DRAIN);
    player.getPacketSender().sendRunEnergy();
  }
  const running = player.getMovementQueue().isMovings() && player.getMovementQueue().isRunToggled();
  if (running || player.getRunEnergy() * Math.random() <= Guild.random(0, 15)) loseBalance(player, state);
}

/** Barrels can't be taken off; anything worn on the head or in the hands drops the stack. */
function keepBarrelsOn(event) {
  const head = Guild.core.Equipment.HEAD_SLOT;
  if (event.slot === head && balancing.has(event.player)) event.allow = false;
}

function equipWhileBalancing(event) {
  const state = balancing.get(event.player);
  const { Equipment } = Guild.core;
  if (state && [Equipment.HEAD_SLOT, Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT, Equipment.HANDS_SLOT].includes(event.slot)) {
    loseBalance(event.player, state);
  }
}

function dropKegs({ player }) {
  const state = balancing.get(player);
  if (state) clearKegs(player, state);
}

// --- Jimmy writes the keg tokens into the ledger.

function jimmyCondition({ player, npcId, text }) {
  if (npcId !== Guild.NPCS.JIMMY) return null;
  if (text === "If the player has tokens to claim:") return kegLedger(player) > 0;
  if (text === "If the player has no tokens to claim:") return kegLedger(player) === 0;
  return null;
}

function jimmyWritesLedger(event) {
  if (event.npcId !== Guild.NPCS.JIMMY || !/scribbles the tokens/.test(event.text ?? "")) return;
  Guild.credit(event.player, kegLedger(event.player));
  event.player.setAttribute(KEG_LEDGER_ATTRIBUTE, 0);
}

module.exports = function attachKegs(api) {
  api.persistAttribute(KEG_LEDGER_ATTRIBUTE);
  api.onObjectFirstClick([...KEGS.keys()], pickUpKeg);
  api.onPlayerProcess(balance);
  api.onCanUnequip(keepBarrelsOn);
  api.onCanEquip(equipWhileBalancing);
  api.onPlayerLogout(dropKegs);
  api.onPlayerDeath(dropKegs);
  api.onNpcDialogueCondition(jimmyCondition);
  api.onCustomEvent("npc-dialogue:action", jimmyWritesLedger);
};
