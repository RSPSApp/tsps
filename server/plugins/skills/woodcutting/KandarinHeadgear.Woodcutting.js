/**
 * Kandarin headgear (https://oldschool.runescape.wiki/w/Kandarin_headgear_1,
 * https://oldschool.runescape.wiki/w/Kandarin_Diary): worn, any of the four tiers doubles the
 * regular logs a normal tree gives, with no additional experience. No capture of it exists.
 * Docs: docs/diary-rewards.md.
 */
let core = null;
let headgearIds = [];

function attach(api) {
  core = api.core;
  const I = core.ItemIdentifiers;
  headgearIds = [I.KANDARIN_HEADGEAR_1, I.KANDARIN_HEADGEAR_2, I.KANDARIN_HEADGEAR_3, I.KANDARIN_HEADGEAR_4];
}

/**
 * How many logs one successful chop gives: two for regular logs while the headgear is worn, else
 * one. It is a members' benefit: a headgear saved as worn stays on a free world, where
 * FreeToPlay only blocks equipping it.
 */
function logsPerChop(player, logId) {
  if (logId !== core.ItemIdentifiers.LOGS || !core.WorldDefinition.isMembersWorld()) return 1;
  const worn = player.getEquipment().get(core.Equipment.HEAD_SLOT);
  return headgearIds.includes(Number(worn?.getId?.())) ? 2 : 1;
}

module.exports = { attach, logsPerChop };
