"use strict";

/**
 * Devil's element (https://oldschool.runescape.wiki/w/Devil%27s_element), a shield-slot magic
 * offhand from the Echo Thermonuclear smoke devil. Its stats are the cache's.
 *
 * Demonic Pacts (Wiki: Demonic Pacts League/Echo bosses and echo equipment), for a Demonic Pacts
 * character only (EchoItems.js):
 * - It adds a 30% elemental weakness to every element on top of any existing weakness, against
 *   every target, one with no weakness of its own too: `added` on `elemental-spells:weakness`, which
 *   the elemental spells' damage and accuracy and the Demonic Pacts that check a weakness read. With
 *   the Shadowflame quadrant the spell counts as the target's own weakness, plus the 30%.
 * - An infinite source of air, water, earth and fire runes (ElementalStaves.plugin.js).
 * Not modelled: the Raging Echoes and Grid Master version, which doubled existing weaknesses.
 */

const { inDemonicPacts } = require("./EchoItems");

const ADDED_WEAKNESS = 30;

let api = null;
let core = null;

function wearsElement(entity) {
  if (!entity?.isPlayer?.()) return false;
  const id = entity.getAsPlayer().getEquipment().get(core.Equipment.SHIELD_SLOT)?.getId?.() ?? -1;
  return id === core.ItemIdentifiers.DEVILS_ELEMENT && inDemonicPacts(api, entity.getAsPlayer());
}

/** `elemental-spells:weakness`: +30% to every element. */
function addWeakness(request) {
  if (!wearsElement(request?.attacker)) return;
  request.added = (Number(request.added) || 0) + ADDED_WEAKNESS;
}

module.exports = {
  name: "DevilsElement",
  description: "The Devil's element's Demonic Pacts effect: a 30% weakness to every element on every target.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.onCustomEvent("elemental-spells:weakness", addWeakness);
  },
  _test: { addWeakness, ADDED_WEAKNESS },
};
