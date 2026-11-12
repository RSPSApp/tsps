const { DialogueChainBuilder } = require("../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { NpcDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/NpcDialogue");
const { EndDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/EndDialogue");

const MAKEOVER_INTERFACE_ID = 679;
// The designer's arrows, A/B and Confirm: cache components with an op ("*") whose script the
// interface's onload attaches. The official client only runs an op the server has enabled.
const MAKEOVER_BUTTONS = [15, 16, 19, 20, 23, 24, 27, 28, 31, 32, 35, 36, 39, 40, 46, 47, 50, 51, 54, 55, 58, 59, 62, 63, 68, 69, 74];
const MAKEOVER_BUTTON_UIDS = MAKEOVER_BUTTONS.map((component) => (MAKEOVER_INTERFACE_ID << 16) | component);
const OP1 = 1 << 1;
const NO_SLOT = -1;

// The designer works on the server in OSRS: the official client sends each click and draws the
// player as the server's appearance updates show them. (The browser client designs locally and
// sends the result as APPEARANCE_SET.) Its rules, as the browser's PlayerDesignController has them:
// a kit row cycles the selectable identity kits of its body part (0-6, female + 7), a colour row
// its palette, and A/B switch body type to the first selectable kit of each part.
const DESIGN_KIT_SLOTS = [1, 7, 2, 3, 4, 5, 6]; // Appearance HEAD, BEARD, CHEST, ARMS, HANDS, LEGS, FEET
const DESIGN_COLOUR_SLOTS = [8, 9, 10, 11, 12]; // Appearance HAIR, TORSO, LEG, FEET, SKIN colours
// The palettes (client PLAYER_BODY_RECOLOR_TO_1). Skin has 13, but its Halloween colours (8-11)
// are offered only once unlocked (core Appearance.SKIN_UNLOCKS, the cache's makeover_unlockedcolour).
const DESIGN_COLOUR_COUNTS = [30, 29, 29, 6, 13];
const DESIGN_SKIN_ROW = 4;
const DESIGN_GENDER_SLOT = 0;
const FEMALE_BODY_PARTS = 7;
const DESIGN_BODY_TYPE_VARBIT = 14021; // player_design_bodytype, which the A/B buttons show
const DESIGN_KIT_ARROWS = [[15, 16], [19, 20], [23, 24], [27, 28], [31, 32], [35, 36], [39, 40]];
const DESIGN_COLOUR_ARROWS = [[46, 47], [50, 51], [54, 55], [58, 59], [62, 63]];
const DESIGN_BODY_TYPE_A = 68;
const DESIGN_BODY_TYPE_B = 69;
const DESIGN_CONFIRM = 74;
const PRONOUN_DROPDOWN_UID = (MAKEOVER_INTERFACE_ID << 16) | 78;
const PRONOUN_SETTING_ID = 387;
const PRONOUN_VARBIT = 10988; // settings_transmit_pronouns, varp 2855 bits 24..25
const PRONOUN_TRANSMIT_VARP = 2855;

let core;
const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const MAKEOVER_COMMANDS = ["mm", "makeover", "makeovermage"];


function startMakeoverDialogue(player, npcId) {
  const dialogue = new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, "Hello! I can change your appearance. Choose Makeover when you're ready."),
    new EndDialogue(1),
  );
  player.getDialogueManager().startDialogues(dialogue);
}

/**
 * "account:skip-onboarding": a test account (the agent MCP's login) keeps its default look instead of
 * designing one, so the first-login designer doesn't hold its world clicks.
 */
function skipInitialDesign({ player }) {
  if (player?.getInterfaceId?.() !== MAKEOVER_INTERFACE_ID) return;
  player.getPacketSender().sendInterfaceRemoval();
  player.getAppearance?.().setCanChangeAppearance?.(false);
}

function openMakeoverInterface(player) {
  if (!player || typeof player.getPacketSender !== "function") {
    return false;
  }
  player.getPacketSender().sendInterfaceRemoval();
  player.setInterfaceId?.(MAKEOVER_INTERFACE_ID);
  player.getAppearance?.().setCanChangeAppearance?.(true);
  // Freeze a legacy body-derived default before either client starts editing the body.
  const appearance = player.getAppearance();
  appearance.setPronouns(appearance.getPronouns());
  syncPronouns({ player });
  player.getPacketSender().sendSubInterface(MAIN_MODAL_TARGET_UID, MAKEOVER_INTERFACE_ID, 0);
  player.getPacketSender().sendInterfaceFlagsRange(PRONOUN_DROPDOWN_UID, 1, 3, OP1);
  for (const component of MAKEOVER_BUTTONS) {
    player.getPacketSender().sendInterfaceFlagsRange((MAKEOVER_INTERFACE_ID << 16) | component, NO_SLOT, NO_SLOT, OP1);
  }
  return true;
}

/** Selectable identity kit ids by body part (0-13), in id order; the cache's kits don't change. */
let selectableKitsByPart = null;

/** Selectable identity kits for a body part (0-13), in id order. */
function selectableKits(bodyPart) {
  if (!selectableKitsByPart) {
    selectableKitsByPart = new Map();
    for (const kit of core.CacheDefinitions.getIdentKits()) {
      if (kit.nonSelectable) continue;
      if (!selectableKitsByPart.has(kit.bodyPartId)) selectableKitsByPart.set(kit.bodyPartId, []);
      selectableKitsByPart.get(kit.bodyPartId).push(kit.id);
    }
  }
  return selectableKitsByPart.get(bodyPart) ?? [];
}

function step(values, current, direction) {
  const at = values.indexOf(current);
  if (at < 0) return values[direction > 0 ? 0 : values.length - 1];
  return values[(at + direction + values.length) % values.length];
}

function designLook(player, change) {
  const look = [...player.getAppearance().getLook()];
  change(look);
  player.getAppearance().setLookArray(look);
}

function cycleKit(player, part, direction) {
  designLook(player, (look) => {
    const kits = selectableKits(part + (look[DESIGN_GENDER_SLOT] === 1 ? FEMALE_BODY_PARTS : 0));
    if (kits.length > 0) look[DESIGN_KIT_SLOTS[part]] = step(kits, look[DESIGN_KIT_SLOTS[part]], direction);
  });
}

function cycleColour(player, slot, direction) {
  designLook(player, (look) => {
    const current = look[DESIGN_COLOUR_SLOTS[slot]];
    look[DESIGN_COLOUR_SLOTS[slot]] = slot === DESIGN_SKIN_ROW
      ? core.Appearance.stepSkinColour(current, direction, player.getAppearance().unlockedSkinColours())
      : step(Array.from({ length: DESIGN_COLOUR_COUNTS[slot] }, (_, colour) => colour), current, direction);
  });
}

function setBodyType(player, gender) {
  player.getPacketSender().sendVarbit(DESIGN_BODY_TYPE_VARBIT, gender);
  if (player.getAppearance().getLook()[DESIGN_GENDER_SLOT] === gender) return;
  designLook(player, (look) => {
    look[DESIGN_GENDER_SLOT] = gender;
    DESIGN_KIT_SLOTS.forEach((slot, part) => {
      look[slot] = selectableKits(part + (gender === 1 ? FEMALE_BODY_PARTS : 0))[0] ?? -1;
    });
  });
}

function confirmDesign(player) {
  player.getPacketSender().sendInterfaceRemoval();
  player.getAppearance().setCanChangeAppearance(false);
}

/** A click in the designer; the official client sends them, the browser designs locally. */
function clickDesign({ player, buttonId }) {
  if (player.getInterfaceId?.() !== MAKEOVER_INTERFACE_ID || !player.getAppearance().getCanChangeAppearance()) return false;
  const component = buttonId & 0xffff;
  const kit = DESIGN_KIT_ARROWS.findIndex((arrows) => arrows.includes(component));
  const colour = DESIGN_COLOUR_ARROWS.findIndex((arrows) => arrows.includes(component));
  if (kit >= 0) cycleKit(player, kit, component === DESIGN_KIT_ARROWS[kit][0] ? -1 : 1);
  else if (colour >= 0) cycleColour(player, colour, component === DESIGN_COLOUR_ARROWS[colour][0] ? -1 : 1);
  else if (component === DESIGN_BODY_TYPE_A || component === DESIGN_BODY_TYPE_B) setBodyType(player, component === DESIGN_BODY_TYPE_B ? 1 : 0);
  else if (component === DESIGN_CONFIRM) confirmDesign(player);
  else return false;
  return true;
}

/** Shows the client which skin colours are unlocked (the browser designer reads the varbits). */
function syncSkinUnlocks({ player }) {
  for (const unlock of core.Appearance.SKIN_UNLOCKS) {
    const varbit = core.CacheDefinitions.getVarbitId(unlock.varbit);
    if (varbit !== null) player.getPacketSender().sendVarbit(varbit, player.getAttribute(unlock.attribute) === true ? 1 : 0);
  }
}

/** A completed Halloween event unlocks every Halloween skin colour released before it (Wiki, Makeover). */
function unlockHalloweenSkins({ player }) {
  for (const unlock of core.Appearance.SKIN_UNLOCKS) player.setAttribute(unlock.attribute, true);
  syncSkinUnlocks({ player });
}

function persistSkinUnlocks(api) {
  for (const unlock of core.Appearance.SKIN_UNLOCKS) api.persistAttribute(unlock.attribute, false);
}

function syncPronouns({ player }) {
  player.getPacketSender().sendVarbit(PRONOUN_VARBIT, player.getAppearance().getPronouns());
}

function choosePronouns(player, value) {
  if (!Number.isInteger(value) || value < 0 || value > 2) return false;
  player.getAppearance().setPronouns(value);
  syncPronouns({ player });
  return true;
}

function chooseDesignerPronouns({ player, slot }) {
  if (player.getInterfaceId() !== MAKEOVER_INTERFACE_ID || !player.getAppearance().getCanChangeAppearance()) return false;
  return choosePronouns(player, slot - 1);
}

function chooseSettingPronouns(request) {
  if (request.settingId === PRONOUN_SETTING_ID) request.handled = choosePronouns(request.player, request.option);
}

/** The browser runs settings_pronouns locally and transmits this varp. */
function transmitPronouns(request) {
  if (request.varpId !== PRONOUN_TRANSMIT_VARP) return;
  request.handled = choosePronouns(request.player, (request.value >>> 24) & 3);
}

function canOpenMakeover(player, combatFactory) {
  return !player.busy?.() &&
    !combatFactory.inCombat(player) &&
    !player.getDialogueManager?.()?.isActive?.() &&
    !player.getPacketSender?.().hasInterruptibleInterface?.();
}

function talkToMakeoverMage({ player, npcId }) {
  startMakeoverDialogue(player, npcId);
}

function openMakeover({ player }) {
  return openMakeoverInterface(player);
}

/** The makeover interface's "Body types" category (plugins/npcs/Makeover.plugin.js). */
function openFromMakeover({ player }) {
  openMakeoverInterface(player);
}

module.exports = {
  name: "MakeOverMage",
  description: "Makeover Mage and the ::makeover command: change body kits and colours, pick pronouns, and unlock Halloween skins; new accounts see it at creation.",
  _test: { canOpenMakeover, clickDesign, unlockHalloweenSkins },
  register(api) {
    core = api.core;
    api.onInterfaceActionButton(MAKEOVER_BUTTON_UIDS, clickDesign);
    api.persistAttribute(core.Appearance.PRONOUNS_ATTRIBUTE, -1);
    api.onPlayerLogin(syncPronouns);
    persistSkinUnlocks(api);
    api.onPlayerLogin(syncSkinUnlocks);
    api.onCustomEvent("makeover-mage:unlock-halloween-skins", unlockHalloweenSkins);
    api.onInterfaceActionButton(PRONOUN_DROPDOWN_UID, chooseDesignerPronouns);
    api.onCustomEvent("settings:option-chosen", chooseSettingPronouns);
    api.onCustomEvent("player:varp-transmit", transmitPronouns);
    const CombatFactory = api.getCombatFactory();
    // A new account designs its character first, as in OSRS (there is no welcome screen for it).
    // The login hook runs just before the gameframe is sent: mount the modal after it.
    api.onPlayerLogin(({ player, isNewAccount }) => {
      if (!isNewAccount || player.isPlayerBot?.() === true) {
        return;
      }
      queueMicrotask(() => openMakeoverInterface(player));
    });

    api.onCustomEvent("account:skip-onboarding", skipInitialDesign);

    for (const command of MAKEOVER_COMMANDS) {
      api.registerCommand(command, ({ player }) => {
        if (!canOpenMakeover(player, CombatFactory)) {
          player.sendMessage("You cannot change your appearance right now.");
          return true;
        }
        return openMakeoverInterface(player);
      }, undefined, "Change your appearance");
    }

    api.onNpcInteraction("Makeover Mage", {
      "Talk-to": talkToMakeoverMage,
      Makeover: openMakeover,
    });

    api.onCustomEvent("makeover-mage:open", openFromMakeover);

    api.log("registered", {
      interfaceId: MAKEOVER_INTERFACE_ID,
    });
  },
};
