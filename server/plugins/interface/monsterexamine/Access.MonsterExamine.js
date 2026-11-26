function canOpen(core, player, allowedGroups) {
  if (!allowedGroups.includes(player.getInterfaceId())
    && (player.busy() || player.getPacketSender().hasInterruptibleInterface())) return false;
  return !player.getDialogueManager().isActive() && !player.isLocked() && player.getHitpoints() > 0
    && !player.isNeedsPlacement() && !player.getCombat().isAnimationStalled() && !player.getPacketSender().hasInputPrompt()
    && !player.getForceMovement() && player.getStatus() === core.PlayerStatus.NONE;
}
module.exports = { canOpen };
