// Raw4014/4025/4028/4029/4031: body0 ordinary PvM damage has private518–521,
// one loop, delay20 client cycles. The recordings do not establish random weights.
const HURT_IDS = [518, 519, 520, 521];
const HURT_DELAY = 20;
let core;

function initialize(coreApi) {
  core = coreApi;
}

function playResolvedHitSound({ attacker, target, hit }) {
  if (!target.isPlayer()) return;
  const player = target.getAsPlayer();
  const capturedBody = attacker.isNpc() && player.getAppearance().isMale()
    && player.getNpcTransformationId() < 0;
  if (!capturedBody) {
    // Preserve unsupported body/PvP/morph behavior, including one sound per resolved hit.
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
      if (!(taken > 0) || !player.getAppearance().isMale() || player.getNpcTransformationId() >= 0) return;
      // Uniform selection is an inference; only this four-sound group is recorded.
      const id = HURT_IDS[core.Misc.getRandom(HURT_IDS.length - 1)];
      core.Sounds.sendSound(player, new core.Sound(id, 1, HURT_DELAY, 1));
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
