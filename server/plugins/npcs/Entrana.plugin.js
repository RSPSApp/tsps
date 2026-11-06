"use strict";

const POLICY = require("./data/entrana-items.json");
const ALLOWED = new Set(POLICY.allowedNames.map(name => name.toLowerCase()));
const FORBIDDEN_IDS = new Set(POLICY.forbiddenIds);
const FORBIDDEN = new Set(POLICY.forbiddenNames.map(name => name.toLowerCase()));
const SUPPLIES = new Set(POLICY.supplyNames.map(name => name.toLowerCase()));
const PAGE = "Monk of Entrana";
const BOARDED = new WeakSet();
const BOARD_ACTION = "b8yDey";
const RETURN_ACTION = "lbXVJH";
const SEARCH_CONDITION = "hmJbfY";
const PORT_MONKS = new Set([1165, 1166, 1167]); // cache shipmonk1_c..3_c
const ISLAND_MONKS = new Set([1168, 1169, 1170]); // cache shipmonk1_e..3_e
const CONDITION_IDS = new Set([SEARCH_CONDITION, "pTEzrk", "Oio4-G", "2YlCt1", "1-jMaw", "Q8WkXt"]);

function isMonk(npcId) {
  return PORT_MONKS.has(npcId) || ISLAND_MONKS.has(npcId);
}

/** Wiki exceptions are exact names/families; robes/capes in general are not exempt. */
function allowedEquipment(item) {
  const name = item.name.toLowerCase();
  return ALLOWED.has(name) || item.wearPos === 2 || item.wearPos === 12 || item.wearPos === 13
    || (item.wearPos === 9 && /\bbracelet\b/.test(name))
    || /^team-(?:[1-9]|[1-4]\d|50) cape$/.test(name)
    || ["team cape i", "team cape x", "team cape zero"].includes(name);
}

/** One carried item, including content-sensitive containers via their owning plugins. */
function restriction(api, player, item) {
  const definition = api.core.CacheDefinitions.getItem(item.getId());
  if (!definition || definition.noteTemplate >= 0) return null; // Monks do not inspect bank notes (Wiki).
  const name = definition.name?.toLowerCase() ?? "";
  if (FORBIDDEN_IDS.has(item.getId())) return "gear";
  if (name === "looting bag" || name === "tackle box") {
    const request = { player, item, contents: [], handled: false };
    api.emitCustomEvent("storage:contents", request);
    // These owners are part of the normal plugin set. Refuse an uninspectable container.
    if (!request.handled) return "gear";
    for (const entry of request.contents) {
      const nested = api.core.CacheDefinitions.getItem(entry.id);
      if (name === "tackle box") {
        if (nested.wearPos === 3 && /harpoon/i.test(nested.name)) return "gear";
      } else if (restriction(api, player, new api.core.Item(entry.id, entry.amount))) return "gear";
    }
    return null;
  }
  if (/^(?:(?:baby|young|gourmet|earth|essence|eclectic|nature|magpie|ninja|dragon|lucky|crystal) )?impling jar$/.test(name)) return "jar";
  if (SUPPLIES.has(name)) return "supply";
  if (FORBIDDEN.has(name)) return name.includes("saradomin") ? "saradomin" : "gear";
  if (allowedEquipment(definition)) return null;
  if (Array.from({ length: 10 }, (_, index) => definition.params?.get(index) ?? 0).some(bonus => bonus !== 0)) {
    return name.includes("saradomin") ? "saradomin" : "gear";
  }
  return null;
}

/** Public Entrana admission result for ferry/balloon/container consumers. */
function checkItems(api, request) {
  if (request.handled && request.allowed === false) return;
  const items = [...request.player.getInventory().getValidItems(), ...request.player.getEquipment().getValidItems()];
  const reasons = new Set(items.map(item => restriction(api, request.player, item)).filter(Boolean));
  request.reason = ["saradomin", "gear", "jar", "supply"].find(reason => reasons.has(reason)) ?? null;
  request.allowed = request.reason === null;
  request.handled = true;
}

function admission(api, player) {
  const request = { player, allowed: false, reason: null, handled: false };
  api.emitCustomEvent("entrana:check-items", request);
  return request;
}

function selectVariant({ npcId }) {
  if (PORT_MONKS.has(npcId)) return { page: PAGE, variant: "standard-dialogue-port-sarim" };
  if (ISLAND_MONKS.has(npcId)) return { page: PAGE, variant: "standard-dialogue-entrana" };
  return null;
}

function answerCondition(api, { player, npcId, stepId }) {
  if (!PORT_MONKS.has(npcId) || !CONDITION_IDS.has(stepId)) return null;
  if (stepId === SEARCH_CONDITION) return !BOARDED.has(player);
  const { reason, allowed } = admission(api, player);
  return ({ pTEzrk: reason === "saradomin", "Oio4-G": reason === "gear", "2YlCt1": reason === "jar", "1-jMaw": reason === "supply", Q8WkXt: allowed })[stepId];
}

function dialogueAction(api, event) {
  if (event.handled || !isMonk(event.npcId)) return;
  const { player, stepId } = event;
  if (stepId === BOARD_ACTION && PORT_MONKS.has(event.npcId)) {
    event.handled = true;
    if (!admission(api, player).allowed) {
      event.end = true;
      player.sendMessage("You cannot take weapons, armour or other forbidden items to Entrana.");
      return;
    }
    BOARDED.add(player);
    player.moveTo(new api.core.Location(2834, 3331, 1));
    api.emitCustomEvent("entrana:boarded", { player });
  } else if (stepId === RETURN_ACTION && ISLAND_MONKS.has(event.npcId)) {
    event.handled = true;
    player.moveTo(new api.core.Location(3048, 3231, 1));
  }
}

function resetSession({ player }) {
  BOARDED.delete(player);
}

module.exports = {
  name: "Entrana",
  members: true,
  register(api) {
    api.onNpcDialogueVariant(selectVariant);
    api.onNpcDialogueCondition(answerCondition.bind(null, api));
    api.onCustomEvent("entrana:check-items", checkItems.bind(null, api));
    api.onCustomEvent("npc-dialogue:action", dialogueAction.bind(null, api));
    api.onPlayerLogin(resetSession);
    api.onPlayerLogout(resetSession);
  },
};
