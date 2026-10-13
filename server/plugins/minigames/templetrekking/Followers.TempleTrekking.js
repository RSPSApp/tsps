/**
 * The people waiting to be escorted: six in Burgh de Rott (Temple Trekking, after In Aid of the
 * Myreque) and six outside Paterdomus (the Burgh de Rott Ramble, after Darkness of Hallowvale).
 * They are cache multinpcs shown by templetrek_npcs_visible / ramble_npcs_visible, which this
 * unit sets from the quests. Talk-to and Escort start a trek; food used on them goes into the
 * backpack all followers share (Wiki, "Supplying your follower"), and during a trek they eat
 * from it when hurt.
 */
const Common = require("./Common.TempleTrekking");
const Trek = require("./Trek.TempleTrekking");

const EAT_ANIMATION = 829;
const EAT_COOLDOWN_TICKS = 3;

function syncVisibility(player) {
  const { quests, directions } = Common.data;
  for (const [direction, key] of Object.entries(quests)) {
    Common.varbit(player, directions[direction].visibleVarbit, Common.questComplete(player, key) ? 1 : 0);
  }
}

function onLogin({ player }) {
  syncVisibility(player);
}

function onQuestCompleted({ player, key }) {
  if (Object.values(Common.data.quests).includes(key)) syncVisibility(player);
}

function followerOf(event) {
  return Common.follower(event.npcId ?? event.definition?.getId?.());
}

function hasPet(player) {
  const request = { player, pet: null };
  Common.api.emitCustomEvent("pets:current", request);
  return request.pet != null;
}

function escort(player, follower) {
  if (Trek.trekOf(player)) return;
  if (!Common.questComplete(player, Common.data.quests[follower.direction])) return;
  const line = Common.data.dialogue;
  const escortLine = Common.data.directions[follower.direction].escort;
  if (hasPet(player)) {
    Common.chat(player, [["player", escortLine], ["npc", follower.id, line.hasFollower]]);
    return;
  }
  Common.chat(player, [["player", escortLine], ["npc", follower.id, line.accept]], () => {
    Common.closeChat(player);
    Trek.start(player, follower);
  });
}

function talk(player, follower) {
  const trek = Trek.trekOf(player);
  if (trek) {
    const chatter = trek.npc?.getCombat?.().getAttacker?.() || trek.npc?.getCombat?.().isBeingAttacked?.()
      ? Common.data.dialogue.underAttack
      : Common.randomOf(Common.data.dialogue[follower.direction].chatter);
    Common.chat(player, [["npc", follower.id, chatter]]);
    return;
  }
  const lines = Common.data.dialogue[follower.direction];
  Common.chat(player, [["player", lines.greeting[0]], ["npc", follower.id, lines.greeting[1]]], () => menu(player, follower));
}

function menu(player, follower) {
  const lines = Common.data.dialogue[follower.direction];
  const back = () => menu(player, follower);
  const options = [];
  if (follower.direction === "temple") {
    options.push([lines.options[0], () => Common.chat(player, [["player", lines.where[0]], ["npc", follower.id, lines.where[1]]], back)]);
  } else {
    options.push([lines.options[0], () => Common.chat(player, lines.prepared.map(([who, text]) => (who === "npc" ? ["npc", follower.id, text] : ["player", text])), back)]);
  }
  options.push([lines.options[1], () => Common.chat(player, [["player", lines.why[0]], ["npc", follower.id, lines.why[1]]], back)]);
  options.push([lines.options[2], () => Common.chat(player, [["player", lines.defend], ["npc", follower.id, lines.defendAnswer[follower.difficulty]]], back)]);
  options.push([lines.options[3], () => escort(player, follower)]);
  options.push([lines.options[4], () => Common.chat(player, [["player", Common.data.dialogue.okThanks]])]);
  Common.choose(player, "Select an Option", options);
}

function talkTo(event) {
  const follower = followerOf(event);
  if (!follower) return false;
  talk(event.player, follower);
  return true;
}

function escortOp(event) {
  const follower = followerOf(event);
  if (!follower) return false;
  escort(event.player, follower);
  return true;
}

// ------------------------------------------------------------------ the backpack

function pack(player) {
  return [...(player.getAttribute(Common.PACK_ATTRIBUTE) ?? [])];
}

const packCount = (items) => items.reduce((sum, item) => sum + item.amount, 0);

function spacesLeft(player) {
  return Common.data.food.capacity - packCount(pack(player));
}

/** Moves the used food (as much as fits) from the inventory into the shared backpack. */
function supplyFood(player, itemId) {
  const items = pack(player);
  const room = Common.data.food.capacity - packCount(items);
  const amount = Math.min(room, player.getInventory().getAmount(itemId));
  if (amount > 0) {
    player.getInventory().deleteNumber(itemId, amount);
    const entry = items.find((item) => item.id === itemId);
    if (entry) entry.amount += amount;
    else items.push({ id: itemId, amount });
    player.setAttribute(Common.PACK_ATTRIBUTE, items);
  }
  player.sendMessage(`Spaces left: ${Common.data.food.capacity - packCount(items)}`);
}

function supplyOp(event) {
  const follower = followerOf(event);
  if (!follower) return false;
  const { player } = event;
  Common.chat(player, [["npc", follower.id, Common.data.dialogue.supplies]], () => {
    Common.closeChat(player);
    player.sendMessage(`Spaces left: ${spacesLeft(player)}`);
  });
  return true;
}

function foodOnFollower(event) {
  const follower = Common.follower(event.npcId);
  const heals = Common.data.food.items[event.itemId];
  if (!follower || heals == null) return;
  event.handled = true;
  const { player, target } = event;
  const trek = Trek.trekOf(player);
  if (trek && target === trek.npc) {
    // During a trek food heals a hurt follower 10 hitpoints, whatever it is (Wiki).
    if (target.getHitpoints() >= target.getMaxHitpoints()) return;
    player.getInventory().deleteNumber(event.itemId, 1);
    target.heal(Common.data.food.eventHeal);
    target.performAnimation(new Common.core.Animation(EAT_ANIMATION));
    target.forceChat(Common.data.dialogue.eatsGiven);
    return;
  }
  if (trek) return;
  Common.chat(player, [["npc", follower.id, Common.data.dialogue.supplies]], () => {
    Common.closeChat(player);
    supplyFood(player, event.itemId);
  });
}

/**
 * A hurt follower eats from the backpack, the biggest heal first, as captured ("Your companion
 * has eaten some food. She has 14 food units left.").
 */
function feedFromPack(trek) {
  const npc = trek.npc;
  if (!npc || !npc.isRegistered?.() || npc.getHitpoints() <= 0) return;
  const max = npc.getMaxHitpoints();
  if (npc.getHitpoints() > max / 2 || (npc.__trekAteAt ?? -99) + EAT_COOLDOWN_TICKS > trek.tickCount) return;
  const items = pack(trek.player);
  if (!items.length) return;
  items.sort((a, b) => (Common.data.food.items[b.id] ?? 0) - (Common.data.food.items[a.id] ?? 0));
  const food = items[0];
  food.amount--;
  const left = items.filter((item) => item.amount > 0);
  trek.player.setAttribute(Common.PACK_ATTRIBUTE, left);
  npc.__trekAteAt = trek.tickCount;
  npc.performAnimation(new Common.core.Animation(EAT_ANIMATION));
  npc.setHitpoints(Math.min(max, npc.getHitpoints() + (Common.data.food.items[food.id] ?? 0)));
  trek.player.sendMessage(`Your companion has eaten some food. ${trek.follower.she ? "She" : "He"} has ${packCount(left)} food units left.`);
}

function attachFollowers(api) {
  const names = Common.data.followers.map((follower) => follower.name);
  api.onNpcsInteraction(names, { "Talk-to": talkTo, Escort: escortOp, Supply: supplyOp });
  api.onItemOnNpc(foodOnFollower);
  api.onPlayerLogin(onLogin);
  api.onCustomEvent("quest:completed", onQuestCompleted);
}

module.exports = { attachFollowers, feedFromPack };
