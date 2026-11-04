/**
 * Transformation rings: cache NPC forms, native Unmorph and choice menus.
 * Wiki pages for the seven rings document their forms and movement ending the effect;
 * Ring of stone also documents automatic unequipping on unmorph. These mixed F2P/members
 * items retain the shared item's normal membership checks. The no-slot rings use their
 * native Wear action while remaining in the inventory; no cache equipment slot is added.
 */
const REGION_SIZE_SHIFT = 6;
const CHOOSE_TITLE = "Choose a form";

const THIRD_AGE = {
  "Wand": "3rd_age_wand_transmog",
  "Bow": "3rd_age_bow_transmog",
  "Longsword": "3rd_age_sword_transmog",
  "Cloak": "3rd_age_cape_transmog",
  "Range top": "3rd_age_range_top_transmog",
  "Range legs": "3rd_age_range_legs_transmog",
  "Range coif": "3rd_age_coif_transmog",
  "Vambraces": "3rd_age_vambraces_transmog",
  "Robe top": "3rd_age_mage_top_transmog",
  "Robe": "3rd_age_mage_legs_transmog",
  "Mage hat": "3rd_age_mage_hat_transmog",
  "Amulet": "3rd_age_amulet_transmog",
  "Platebody": "3rd_age_melee_top_transmog",
  "Plateskirt": "3rd_age_melee_skirt_transmog",
  "Platelegs": "3rd_age_melee_legs_transmog",
  "Full helmet": "3rd_age_melee_helm_transmog",
  "Kiteshield": "3rd_age_kiteshield_transmog",
  "Druidic robe top": "3rd_age_druid_top_transmog",
  "Druidic robe bottoms": "3rd_age_druid_bottoms_transmog",
  "Druidic staff": "3rd_age_druid_staff_transmog",
  "Druidic cloak": "3rd_age_druid_cloak_transmog",
  "Axe": "3rd_age_axe_transmog",
  "Pickaxe": "3rd_age_pickaxe_transmog",
  "Ring": "3rd_age_ring_transmog",
};

/**
 * ring item name -> what it becomes: npcs (one, or several picked by location) or choices
 * (label -> npc); worn rings are equipped, the rest take Wear.
 */
const RINGS = {
  "Ring of coins": { worn: true, npcs: ["coins_transmog"] },
  "Ring of nature": { worn: true, npcs: ["bush_transmog"] },
  "Ring of stone": { worn: true, npcs: ["tzhaar_morph_rock"], unequipOnUnmorph: true },
  "Easter ring": {
    // shortcut: the 64-tile bands are documented; confirm their colour order with a capture.
    npcs: [
      "easter_egg_rolling_green",
      "easter_egg_rolling_blue",
      "easter_egg_rolling_orange",
      "easter_egg_rolling_pink",
      "easter_egg_rolling_yellow",
    ],
  },
  "Crate ring": { npcs: ["easter22_reward_crate_npc"], crate: true, message: "You hide inside the crate. Sneaky!" },
  "Snowman ring": {
    choices: {
      Traditional: "xm21_snowman_ring_traditional",
      Tempy: "xm21_snowman_ring_tempy",
      Thermy: "xm21_snowman_ring_thermy",
    },
  },
  "Ring of 3rd Age": { choices: THIRD_AGE },
};

let core;
const active = new WeakMap();
const menus = new WeakMap();
// A worn ring restored at login does not start a transformation.
const observedRings = new WeakMap();
const UNMORPH_GROUP = 136;
const UNMORPH_BUTTON = UNMORPH_GROUP << 16;
const CRATE_GROUP = 747;
const CRATE_EMOTES = new Map([
  [1, "easter22_crate_question"], [2, "easter22_crate_exclaim"],
  [3, "easter22_crate_shake"],
]);
const MENU_GROUP = 187;
const MENU_CHOICES = (MENU_GROUP << 16) | 3;
const CHAT_CHOICES = (219 << 16) | 1;
const MENU_SCRIPT = 217;
const MAIN_MODAL = (161 << 16) | 16;

function key(location) {
  return `${location.getX()},${location.getY()},${location.getZ()}`;
}

function ringOf(item) {
  return item && item.getId() > 0 ? RINGS[item.getDefinition().getName()] ?? null : null;
}

function wornItem(player) {
  return player.getEquipment().getItems()[core.Equipment.RING_SLOT];
}

function sourceValid(player, source) {
  return player.isRegistered() && player.getHitpoints() > 0 && !player.isDyingReturn()
    && player.getStatus() === core.PlayerStatus.NONE && !player.isTeleportingReturn()
    && !player.isNeedsPlacement() && !player.getForceMovement()
    && source.container.getItems()[source.slot] === source.item
    && source.item.getId() === source.id && source.item.getAmount() > 0;
}

function setForm(player, npcId) {
  player.setNpcTransformationId(npcId);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

function unmorph(player) {
  const state = active.get(player);
  if (!state) return;
  active.delete(player);
  player.getPacketSender().closeChatboxFor(state);
  // A later transformation belongs to its own content, not this ring.
  if (player.getNpcTransformationId() !== (state.phase ? -1 : state.npcId)) return;
  if (state.phase) clearCratePhase(player, state.phase);
  else if (!player.getAnimation() || [...CRATE_EMOTES.values()].some(name =>
    core.CacheDefinitions.getSeqId(name) === player.getAnimation().getId())) {
    player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  }
  setForm(player, -1);
  if (state.ring.unequipOnUnmorph && wornItem(player) === state.source.item) {
    core.EquipPacketListener.unequip(player, core.Equipment.RING_SLOT);
  }
}

function clearCratePhase(player, phase) {
  // No newer pose/graphic this tick: cancel this phase's outstanding client effects.
  if (!player.getAnimation() || player.getAnimation().getId() === phase.animation) {
    player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  }
  if (!player.getGraphic() || player.getGraphic().getId() === phase.graphic) {
    player.performGraphic(new core.Graphic(-1));
  }
}

function cratePhase(player, state, animationName, graphicName, ticks) {
  const phase = {
    animation: core.CacheDefinitions.getSeqId(animationName),
    graphic: core.CacheDefinitions.getSpotanimId(graphicName),
  };
  state.phase = phase;
  setForm(player, -1);
  player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  player.performAnimation(new core.Animation(phase.animation));
  player.performGraphic(new core.Graphic(phase.graphic));
  core.TaskManager.submit(new core.CountdownTask(player, ticks, () => {
    if (active.get(player) !== state || state.phase !== phase) return;
    const animation = player.getAnimation();
    if (!sourceValid(player, state.source) || player.getNpcTransformationId() !== -1
      || (animation && animation.getId() >= 0 && animation.getId() !== phase.animation)) {
      unmorph(player);
      return;
    }
    clearCratePhase(player, phase);
    state.phase = null;
    setForm(player, state.npcId);
  }));
}

function morph(player, ring, npc, source) {
  if (!sourceValid(player, source)) return;
  const npcId = core.CacheDefinitions.getNpcId(npc);
  if (!Number.isInteger(npcId) || npcId < 0) return;
  unmorph(player);
  player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  player.getMovementQueue().reset();
  player.setFollowing(null);
  const state = { ring, npcId, source, origin: key(player.getLocation()), ui: ring.crate ? CRATE_GROUP : UNMORPH_GROUP };
  active.set(player, state);
  // The paired human/spotanim sequences last 60 client cycles (two game ticks).
  if (ring.crate) cratePhase(player, state, "human_crate_squat", "easter22_crate_spawn", 2);
  else setForm(player, npcId);
  const sender = player.getPacketSender();
  sender.withChatboxOwner(state, () => sender.sendChatboxInterface(state.ui));
  if (ring.message) player.sendMessage(ring.message);
}

function chooseForm(player, state, npc) {
  if (key(player.getLocation()) !== state.origin || !sourceValid(player, state.source)) return;
  morph(player, state.ring, npc, state.source);
}

function choose(player, ring, source) {
  const entries = Object.entries(ring.choices);
  const state = { ring, source, origin: key(player.getLocation()), entries };
  if (entries.length <= 5) {
    state.group = 219;
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
      new core.OptionDialogue(0, null, ...entries.map(([label]) => label)).setTitle(CHOOSE_TITLE),
    ), state);
    menus.set(player, state);
    return;
  }
  state.group = MENU_GROUP;
  const sender = player.getPacketSender();
  sender.sendClientScript(2524, -1, -1).sendInterface(MENU_GROUP);
  state.mount = sender.getSubInterfaceAt(MAIN_MODAL);
  menus.set(player, state);
  sender.sendClientScript(MENU_SCRIPT, CHOOSE_TITLE, entries.map(([label]) => label).join("|"), 1);
  sender.sendInterfaceFlagsRange(MENU_CHOICES, 0, entries.length - 1, 1);
}

function selectMenu(event) {
  if (event.buttonId !== MENU_CHOICES && event.buttonId !== CHAT_CHOICES) return;
  const { player } = event, state = menus.get(player), sender = player.getPacketSender();
  if (!state || event.groupId !== state.group) return;
  if (state.group === 219 ? player.getDialogueManager().getOwner() !== state
    || !sender.isChatboxInterface(219) : sender.getSubInterfaceAt(MAIN_MODAL) !== state.mount) return;
  event.handled = true;
  const index = (event.slot ?? event.action) - (state.group === 219 ? 1 : 0);
  if (!Number.isInteger(index) || !state.entries[index]) return;
  menus.delete(player);
  // Validate before closing: removing a modal also resets trading/status state.
  if (!sourceValid(player, state.source) || key(player.getLocation()) !== state.origin
    || (state.group === 219 && player.getInterfaceId() >= 0)) {
    if (state.group === 219) sender.closeChatboxFor(state);
    return;
  }
  if (state.group === 219) sender.closeChatboxFor(state);
  else sender.sendInterfaceRemoval();
  chooseForm(player, state, state.entries[index][1]);
}

function begin(player, ring, source) {
  // Existing forms (for example a greegree) belong to their own content.
  if (player.getNpcTransformationId() >= 0
    && player.getNpcTransformationId() !== active.get(player)?.npcId) return;
  if (!sourceValid(player, source)) return;
  player.getSkillManager().stopSkillable();
  if (ring.choices) choose(player, ring, source);
  else morph(player, ring, ring.npcs[(player.getLocation().getX() >> REGION_SIZE_SHIFT) % ring.npcs.length], source);
}

function wear({ player, item, slot }) {
  const ring = ringOf(item);
  if (!ring || player.busy()) return true;
  begin(player, ring, { container: player.getInventory(), item, id: item.getId(), slot });
  return true;
}

function onEquipmentChange({ player }) {
  if (!observedRings.has(player)) return;
  const item = wornItem(player), previous = observedRings.get(player);
  observedRings.set(player, item);
  const state = active.get(player);
  if (state?.source.container === player.getEquipment() && state.source.item !== item) unmorph(player);
  const ring = ringOf(item);
  if (item !== previous && ring?.worn) {
    begin(player, ring, { container: player.getEquipment(), item, id: item.getId(), slot: core.Equipment.RING_SLOT });
  }
}

function onLogin({ player }) {
  observedRings.set(player, wornItem(player));
}

function endOnMove({ player }) {
  const state = active.get(player);
  if (state && (state.origin !== key(player.getLocation()) || !sourceValid(player, state.source)
    || player.getNpcTransformationId() !== (state.phase ? -1 : state.npcId))) unmorph(player);
}

function unmorphButton({ player }) {
  if (active.has(player) && player.getPacketSender().isChatboxInterface(UNMORPH_GROUP)) unmorph(player);
  // A late click belongs to this control, never to a newer conversation.
  return true;
}

function crateControl(event) {
  if (event.groupId !== CRATE_GROUP || event.childId < 0 || event.childId > 4) return;
  event.handled = true;
  const { player } = event, state = active.get(player);
  if (!state?.ring.crate || !player.getPacketSender().isChatboxInterface(CRATE_GROUP)
    || (event.opId ?? event.action) !== 1) return;
  if (event.childId === 0) { unmorph(player); return; }
  if (state.phase || !sourceValid(player, state.source)) return;
  if (event.childId === 4) {
    // Survey reveals the human below the crate; both cache sequences last 100/105 cycles.
    cratePhase(player, state, "human_crate_survey", "easter22_crate_survey", 4);
  } else {
    player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(CRATE_EMOTES.get(event.childId))));
  }
}

function canEmote(event) {
  if (active.has(event.player)) event.allow = false;
}

function closed({ player, interfaceId }) {
  if (menus.get(player)?.group === interfaceId) menus.delete(player);
  if (active.get(player)?.ui === interfaceId) unmorph(player);
}

function endOnHit({ player }) { unmorph(player); }
function onDeath({ player }) { menus.delete(player); unmorph(player); }
function onLogout({ player }) {
  menus.delete(player);
  unmorph(player);
  observedRings.delete(player);
}

module.exports = {
  name: "TransformationRings",
  register(api) {
    core = api.core;
    api.onItemAction("Easter ring", { Wear: wear });
    api.onItemAction("Crate ring", { Wear: wear });
    api.onItemAction("Snowman ring", { Wear: wear });
    api.onItemAction("Ring of 3rd Age", { Wear: wear });
    api.onInterfaceActionButton(UNMORPH_BUTTON, unmorphButton);
    api.onInterfaceActionClick(crateControl);
    api.onInterfaceActionClick(selectMenu);
    api.onCustomEvent("equipment:changed", onEquipmentChange);
    api.onCustomEvent("player:bootstrap-complete", onLogin);
    api.onCustomEvent("interface:closed", closed);
    api.onCustomEvent("player:can-emote", canEmote);
    api.onPlayerProcess(endOnMove);
    api.onPlayerHitModify(endOnHit);
    api.onPlayerBeforeDeath(onDeath);
    api.onPlayerLogout(onLogout);
  },
};

module.exports._test = { RINGS };
