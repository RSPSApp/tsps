// Body0: Raw4014/4025/4028/4029/4031; body1: Raw2530 and Soul Wars Raw3277.
// Paired Duel Arena captures 1591/1592 show both participants hear a separate variant.
// The recordings do not establish native random weights.
const HURT_IDS = {
  body0: [518, 519, 520, 521],
  body1: [509, 510],
};
const HURT_DELAY = 20;
// Keep private SynthSound delivery within the existing sound listener sweep.
const HURT_LISTENER_RANGE = 15;
let core;

function playHurtSound(listener, hurtIds) {
  // Uniform selection is an inference; the captures do not establish native weights.
  const id = hurtIds[core.Misc.getRandom(hurtIds.length - 1)];
  core.Sounds.sendSound(listener, new core.Sound(id, 1, HURT_DELAY, 1));
}

function playHurtSoundForListeners(target, hurtIds) {
  const location = target.getLocation();
  const privateArea = target.getPrivateArea();
  for (const listener of core.World.getPlayers()) {
    if (listener.isPlayerBot() || listener.getPrivateArea() !== privateArea
      || !listener.getLocation().isWithinDistance(location, HURT_LISTENER_RANGE)) continue;
    // Each client gets its own SynthSound packet and variant, as in paired Duel Arena captures.
    playHurtSound(listener, hurtIds);
  }
}

function initialize(coreApi) {
  core = coreApi;
}

function playResolvedHitSound({ attacker, target, hit }) {
  if (!target.isPlayer()) return;
  const player = target.getAsPlayer();
  const capturedBody = (attacker.isNpc() || attacker.isPlayer())
    && player.getNpcTransformationId() < 0;
  if (!capturedBody) {
    // Preserve the fallback for unsupported attacker sources and NPC-morphed players.
    core.Sounds.sendSound(player, hit.isAccurate() && hit.getTotalDamage() > 0
      ? core.Sound.PLAYER_GETTING_HIT : core.Sound.DEFENCE_BLOCK);
    return;
  }
  if (hit.getTotalDamage() <= 0) {
    core.Sounds.sendSound(player, core.Sound.DEFENCE_BLOCK);
    return;
  }
  for (const part of hit.getHits()) {
    const mask = part.getHitmask();
    if (part.isReflected() || (mask !== core.HitMask.RED && mask !== core.HitMask.BLUE)) continue;
    part.onApplied(taken => {
      if (!(taken > 0) || player.getNpcTransformationId() >= 0) return;
      const hurtIds = player.getAppearance().isMale() ? HURT_IDS.body0 : HURT_IDS.body1;
      playHurtSoundForListeners(player, hurtIds);
    });
  }
}

module.exports = {
  name: "PlayerHitSounds",
  register(api) {
    api.onServerStartup(initialize.bind(null, api.core));
    api.onCombatHitResolved(playResolvedHitSound);
  },
};
