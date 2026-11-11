"use strict";

/**
 * The grail riddle's box-selection interface (cache group 390, gameval kr_jewellery_boxes; Wiki "King's Ransom":
 * "search the table ... click on Show riddle and choose the correct container"). Everything it draws comes from the
 * cache: CS2 171 toggles "Show riddle" / "Hide riddle" (the riddle text sits in the script; varc 40 holds which side
 * is up), component 8 is that button, components 9-17 are the nine boxes (their x positions rise 23, 91, 144, 180,
 * 230, 279, 340, 390, 433, so component 8 + n is the nth box from the left) and component 18 closes it. Only the
 * eighth box (component 16) has a click script (CS2 67 swaps the backdrop model), the one the Wiki names: "the round
 * purple one on the right, second last box counting from left to right". The server sends the interface and runs
 * script 171 for the toggle, and hears a box as an ordinary component click.
 *
 * Not recorded: no rsprox capture of the interface was found, so that the server (not the client) runs script 171 on
 * the Show/Hide click and the interface staying open after a wrong click until the teleport are inference. The
 * client's varc 40 is not readable here, so the first run after opening assumes the boxes side comes up.
 */
const SHOW_RIDDLE_SCRIPT = 171;
/** Child of group 390: "Show riddle" / "Hide riddle". */
const TOGGLE_CHILD = 8;
/** Children 9..17: the nine boxes from the left. */
const FIRST_BOX_CHILD = 9;
const BOX_COUNT = 9;

module.exports = function createGrailBoxes(api, { onChoose, isActive }) {
  const { CacheDefinitions } = api.core;
  const GROUP = CacheDefinitions.getInterfaceId("kr_jewellery_boxes");
  if (GROUP == null) throw new Error("Missing the King's Ransom box interface in the cache");
  const uid = (child) => (GROUP << 16) | child;
  /** Who has the boxes open. */
  let open = new WeakSet();

  function show(player) {
    open.add(player);
    player.getPacketSender().sendInterface(GROUP);
    player.getPacketSender().sendClientScript(SHOW_RIDDLE_SCRIPT);
  }

  function click({ player, buttonId }) {
    if (!open.has(player)) return;
    if (!isActive(player)) { open.delete(player); return; }
    if (buttonId === uid(TOGGLE_CHILD)) {
      player.getPacketSender().sendClientScript(SHOW_RIDDLE_SCRIPT);
      return;
    }
    const box = buttonId - uid(FIRST_BOX_CHILD) + 1;
    if (box < 1 || box > BOX_COUNT) return;
    open.delete(player);
    player.getPacketSender().sendInterfaceRemoval();
    onChoose(player, box);
  }

  function leave({ player }) {
    open.delete(player);
  }

  api.onInterfaceActionButton(Array.from({ length: BOX_COUNT + 1 }, (_, i) => uid(TOGGLE_CHILD + i)), click);
  api.onPlayerLogout(leave);
  api.onPlayerDisconnect(leave);
  return { show };
};
