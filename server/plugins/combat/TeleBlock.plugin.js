/**
 * What a running Tele Block does to its target over time (docs/tele-block.md):
 *
 * - Wiki (Teleport Block, Elder Chaos druid): the block is removed when the player leaves the
 *   Wilderness. The Ferox Enclave and its buffer are PvP-tagged safe ground, so they still count
 *   as the Wilderness here: a blocked player stays blocked at the barrier.
 * - rsprox captures (recordings 435, 437): "Your Tele Block will expire in 30 seconds." once, 30
 *   seconds before the block ends.
 */
let core;

function tickTeleBlock({ player }) {
  const { TeleBlock, Wilderness } = core;
  const timer = player.getCombat().getTeleblockTimer();
  if (!timer.isRunning()) return;
  if (!Wilderness.isPvpArea(player.getLocation())) {
    TeleBlock.remove(player);
    return;
  }
  const remaining = timer.secondsRemaining();
  if (remaining === 0) {
    TeleBlock.remove(player);
  } else if (remaining <= TeleBlock.WARNING_SECONDS && player.getAttribute(TeleBlock.WARNED_ATTRIBUTE) !== true) {
    TeleBlock.warn(player);
  }
}

module.exports = {
  name: "TeleBlock",
  _test: { tickTeleBlock },
  register(api) {
    core = api.core;
    api.onPlayerProcess(tickTeleBlock);
  },
};
