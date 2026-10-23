/**
 * What the player sees for each step, as captured: the progress varps, the step text in the
 * chatbox (mesoverlay), the hint picture (tutorial_overlay), the hint arrow, the flashing side tab
 * and the tabs unlocked so far, and inventory/interface highlights. Clicking the flashing tab
 * completes the steps that ask for it.
 */
const T = require("./Common.TutorialIsland");
const { resolveGameframeRoot } = require("../../../src/main/typescript/elvarg/net/protocol/ClientProtocol");

const { varps, varbits, scripts, interfaces } = T.data;

/** Gameframe root 161 slots: overlay_atmosphere hosts tutorial_overlay, as captured. */
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const OVERLAY_TYPE = 1;
/** Side tab contents (161:76 + tab), in tab order (stone0..13). */
const TAB_CONTENT_CHILD = (tab) => (161 << 16) | (76 + tab);
const TAB_GROUP = [593, 320, 629, 149, 387, 541, 218, 7, 109, 429, 182, 116, 216, 239];
const COMBAT_TAB = 0;
const LOGOUT_TAB = 10;
const INVENTORY_TAB = 3;
/** varp 4922 gates the gameframe's onVarTransmit flash setup (script 902 -> 907). */
const FLASH_SETUP_VARP = 4922;
/** Tab buttons (stone0..13) per gameframe root, from rsprox captures of each layout. */
const STONES = Object.freeze({
  161: [59, 60, 61, 62, 63, 64, 65, 43, 44, 45, 46, 47, 48, 49],
  548: [64, 65, 66, 67, 68, 69, 70, 48, 49, 50, 51, 52, 53, 54],
  164: [52, 53, 54, 55, 56, 57, 58, 38, 39, 40, 34, 41, 42, 43],
});
/** A hint target farther than this isn't in the client's NPC list yet: point at its tile instead. */
const HINT_FOLLOW_TILES = 14;
/** OSRS's tile hint position types (sendPositionalHint). */
const ARROW_POSITIONS = Object.freeze({ Center: 2, West: 3, East: 4, South: 5, North: 6 });
/** The out-of-view tile arrow for an NPC: about 0.7 of a tile up (OSRS height byte, x2 world units). */
const FAR_NPC_ARROW_HEIGHT = 45;

/** Tutorial mine rocks (cache loc placements) for the mining arrows. */
const ROCK_TILES = {
  tin: [[3073, 9504], [3073, 9505], [3073, 9506], [3073, 9507], [3074, 9502], [3074, 9503], [3075, 9501], [3075, 9502], [3075, 9504], [3075, 9505], [3075, 9506], [3075, 9508], [3076, 9504], [3076, 9506], [3076, 9509], [3077, 9503], [3077, 9504], [3077, 9509]],
  copper: [[3083, 9501], [3084, 9500], [3085, 9498], [3085, 9499], [3085, 9500], [3085, 9501], [3085, 9503], [3086, 9498], [3086, 9499], [3086, 9501], [3087, 9502], [3087, 9503], [3088, 9498], [3088, 9499], [3088, 9501], [3088, 9502], [3089, 9499], [3090, 9501], [3091, 9500], [3091, 9501]],
};

const shown = new WeakSet();
const openTabs = new WeakMap();
/** Player -> the NPC arrow being followed, for the per-tick near/far switch. */
const arrowFollow = new WeakMap();
/** Player -> the rat they attacked: the arrow stays on it, as captured. */
const attackedRat = new WeakMap();

function pointAtRat(player, rat) {
  attackedRat.set(player, rat);
}

function sender(player) {
  return player.getPacketSender();
}

/** Tabs unlocked once the player has reached `value` (logout always). */
function unlockedTabs(value) {
  if (value >= T.STEP.COMPLETED) return new Set(TAB_GROUP.keys());
  const set = new Set([LOGOUT_TAB]);
  for (const [from, tab] of Object.entries(T.data.unlockTabs)) if (value >= Number(from)) set.add(tab);
  return set;
}

/** Player -> the weapon last seen, to notice a wield. */
const lastWeapon = new WeakMap();

/**
 * Wielding a weapon re-opens the combat tab (WeaponInterfaceManager). OSRS keeps it locked until
 * its step, so close it again; it opens, and flashes, at "Click on the flashing crossed swords".
 */
function keepCombatTabLocked(player) {
  const weapon = player.getEquipment().getItems()[T.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  if (lastWeapon.get(player) === weapon) return;
  lastWeapon.set(player, weapon);
  if (unlockedTabs(T.progress(player)).has(COMBAT_TAB)) return;
  sender(player).closeSubInterface(TAB_CONTENT_CHILD(COMBAT_TAB));
  openTabs.get(player)?.delete(COMBAT_TAB);
}

/** Hides locked tabs by unmounting their content; the gameframe then hides their icons. */
function syncTabs(player, value) {
  const tracked = openTabs.get(player);
  if (!tracked) return;
  const unlocked = unlockedTabs(value);
  for (let tab = 0; tab < TAB_GROUP.length; tab++) {
    if (unlocked.has(tab) && !tracked.has(tab)) {
      // The combat tab opens with the wielded weapon's interface (title, category), as captured.
      if (tab === COMBAT_TAB) T.core.WeaponInterfaceManager.assign(player);
      else sender(player).sendSubInterface(TAB_CONTENT_CHILD(tab), TAB_GROUP[tab], 1);
      // Closing the tab dropped the flags the login gave it (the client clears a closed
      // interface's flags): send them again, and let the plugins that add their own do so.
      sender(player).sendGameframeTabSetup(TAB_GROUP[tab]);
      T.api.emitCustomEvent("gameframe:tab-mounted", { player, group: TAB_GROUP[tab] });
      tracked.add(tab);
    } else if (!unlocked.has(tab) && tracked.has(tab)) {
      sender(player).closeSubInterface(TAB_CONTENT_CHILD(tab));
      tracked.delete(tab);
    }
  }
}

/** Players with step text up: game messages may show over it (chatbox script 663). */
const textUp = new WeakSet();

/** The step text in the chatbox, or a plain action text ("Your character is now attempting ..."). */
function showText(player, title, body) {
  const text = title ? `<col=0000ff>${title}</col><br>${T.pronoun(player, body)}` : T.pronoun(player, body);
  const out = sender(player);
  out.sendSubInterface(interfaces.chatboxText, interfaces.text, OVERLAY_TYPE);
  out.sendVarbit(varbits.allowTextOverlap, 1);
  out.sendClientScript(scripts.text, text);
  textUp.add(player);
}

function hideText(player) {
  sender(player).sendVarbit(varbits.allowTextOverlap, 0);
  sender(player).closeSubInterface(interfaces.chatboxText);
  textUp.delete(player);
}

function showActionText(player, key) {
  const text = T.data.actionTexts[key];
  if (!text) return;
  const [title, body] = text.includes("<br>") && !text.startsWith("Your character") ? text.split("<br>") : [null, text];
  showText(player, title, body);
}

function showOverlay(player, step) {
  const out = sender(player);
  out.sendSubInterface(OVERLAY_ATMOSPHERE_UID, interfaces.overlay, OVERLAY_TYPE);
  for (const child of interfaces.overlayHiddenComponents) out.sendInterfaceDisplayState((interfaces.overlay << 16) | child, true);
  if (step?.hint !== undefined) out.sendClientScript(scripts.hint, step.hint);
}

function nearestTile(player, tiles) {
  const at = player.getLocation();
  return tiles.reduce((best, tile) =>
    Math.hypot(tile[0] - at.getX(), tile[1] - at.getY()) < Math.hypot(best[0] - at.getX(), best[1] - at.getY()) ? tile : best);
}

function findNpc(npcId, player) {
  const from = player.getLocation();
  let found = null;
  let best = Infinity;
  T.core.World.getNpcs().forEach((npc) => {
    if (!npc || npc.getId?.() !== npcId || npc.getHitpoints?.() <= 0) return;
    const at = npc.getLocation?.();
    const dist = at && at.getZ() === from.getZ()
      ? Math.max(Math.abs(at.getX() - from.getX()), Math.abs(at.getY() - from.getY()))
      : Infinity;
    if (!found || dist < best) {
      found = npc;
      best = dist;
    }
  });
  return found;
}

function isFar(player, npc) {
  const from = player.getLocation();
  const at = npc.getLocation();
  return from.getZ() !== at.getZ() ||
    Math.max(Math.abs(at.getX() - from.getX()), Math.abs(at.getY() - from.getY())) > HINT_FOLLOW_TILES;
}

function pointAtNpc(player, value, npc) {
  const far = isFar(player, npc);
  if (far) sender(player).sendPositionalHint(npc.getLocation(), ARROW_POSITIONS.Center, FAR_NPC_ARROW_HEIGHT);
  else sender(player).sendEntityHint(npc);
  const at = npc.getLocation();
  arrowFollow.set(player, { value, far, x: at.getX(), y: at.getY(), index: npc.getIndex() });
}

/** The ranging step points at the Combat Instructor until the bow is handed over. */
function arrowFor(player, step) {
  if (step.value === T.STEP.RAT_KILLED || (step.value === T.STEP.RANGE_RAT && !T.hasItem(player, T.core.ItemIdentifiers.SHORTBOW))) {
    return { npc: T.IDS.COMBAT_INSTRUCTOR[0] };
  }
  return step.arrow;
}

function showArrow(player, step) {
  const out = sender(player);
  out.sendEntityHintRemoval(false);
  arrowFollow.delete(player);
  const arrow = step && arrowFor(player, step);
  out.sendVarbit(varbits.hintArrow, arrow ? 1 : 0);
  if (!arrow) return;
  const { Location } = T.core;
  if (arrow.rocks) {
    const ore = arrow.rocks === "tin" ? T.core.ItemIdentifiers.TIN_ORE : T.core.ItemIdentifiers.COPPER_ORE;
    const tiles = T.hasItem(player, ore) ? ROCK_TILES[arrow.rocks === "tin" ? "copper" : "tin"] : ROCK_TILES[arrow.rocks];
    const [x, y] = nearestTile(player, tiles);
    out.sendPositionalHint(new Location(x, y, 0), ARROW_POSITIONS.Center, arrow.height ?? 0);
  } else if (arrow.npc !== undefined) {
    const rat = attackedRat.get(player);
    const npc = arrow.npc === T.IDS.RAT && rat && rat.getHitpoints?.() > 0 ? rat : findNpc(arrow.npc, player);
    if (npc) pointAtNpc(player, step.value, npc);
  } else if (arrow.tile) {
    out.sendPositionalHint(new Location(arrow.tile[0], arrow.tile[1], 0), ARROW_POSITIONS[arrow.position] ?? ARROW_POSITIONS.Center, arrow.height ?? 0);
  }
}

/** Keeps an NPC arrow on its (moving) NPC, switching to its tile while it is out of view. */
function followArrow(player) {
  const value = T.progress(player);
  const step = T.step(value);
  const arrow = step && arrowFor(player, step);
  if (!arrow || arrow.npc === undefined) return;
  const state = arrowFollow.get(player);
  const npc = state ? T.core.World.getNpcs().get(state.index) : null;
  const rat = attackedRat.get(player);
  const switchedRat = arrow.npc === T.IDS.RAT && rat && rat.getHitpoints?.() > 0 && rat !== npc;
  if (!state || state.value !== value || !npc || npc.getId?.() !== arrow.npc || switchedRat) {
    showArrow(player, step);
    return;
  }
  // A dying target keeps the arrow until the death moves the step on.
  if (npc.getHitpoints?.() <= 0) return;
  const far = isFar(player, npc);
  const at = npc.getLocation();
  if (state.far !== far || (far && (state.x !== at.getX() || state.y !== at.getY()))) {
    sender(player).sendEntityHintRemoval(false);
    pointAtNpc(player, value, npc);
  }
}

/** The highlight style OSRS uses for "use this item now" (the dagger, the shrimp, the flour...). */
const CALL_TO_ACTION_STYLE = 7034;

function showHighlights(player, step) {
  const out = sender(player);
  out.sendClientScript(scripts.clearItemHighlights);
  // OSRS switches to the inventory for the items it asks you to use, as captured.
  if ((step?.highlight ?? []).some((highlight) => highlight.style === CALL_TO_ACTION_STYLE)) {
    out.sendClientScript(scripts.sideButtonSwitch, INVENTORY_TAB);
  }
  for (const highlight of step?.highlight ?? []) out.sendClientScript(scripts.highlightItem, highlight.item, highlight.style, highlight.arg);
}

/** Player -> the component highlight shown, cleared when its step is done (as captured). */
const componentHighlights = new WeakMap();

/** A component highlight (the smithing dagger, Wind Strike, Home Teleport) once its interface is up. */
function showComponentHighlight(player, step) {
  const shown = componentHighlights.get(player);
  if (step?.uiHighlight) {
    sender(player).sendClientScript(scripts.highlightComponent, ...step.uiHighlight);
    componentHighlights.set(player, step.uiHighlight);
  } else if (shown) {
    // ui_highlight_clear takes the highlight's first two arguments.
    sender(player).sendClientScript(scripts.clearComponentHighlight, shown[0], shown[1]);
    componentHighlights.delete(player);
  }
}

/** The past-experience screen, open (as captured) until the player answers it. */
function openExperience(player) {
  const out = sender(player);
  out.sendInterface(interfaces.experience);
  out.sendInterfaceFlagsRange((interfaces.experience << 16) | interfaces.experienceOptions, 0, 3, 1);
}

/** A step can change once the player holds its items (the chef's flour and water), as captured. */
function stepState(player, step) {
  const alt = step?.withItems;
  if (!alt || !alt.items.every((id) => player.getInventory().getAmount(id) > 0)) return step;
  return { ...step, text: alt.text, arrow: alt.arrow ?? undefined, highlight: alt.highlight };
}

/** Draws the whole step: varps, text, hint picture, arrow, tabs, flash and highlights. */
function render(player, value) {
  const step = stepState(player, T.step(value));
  const out = sender(player);
  out.sendConfig(varps.progress, value);
  if (step) out.sendConfig(varps.progressOverlay, step.progressOverlay);
  if (value >= T.STEP.COMPLETED || !step) {
    finish(player);
    return;
  }
  showOverlay(player, step);
  // A new account designs its character first (MakeOverMage): the experience screen waits for it.
  const designing = value === T.STEP.PAST_EXPERIENCE && player.getInterfaceId?.() === interfaces.appearance;
  if (designing) showText(player, T.data.appearanceText[0], T.data.appearanceText[1]);
  else if (step.text === null) hideText(player);
  else if (step.text) showText(player, step.text[0], step.text[1]);
  showArrow(player, step);
  // As captured: the flash first, then the newly unlocked tab, so it flashes as it appears.
  showFlash(player, step);
  syncTabs(player, value);
  // A flash sent while something covers the side tabs (a side panel, the equipment stats) is lost.
  if (step.flashTab !== undefined) T.later(1, () => reflash(player, value));
  showHighlights(player, step);
  showComponentHighlight(player, step);
  if (value === T.STEP.PAST_EXPERIENCE && !designing) openExperience(player);
}

/**
 * The flashing side tab. The client doesn't flash the tab that is open (script 913), and tsps
 * re-opens the combat tab when a weapon is wielded: show the inventory first, as OSRS switches
 * tabs during the tutorial.
 */
function showFlash(player, step) {
  const out = sender(player);
  if (step.flashTab !== undefined && step.flashTab !== INVENTORY_TAB) out.sendClientScript(scripts.sideButtonSwitch, INVENTORY_TAB);
  out.sendConfig(FLASH_SETUP_VARP, 1);
  out.sendVarbit(varbits.flashSide, 0);
  out.sendVarbit(varbits.flashSide, step.flashTab === undefined ? 0 : step.flashTab + 1);
}

/** Sends the flash again while the player is still on the step that asks for the tab. */
function reflash(player, value) {
  if (!T.isActive(player) || T.progress(player) !== value) return;
  const step = T.step(value);
  if (step?.flashTab !== undefined) showFlash(player, step);
}

/** Clears the tutorial UI once the island is done. */
function finish(player) {
  const out = sender(player);
  out.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
  hideText(player);
  out.sendEntityHintRemoval(false);
  out.sendVarbit(varbits.hintArrow, 0);
  out.sendVarbit(varbits.flashSide, 0);
  out.sendClientScript(scripts.clearItemHighlights);
  out.sendClientScript(scripts.clearAllComponentHighlights, 3);
  componentHighlights.delete(player);
  syncTabs(player, T.STEP.COMPLETED);
  arrowFollow.delete(player);
}

/** The gameframe was (re)built with every tab mounted: put the tutorial UI back on top. */
function applyUi(player) {
  openTabs.set(player, new Set(TAB_GROUP.keys()));
  render(player, T.progress(player));
  // A newly built chatbox shows the latest message over the step text as it loads (its first
  // chat transmit): a login message (a plugin's greeting) would cover the step. Messages may show
  // over it again from the next tick, once that has passed.
  sender(player).sendVarbit(varbits.allowTextOverlap, 0);
  T.later(1, () => {
    if (textUp.has(player)) sender(player).sendVarbit(varbits.allowTextOverlap, 1);
  });
}

/** Clicking the flashing tab completes the step that asks for it. */
function onTabClicked(player, tab) {
  if (!T.isActive(player)) return false;
  const step = T.step(T.progress(player));
  if (step?.flashTab === tab) T.setProgress(player, step.tabOpens);
  return false; // the client switches the tab itself
}

/** Without tab buttons we can hear (the mobile frame), talking to the instructor stands in for the click. */
function tabsClickable(player) {
  return STONES[resolveGameframeRoot(player)] !== undefined;
}

function onProcess({ player }) {
  if (!player || !T.isActive(player)) return;
  // The login event fires before the gameframe handshake, so the UI goes up on the first tick.
  if (!shown.has(player)) {
    shown.add(player);
    applyUi(player);
  }
  keepCombatTabLocked(player);
  followArrow(player);
}

// The welcome screen's Play button re-sends the gameframe bootstrap (every tab and the HUD).
const WELCOME_PLAY_BUTTON_UID = (378 << 16) | 72;

function onWelcomePlay({ player }) {
  queueMicrotask(() => {
    if (T.isActive(player) && shown.has(player)) applyUi(player);
  });
  return false;
}

module.exports = function attach(api) {
  T.onStep((player, value) => render(player, value));
  api.onCustomEvent("interface:closed", ({ player }) => {
    if (player && T.isActive(player)) reflash(player, T.progress(player));
  });
  api.onPlayerProcess(onProcess);
  api.onInterfaceActionButton(WELCOME_PLAY_BUTTON_UID, onWelcomePlay);
  for (const [root, stones] of Object.entries(STONES)) {
    stones.forEach((child, tab) => {
      api.onInterfaceActionButton((Number(root) << 16) | child, ({ player }) => onTabClicked(player, tab));
    });
  }
};

Object.assign(module.exports, { render, pointAtRat, openExperience, showActionText, showText, hideText, showComponentHighlight, tabsClickable, STONES, shown });
