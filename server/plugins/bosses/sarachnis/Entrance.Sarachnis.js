/**
 * Getting to Sarachnis, in the Forthos Dungeon (docs/sarachnis.md):
 * - the dungeon webs (733) and the web before the tomb (34898 "Web", Slash/Peek): with
 *   Aranea boots the player wades through (11511 with the forced step, as captured);
 *   otherwise a slash weapon or knife slashes a way through (Wiki), or the way is refused;
 * - Peek on the tomb web counts the room ("...inside the crypt", captured for empty);
 * - the Thick Web (34858): from outside, Enter-crypt asks (public or rented), Quick-enter
 *   walks straight in (captured), Fight-privately rents at once; from inside the tomb every
 *   option on it just walks back out (inferred: live's own exit is the separate 34859 face).
 *   The way out (34859, Exit/Quick-Exit) steps back outside to (1842, 9913).
 * - a rented instance (Wiki: 25k from the bank, 12.5k with the hard Combat Achievement
 *   tier done) is a private lair with its own Sarachnis until the player leaves or logs out.
 */
const Common = require("./Common.Sarachnis");
const Lair = require("./Lair.Sarachnis");

const COINS = 995;
const THICK_WEB = "Thick Web";
const WEB = "Web";

let api = null;
let core = null;

function isPeekWeb(event) {
  return event.objectId === Common.PEEK_WEB_ID;
}

function isDungeonWeb(event) {
  if (event.objectId !== Common.DUNGEON_WEB_ID) return false;
  const at = event.location;
  return Common.DUNGEON_WEB_TILES.some(([x, y, z]) => at.x === x && at.y === y && (at.z ?? 0) === (z ?? 0));
}

function isSarachnisWeb(event) {
  return isPeekWeb(event) || isDungeonWeb(event);
}

/**
 * Where the wade leaves the player: through the web, one tile past it from the side the
 * player came from, so the wall is crossed instead of stopping on its clipped tile (where
 * the player could not walk on and reported the web as not working). A player already
 * standing on the web crosses its face, as the Wilderness wade does.
 */
function wadeDestination(event) {
  const { player, object } = event;
  const web = event.location;
  const from = player.getLocation();
  const dx = Math.sign(web.x - from.x);
  const dy = Math.sign(web.y - from.y);
  const distance = Math.max(Math.abs(web.x - from.x), Math.abs(web.y - from.y));
  if (distance === 1) return { x: web.x + dx, y: web.y + dy, z: web.z ?? 0 };
  if (distance === 0 && Number(object?.getType?.() ?? 10) <= 3) {
    const [ex, ey] = [[-1, 0], [0, 1], [1, 0], [0, -1]][object.getFace() & 3];
    return { x: web.x + ex, y: web.y + ey, z: web.z ?? 0 };
  }
  return { x: web.x, y: web.y, z: web.z ?? 0 };
}

/** Step onto or through the web's tile with the wade (boots) or the cut (tool), as captured. */
function passWeb(event, anim) {
  const { player } = event;
  const destination = wadeDestination(event);
  const movement = player.getMovementQueue();
  movement.reset();
  movement.setBlockMovement(true);
  player.performAnimation(new core.Animation(anim));
  Common.later(1, () => {
    if (!player.isRegistered?.()) return;
    player.moveTo(new core.Location(destination.x, destination.y, destination.z));
    movement.setBlockMovement(false);
  });
}

function slashWeb(event) {
  const { player, objectId } = event;
  if (objectId !== Common.PEEK_WEB_ID && objectId !== Common.DUNGEON_WEB_ID) return false;
  if (objectId === Common.DUNGEON_WEB_ID && !isDungeonWeb(event)) return false;
  if (Common.wearsAraneaBoots(player)) {
    passWeb(event, Common.ANIM.wade);
    return true;
  }
  if (Common.hasSlashTool(player)) {
    passWeb(event, Common.ANIM.slash);
    return true;
  }
  player.sendMessage("You need a slash weapon or a knife to get through the dense web.");
  return true;
}

/** Captured empty; the headcount follows the other bosses' Peek lines (estimate). */
function peekText(count) {
  if (count === 0) return "You listen and hear no adventurers inside the crypt";
  if (count === 1) return "You listen and hear 1 adventurer inside the crypt";
  return `You listen and hear ${count} adventurers inside the crypt`;
}

function peek({ player, objectId }) {
  if (objectId !== Common.PEEK_WEB_ID) return false;
  const { DialogueChainBuilder, StatementDialogue } = core;
  const count = Lair.lair.getPlayers().filter((other) => Common.inLair(other.getLocation())).length;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, peekText(count))));
  return true;
}

/** Captured: Quick-enter walks in with no anim, sound or fade. The step goes through
 * the web itself, so it is a forced move like the wade (normal pathing stops at the web,
 * as live's own click-to walk does). From inside, the web lets out. */
function enterPublic(player) {
  player.getPacketSender().sendInterfaceRemoval();
  player.moveTo(Common.location(Common.inLair(player.getLocation()) ? Common.OUTSIDE_TILE : Common.TELEPORT_TILE));
}

function quickEnter({ player, objectId }) {
  if (objectId !== Common.ENTRANCE_ID) return false;
  enterPublic(player);
  return true;
}

function bankCoins(player) {
  let total = 0;
  for (let tab = 0; tab < core.Bank.TOTAL_BANK_TABS; tab++) {
    if (tab === core.Bank.BANK_SEARCH_TAB_INDEX) continue;
    total += player.getBank(tab).getAmount(COINS);
  }
  return total;
}

function takeBankFee(player, amount) {
  let left = amount;
  for (let tab = 0; tab < core.Bank.TOTAL_BANK_TABS && left > 0; tab++) {
    if (tab === core.Bank.BANK_SEARCH_TAB_INDEX) continue;
    const bank = player.getBank(tab);
    const take = Math.min(bank.getAmount(COINS), left);
    if (take > 0) {
      bank.delete(COINS, take);
      left -= take;
    }
  }
  return left <= 0;
}

/** Wiki: 25k from the bank, 12.5k once the hard Combat Achievement tier is done. */
function instanceFee(player) {
  const hard = player.getPacketSender().getVarbit(Common.HARD_TIER_VARBIT) ?? 0;
  return hard >= 1 ? Common.INSTANCE_DISCOUNTED_FEE : Common.INSTANCE_FEE;
}

function formatCoins(amount) {
  return amount.toLocaleString("en-US");
}

function rentInstance(player) {
  player.getPacketSender().sendInterfaceRemoval();
  if (Common.inLair(player.getLocation())) {
    player.moveTo(Common.location(Common.OUTSIDE_TILE));
    return;
  }
  const fee = instanceFee(player);
  if (bankCoins(player) < fee) {
    player.sendMessage(`You need ${formatCoins(fee)} coins in your bank to rent a private instance.`);
    return;
  }
  if (!takeBankFee(player, fee)) {
    player.sendMessage(`You need ${formatCoins(fee)} coins in your bank to rent a private instance.`);
    return;
  }
  player.sendMessage(`<col=ef1020>${formatCoins(fee)} coins is taken from your bank to rent a private instance.</col>`);
  // Onto the other side first, like the public way in; the instance and its Sarachnis
  // appear in the same tick as the payment, so no logout, death or teleport in between
  // can take the coins without an instance to show for them. The step goes through the
  // web itself, so it is forced.
  player.moveTo(Common.location(Common.TELEPORT_TILE));
  Lair.createInstance(player);
}

function fightPrivately({ player, objectId }) {
  if (objectId !== Common.ENTRANCE_ID) return false;
  rentInstance(player);
  return true;
}

/** Enter-crypt asks first (the question is inferred; only Quick-enter was captured). */
function enterCrypt({ player, objectId }) {
  if (objectId !== Common.ENTRANCE_ID) return false;
  if (Common.inLair(player.getLocation())) {
    enterPublic(player);
    return true;
  }
  const fee = instanceFee(player);
  api.sendMultiChatboxPrompt(
    player,
    "Enter the tomb?",
    "Enter the crypt.", () => enterPublic(player),
    `Rent a private instance. (${formatCoins(fee)} coins)`, () => rentInstance(player),
    "Cancel.", () => player.getPacketSender().sendInterfaceRemoval(),
  );
  return true;
}

function exit({ player, objectId }) {
  if (objectId !== Common.EXIT_ID) return false;
  player.moveTo(Common.location(Common.OUTSIDE_TILE));
  return true;
}

/** The Wilderness plugin also answers loc 733 ("Web") by name; claim Forthos' own dungeon
 * webs for Sarachnis' wade first, so they are not cut with the Wilderness web's chance. */
function claimDungeonWeb(event) {
  if (event.objectId !== Common.DUNGEON_WEB_ID || !isDungeonWeb(event)) return;
  if (String(event.option ?? "").toLowerCase() !== "slash") return;
  event.handled = slashWeb(event);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onBeforeObjectInteraction(claimDungeonWeb);
  pluginApi.onObjectInteraction(WEB, { Slash: slashWeb, Peek: peek });
  pluginApi.onObjectInteraction(THICK_WEB, {
    "Enter-crypt": enterCrypt,
    "Quick-enter": quickEnter,
    "Fight-privately": fightPrivately,
    Exit: exit,
    "Quick-Exit": exit,
  });
}

module.exports = {
  attach,
  _test: { slashWeb, peek, peekText, quickEnter, enterCrypt, fightPrivately, exit, rentInstance, bankCoins, takeBankFee, instanceFee, passWeb, wadeDestination, claimDungeonWeb, isSarachnisWeb },
};
