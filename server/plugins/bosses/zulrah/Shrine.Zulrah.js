"use strict";

/**
 * The way to Zulrah and back, and what a kill or a death leaves behind.
 *
 * Wiki:
 * - "Sacrificial boat" (Board, Quick-Board) at the Zul-Andra pier takes the player to the shrine;
 *   it refuses while Zul-Gwenwynig still holds their items.
 * - Zulrah's loot lands under the player, and a Zul-Andra teleport scroll (11701, Read) appears
 *   beside them; reading it returns them to Zul-Andra (2196, 3056), as the loot's Zul-andra
 *   teleport scrolls do from anywhere.
 * - Damage dealt to Zulrah is capped at 50: anything higher hits for 45-50.
 * - On a death at the shrine, the items that would be lost are held by Priestess Zul-Gwenwynig:
 *   free to reclaim before 50 kills, then 100,000 coins each time. Dying anywhere (unsafe)
 *   before reclaiming them loses them for good.
 * Near-Reality: the boat's "Return to Zulrah's shrine?" choice, the priestess's lines when she
 * holds items or has none, logging in on the shrine putting the player back at the pier, the "Leave Zulrah's shrine?" choice on the scroll, where beside the
 * player the scroll lands, and the scroll-reading animation and graphic.
 */

const Shared = require("./ZulrahShared");
const Fight = require("./ZulrahFight");
const { MeleeSnakeling, MagicSnakeling } = require("./ZulrahHazards");

const DAMAGE_CAP = 50;
const HALBERD_REACH = 2;
const CAPPED_DAMAGE = [45, 50];
const FREE_RETRIEVALS = 50;
const RETRIEVAL_FEE = 100000;
const COINS = 995;
const BOAT_TEXT = "The priestess rows you to Zulrah's shrine,<br>then hurriedly paddles away.";

// ---------------------------------------------------------------- access

/** Everyone may be Zulrah's sacrifice: the boat and the priestess show their full options. */
function grantAccess({ player }) {
  player.getPacketSender().sendVarbit(Shared.ACCESS_VARBIT, Shared.ACCESS_VALUE);
}

/** Logged in on the shrine with no fight left (it ended at logout): back by the boat. */
function returnFromShrine({ player }) {
  if (!Shared.inShrine(player.getLocation()) || Fight.fightOf(player)) return;
  player.moveTo(Shared.loc(Shared.PIER));
}

// ---------------------------------------------------------------- the boat

function heldItems(player) {
  const held = player.getAttribute(Shared.ATTR.RETRIEVAL);
  return Array.isArray(held?.items) ? held : null;
}

function refusedBoarding(player) {
  if (!heldItems(player)) return false;
  Shared.npcSay(player, Shared.NPC.PRIESTESS, "I've got some stuff you left at the shrine earlier. You should get it back from me before sacrificing yourself again.");
  return true;
}

function sail(player) {
  Shared.fade(player, true);
  Shared.later(player, 2, () => {
    Fight.start(player);
    Shared.fade(player, false);
    Shared.statement(player, BOAT_TEXT);
  });
}

function board({ player }) {
  if (refusedBoarding(player)) return true;
  Shared.options(player, "Return to Zulrah's shrine?", "Yes.", () => sail(player), "No.", () => {});
  return true;
}

function quickBoard({ player }) {
  if (refusedBoarding(player)) return true;
  sail(player);
  return true;
}

// ---------------------------------------------------------------- the teleport scroll

let scrollTeleport = null;

/** Reading a teleport scroll: anim 3864 and graphic 1039 (Near-Reality's, both in the cache). */
function scrollType() {
  if (scrollTeleport) return scrollTeleport;
  const { Animation, Graphic, Priority, TeleportType } = Shared.core();
  scrollTeleport = new TeleportType(3, new Animation(3864, Priority.HIGH), null, Animation.DEFAULT_RESET_ANIMATION, new Graphic(1039), null, null);
  return scrollTeleport;
}

function toZulAndra(player) {
  const { TeleportHandler } = Shared.core();
  const destination = Shared.loc(Shared.ZUL_ANDRA);
  if (!TeleportHandler.checkReqs(player, destination)) return false;
  TeleportHandler.teleport(player, destination, scrollType(), false);
  return true;
}

function readTeleport(event) {
  if (event.objectId !== Shared.OBJECT.TELEPORT) return;
  event.handled = true;
  const { player } = event;
  Shared.options(player, "Leave Zulrah's shrine?", "Yes.", () => toZulAndra(player), "No.", () => {});
}

/** The Zul-andra teleport scrolls in Zulrah's loot (Wiki: teleport to Zul-Andra). */
function readScroll({ player, itemId }) {
  if (!player.getInventory().contains(itemId)) return true;
  if (toZulAndra(player)) player.getInventory().delete(itemId, 1);
  return true;
}

/** On a free tile beside the player, north-east first; under them if none is free. */
function placeTeleport(fight) {
  const { GameObject, ObjectManager, RegionManager, Location } = Shared.core();
  const at = fight.player.getLocation();
  let tile = null;
  for (let y = at.getY() + 1; y >= at.getY() - 1 && !tile; y--) {
    for (let x = at.getX() + 1; x >= at.getX() - 1; x--) {
      if (x === at.getX() && y === at.getY()) continue;
      if ((RegionManager.getClipping(x, y, 0, fight.area) & 0x1280100) === 0) {
        tile = new Location(x, y, 0);
        break;
      }
    }
  }
  fight.teleport = new GameObject(Shared.OBJECT.TELEPORT, tile ?? at.clone(), 10, 0, fight.area);
  ObjectManager.register(fight.teleport, true);
}

// ---------------------------------------------------------------- the kill

function formatTicks(ticks) {
  const seconds = ticks * 0.6;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

function onZulrahDeath({ npc }) {
  const fight = npc?.__zulrahFight;
  if (!fight || !Shared.isZulrah(npc) || fight.stage !== "fight") return;
  const player = fight.player;
  fight.onZulrahDeath();
  const kills = (Number(player.getAttribute(Shared.ATTR.KILLS)) || 0) + 1;
  player.setAttribute(Shared.ATTR.KILLS, kills);
  const ticks = fight.duration();
  const best = Number(player.getAttribute(Shared.ATTR.BEST_TIME)) || 0;
  player.sendMessage(`Your Zulrah kill count is: <col=ff0000>${kills}</col>.`);
  if (!best || ticks < best) {
    player.setAttribute(Shared.ATTR.BEST_TIME, ticks);
    player.sendMessage(`Fight duration: <col=ff0000>${formatTicks(ticks)}</col> (new personal best)`);
  } else {
    player.sendMessage(`Fight duration: <col=ff0000>${formatTicks(ticks)}</col>. Personal best: ${formatTicks(best)}`);
  }
  placeTeleport(fight);
}

/** Zulrah's loot lands under the player, not in the swamp. */
function lootUnderPlayer(event) {
  const fight = event.npc?.__zulrahFight;
  if (!fight || !Shared.isZulrah(event.npc)) return;
  event.location = fight.player.getLocation().clone();
}

function capDamage({ npc, hit }) {
  if (!Shared.isZulrah(npc) || !npc.__zulrahFight) return;
  let capped = false;
  for (const part of hit.getHits()) {
    if (part.getDamage() <= DAMAGE_CAP) continue;
    part.setDamage(Shared.randomInt(Math.random, ...CAPPED_DAMAGE));
    capped = true;
  }
  if (capped) hit.updateTotalDamage();
}

/** Melee reaches Zulrah only with a halberd (Wiki); its west place is otherwise in reach. */
function outOfMeleeReach(event) {
  const { CombatType } = Shared.core();
  const method = event.method;
  if (!method || method.type() !== CombatType.MELEE) return false;
  return (method.attackDistance?.(event.attacker) ?? 1) < HALBERD_REACH;
}

/** Only the fight's own player, never while Zulrah is under the swamp, melee only by halberd. */
function onlyWhenSurfaced(event) {
  const npc = event.target?.__zulrahFight ? event.target : event.attacker?.__zulrahFight ? event.attacker : null;
  if (!npc) return;
  const fight = npc.__zulrahFight;
  const other = npc === event.target ? event.attacker : event.target;
  if (other?.isPlayer?.() && other !== fight.player) {
    event.allow = false;
    return;
  }
  if (npc !== fight.zulrah || npc !== event.target) return;
  if (!fight.attackable) {
    event.allow = false;
  } else if (outOfMeleeReach(event)) {
    event.attacker.sendMessage?.("I can't reach that!");
    event.allow = false;
  }
}

// ---------------------------------------------------------------- death and retrieval

/**
 * A death at the shrine: what would drop is held by Zul-Gwenwynig. A later unsafe death
 * anywhere else, before collecting, loses what she holds.
 */
function holdForPriestess(event) {
  const { player, item } = event;
  const atShrine = Fight.fightOf(player) != null || Shared.inShrine(player.getLocation());
  if (!atShrine) {
    if (event.shouldDropItems && heldItems(player)) {
      player.setAttribute(Shared.ATTR.RETRIEVAL, null);
    }
    return;
  }
  if (!event.dropEligible) return;
  const held = heldItems(player) ?? { items: [], paid: false };
  held.items.push([item.getId(), item.getAmount()]);
  player.setAttribute(Shared.ATTR.RETRIEVAL, held);
  event.handled = true;
}

function announceHeld({ player }) {
  if (!Shared.inShrine(player.getLocation()) && !Fight.fightOf(player)) return;
  if (heldItems(player)) player.sendMessage("Priestess Zul-Gwenwynig has retrieved some of your items. You can collect them from her at the pier in Zul-Andra.");
}

/** The fee: free for the first 50 kills, then 100,000 coins once per death (Wiki). */
function payFee(player, held) {
  if (held.paid || (Number(player.getAttribute(Shared.ATTR.KILLS)) || 0) < FREE_RETRIEVALS) return true;
  const inventory = player.getInventory();
  if (inventory.getAmount(COINS) < RETRIEVAL_FEE) {
    Shared.npcSay(player, Shared.NPC.PRIESTESS, "I'll need 100,000 coins before I give you back your things.");
    return false;
  }
  inventory.delete(COINS, RETRIEVAL_FEE);
  held.paid = true;
  return true;
}

/** While she holds items, she says so and hands them back (Near-Reality); else her transcript. */
function talkTo({ player }) {
  if (!heldItems(player)) return false;
  const { DialogueChainBuilder, NpcDialogue, ActionDialogue } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, Shared.NPC.PRIESTESS, "You left some stuff at Zulrah's shrine when you left earlier."),
    new ActionDialogue(1, { execute: () => collect({ player }) }),
  ));
  return true;
}

function collect({ player }) {
  const held = heldItems(player);
  if (!held) {
    Shared.npcSay(player, Shared.NPC.PRIESTESS, "I'm afraid I don't have anything for you to collect. If I had any of your items, but you died before collecting them from me, I'd lose them.");
    return true;
  }
  if (!payFee(player, held)) return true;
  const { Item, ItemDefinition } = Shared.core();
  const inventory = player.getInventory();
  const left = [];
  for (const [id, amount] of held.items) {
    const stackable = ItemDefinition.forId(id)?.isStackable?.();
    const fits = stackable ? inventory.contains(id) || inventory.getFreeSlots() > 0 : inventory.getFreeSlots() > 0;
    if (fits) inventory.add(new Item(id, amount), false);
    else left.push([id, amount]);
  }
  inventory.refreshItems?.();
  player.setAttribute(Shared.ATTR.RETRIEVAL, left.length > 0 ? { items: left, paid: held.paid } : null);
  if (left.length > 0) player.sendMessage("You don't have enough inventory space to collect all of your items.");
  else player.sendMessage("You collect your items from the priestess.");
  return true;
}

/** The collection log's "Zulrah kills" are the shrine's own count. */
function collectionLogCount(request) {
  if (request.category === "Zulrah") request.count = Number(request.player.getAttribute(Shared.ATTR.KILLS)) || 0;
}

module.exports = function registerZulrahShrine(api) {
  Shared.bind(api);
  api.onCustomEvent("collection-log:category-count", collectionLogCount);
  for (const key of Object.values(Shared.ATTR)) api.persistAttribute(key);
  api.registerNpcCombatMethodProvider([...Shared.FORM_IDS], Fight.idleMethod(), { singleton: false });
  api.registerNpcCombatMethodProvider([Shared.NPC.SNAKELING_MELEE], MeleeSnakeling(), { singleton: false });
  api.registerNpcCombatMethodProvider([Shared.NPC.SNAKELING_MAGIC], MagicSnakeling(), { singleton: false });
  api.onPlayerLogin(grantAccess);
  api.onPlayerLogin(returnFromShrine);
  api.onObjectInteraction(Shared.OBJECT.BOAT, { Board: board, "Quick-Board": quickBoard });
  api.onObjectInteraction(readTeleport);
  api.onItemAction("Zul-andra teleport", { Teleport: readScroll });
  api.onNpcInteraction("Priestess Zul-Gwenwynig", { "Talk-to": talkTo, Collect: collect });
  api.onNpcDeath(onZulrahDeath);
  api.onCustomEvent("npc-drops:location", lootUnderPlayer);
  api.onNpcHitModify(capDamage);
  api.onCanAttack(onlyWhenSurfaced);
  api.onPlayerDeathItemDrop(holdForPriestess);
  api.onPlayerDeath(announceHeld);
};

module.exports.board = board;
module.exports.quickBoard = quickBoard;
module.exports.collect = collect;
module.exports.talkTo = talkTo;
module.exports.returnFromShrine = returnFromShrine;
module.exports.capDamage = capDamage;
module.exports.holdForPriestess = holdForPriestess;
module.exports.onZulrahDeath = onZulrahDeath;
module.exports.lootUnderPlayer = lootUnderPlayer;
module.exports.onlyWhenSurfaced = onlyWhenSurfaced;
module.exports.readTeleport = readTeleport;
module.exports.readScroll = readScroll;
module.exports.formatTicks = formatTicks;
