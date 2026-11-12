// Body0: Raw4014/4025/4028/4029/4031; body1: Raw2530 and Soul Wars Raw3277.
// Paired Duel Arena captures 1591/1592 show both participants hear a separate variant.
// The recordings do not establish native random weights.
const HURT_IDS = {
  body0: [518, 519, 520, 521],
  body1: [509, 510],
};
const HURT_DELAY = 20;
// Retain the existing range boundary for the attacking participant.
const HURT_LISTENER_RANGE = 15;
// All Settings > Audio > "Hit sounds" (varbit 10731 settings_hit_sounds): Type A is body0's
// voices, Type B body1's. Ours: until the player chooses, the voice follows the body type, as
// it did before the setting.
const HIT_SOUNDS_SETTING = 382;
const HIT_SOUNDS_VARBIT = 10731;
const HIT_SOUNDS_ATTRIBUTE = "hit-sounds:type";
const TYPE_A = 0;
const TYPE_B = 1;
let core;

/** The player's hit sounds type: their choice, else their body type's. */
function hitSoundsType(player) {
  const chosen = player.getAttribute(HIT_SOUNDS_ATTRIBUTE);
  if (chosen === TYPE_A || chosen === TYPE_B) return chosen;
  return player.getAppearance().isMale() ? TYPE_A : TYPE_B;
}

function chooseHitSounds(request) {
  if (request.handled || request.settingId !== HIT_SOUNDS_SETTING) return;
  if (request.option !== TYPE_A && request.option !== TYPE_B) return;
  request.handled = true;
  request.player.setAttribute(HIT_SOUNDS_ATTRIBUTE, request.option);
  request.player.getPacketSender().sendVarbit(HIT_SOUNDS_VARBIT, request.option);
}

/** Login: the client starts at Type A, so send Type B when that is the player's. */
function sendHitSounds({ player }) {
  const type = hitSoundsType(player);
  if (type !== TYPE_A) player.getPacketSender().sendVarbit(HIT_SOUNDS_VARBIT, type);
}

function playHurtSound(listener, hurtIds) {
  // Uniform selection is an inference; the captures do not establish native weights.
  const id = hurtIds[core.Misc.getRandom(hurtIds.length - 1)];
  core.Sounds.sendSound(listener, new core.Sound(id, 1, HURT_DELAY, 1));
}

function playHurtSoundForListeners(attacker, target, hurtIds) {
  if (attacker.isNpc()) {
    // Pest Control4014/4025/4028/4029/4031: NPC-inflicted voices accompany
    // local HP loss, not the many nearby players' fights. This is a private synth.
    if (target.isRegistered()) playHurtSound(target, hurtIds);
    return;
  }
  const location = target.getLocation();
  const privateArea = target.getPrivateArea();
  const listeners = [target];
  if (attacker !== target) listeners.push(attacker.getAsPlayer());
  for (const listener of listeners) {
    if (!listener.isRegistered() || listener.isPlayerBot() || listener.getPrivateArea() !== privateArea
      || !listener.getLocation().isWithinDistance(location, HURT_LISTENER_RANGE)) continue;
    // Paired Duel Arena1591/1592 confirms independent private participant variants.
    // Limit ordinary hit voices to that demonstrated audience: unpositioned
    // synths cannot fade with distance and drowned out nearby fights when broadcast.
    playHurtSound(listener, hurtIds);
  }
}

/** Damage the player takes on itself (a divine potion's shock): only they hear it, in their own voice. */
function playOwnHurtSound(player) {
  if (!core || !player?.isRegistered?.() || player.isPlayerBot?.() || player.getNpcTransformationId() >= 0) return;
  playHurtSound(player, hitSoundsType(player) === TYPE_A ? HURT_IDS.body0 : HURT_IDS.body1);
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
      const hurtIds = hitSoundsType(player) === TYPE_A ? HURT_IDS.body0 : HURT_IDS.body1;
      playHurtSoundForListeners(attacker, player, hurtIds);
    });
  }
}

module.exports = {
  name: "PlayerHitSounds",
  description: "Plays the hurt sound to players struck in combat, in the voice their Hit sounds setting chooses.",
  hitSoundsType,
  playOwnHurtSound,
  register(api) {
    api.persistAttribute(HIT_SOUNDS_ATTRIBUTE, null);
    api.onCustomEvent("settings:option-chosen", chooseHitSounds);
    api.onPlayerLogin(sendHitSounds);
    api.onServerStartup(initialize.bind(null, api.core));
    api.onCombatHitResolved(playResolvedHitSound);
  },
};
