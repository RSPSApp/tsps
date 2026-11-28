// Fishier bladderier stout: RSProx 235/948 ticks9247-9254 and the OSRS Wiki drink page.
const common = require("./Common.Charting");
const portTasks = require("../porttasks/Common.PortTasks");
const KEY = "drink_crate_fishier_stout";
const ARENA_ATTRIBUTE = "charting:fishier-arena";
const REWARDS_ATTRIBUTE = "charting:fishier-rewards";
const WARNING = "You take a close look at the expiry date on this drink. It looks like it will be extremely potent and dangerous. Are you sure you want to drink this?";
const FADE_UID = (161 << 16) | 1;
const LONGHALL = [2659, 3674, 0];
const SOURCE = [2880, 3584];
const TROLLS = [
  ["sailing_charting_drink_troll_dad", 36, 28],
  ["sailing_charting_drink_troll_ice", 26, 28],
  ["sailing_charting_drink_troll_thrower", 31, 23],
];
const REWARDS = [
  ["water", "It burns."], ["ice", "It burns, but cold."], ["stew", "It burns, but with chunks."],
];
const scenes = new Map();
let Arena;

function warn(player, consume) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = common.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new StatementDialogue(0, WARNING))
    .add(new ActionDialogue(1, { execute: () => common.api().sendMultiChatboxPrompt(player,
      "Are you sure you want to drink this?", "Yes.", consume, "No.", () => player.getPacketSender().sendInterfaceRemoval()) })));
}
function later(scene, ticks, callback) {
  common.core().TaskManager.submit(new (common.core().CountdownTask)(scene, ticks, () => {
    if (scenes.get(scene.player) === scene && scene.player.isRegistered()) callback();
  }));
}
function fade(player, out) {
  player.getPacketSender().sendSubInterface(FADE_UID, 174, 1, {
    postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
  });
}
function controls(player, blocked) {
  player.getMovementQueue().reset().setBlockMovement(blocked);
  player.setUntargetable(blocked);
  player.getPacketSender().sendVarbit(common.core().CacheDefinitions.getVarbitId("minimap_state"), blocked ? 2 : 0);
}
function end(player, logout = false) {
  const scene = scenes.get(player);
  if (!scene) return;
  scenes.delete(player);
  common.core().TaskManager.cancelTasks(scene);
  for (const npc of scene.npcs) {
    scene.area?.remove(npc);
    common.api().removeNpc(npc);
  }
  if (scene.area && player.getArea() === scene.area) scene.area.leave(player, logout);
  scene.area?.destroy();
  player.setAttribute(ARENA_ATTRIBUTE, false);
  controls(player, false);
  player.getPacketSender().closeSubInterface(FADE_UID);
  if (logout) player.setLocation(new (common.core().Location)(...LONGHALL));
}
function onLogout({ player }) { end(player, true); }

function createArenaClass() {
  const { TemplatedInstanceArea } = common.core();
  return class FishierArena extends TemplatedInstanceArea {
    constructor(owner) { super(8, 8); this.owner = owner; }
    isMulti() { return true; }
    canTeleport() { return true; }
    npcAggression(player, npc) { return player === this.owner && npc.getOwner() === player; }
    postLeave(mobile, logout) {
      if (mobile === this.owner && scenes.has(mobile)) end(mobile, logout);
      super.postLeave(mobile, logout);
    }
  };
}
function dockBoat(player) {
  const { Sailing, Skill } = common.core();
  const owned = Sailing.activeBoat(player);
  if (!Sailing.instanceAboard(player) || !owned) return;
  const request = { player, key: "the_fremennik_trials", complete: null };
  common.api().emitCustomEvent("quest:is-complete", request);
  const dock = player.getSkillManager().getMaxLevel(Skill.SAILING) >= 62 && request.complete === true ? "rellekka" : "port_sarim";
  if (Sailing.disembark(player, dock) !== null) return;
  owned.location = { kind: "docked", dock };
  // The drink page specifically preserves non-courier cargo, unlike recovery after sinking. The
  // crates it does take still go back to their task slots, or the source ledger keeps refusing a
  // replacement for a crate this deleted (#6878).
  const crates = [];
  owned.cargo = owned.cargo.map((slot) => {
    if (!slot || !portTasks.isCrate(slot.id)) return slot;
    crates.push({ id: slot.id, amount: slot.amount ?? 1 });
    return null;
  });
  if (crates.length > 0) common.api().emitCustomEvent("sailing:cargo-lost", { player, boat: owned, crates });
}
function enter(scene) {
  const { player } = scene;
  dockBoat(player);
  if (!Arena) Arena = createArenaClass();
  const area = scene.area = new Arena(player);
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) area.setChunk(0, x, y, {
    sourceChunkX: SOURCE[0] / 8 + x, sourceChunkY: SOURCE[1] / 8 + y, sourcePlane: 0, rotation: 0,
  });
  area.enter(player);
  player.moveTo(area.tile(31, 28, 0));
  player.setAttribute(ARENA_ATTRIBUTE, true);
}
function spawn(scene) {
  for (const [gameval, x, y] of TROLLS) {
    const at = scene.area.tile(x, y, 0);
    const npc = common.api().spawnNpc({ id: common.core().CacheDefinitions.getNpcId(gameval),
      x: at.getX(), y: at.getY(), z: 0, owner: scene.player, ownerOnly: true, wanderRadius: 0 });
    if (!npc) continue;
    scene.area.enter(npc);
    scene.npcs.push(npc);
    require("./DrinkEffects.Charting").introduction(npc);
    npc.getCombat().attack(scene.player);
  }
}
function start(player) {
  end(player);
  const scene = { player, area: null, npcs: [] };
  scenes.set(player, scene);
  player.getPacketSender().sendInterfaceRemoval();
  controls(player, true);
  fade(player, true);
  later(scene, 2, () => player.sendMessage("... until you black out..."));
  later(scene, 3, () => enter(scene));
  later(scene, 6, () => {
    player.sendMessage("And wake up somewhere strange.");
    fade(player, false);
    controls(player, false);
  });
  later(scene, 7, () => spawn(scene));
  later(scene, 8, () => player.getPacketSender().closeSubInterface(FADE_UID));
}
function exit(event) {
  const scene = scenes.get(event.player);
  if (!scene?.area || event.player.getArea() !== scene.area || event.clickType !== 1) return;
  const { CacheDefinitions, Location } = common.core();
  if (!["troll_stronghold_arena_exit_left", "troll_stronghold_arena_exit_right"].some(key => CacheDefinitions.getLocId(key) === event.objectId)) return;
  event.handled = true;
  end(event.player);
  event.player.moveTo(new Location(...LONGHALL));
}
function rewardDrink(event) {
  if (event.option !== "Drink") return;
  const { CacheDefinitions, Animation, PlayerStatus } = common.core();
  const index = REWARDS.findIndex(([suffix]) => CacheDefinitions.getObjId(`sailing_charting_drink_crate_fishier_stout_${suffix}`) === event.itemId);
  if (index < 0) return;
  event.handled = true;
  const { player } = event;
  const item = player.getInventory().getItems()[event.slot];
  if (!player.isRegistered() || player.getHitpoints() <= 0 || player.getStatus() !== PlayerStatus.NONE
    || item !== event.item || item?.getId() !== event.itemId || item.getAmount() < 1) return;
  player.getInventory().deleteAtSlot(event.slot, 1, true);
  player.performAnimation(new Animation(CacheDefinitions.getSeqId("human_eat")));
  player.sendMessage("You take a drink.");
  player.sendMessage(REWARDS[index][1]);
  const rewards = player.getAttribute(REWARDS_ATTRIBUTE) | 0;
  if ((rewards & (1 << index)) === 0) {
    player.setAttribute(REWARDS_ATTRIBUTE, rewards | (1 << index));
    player.getPacketSender().sendVarbit(CacheDefinitions.getVarbitId(`sailing_charting_drink_crate_fishier_stout_${REWARDS[index][0]}`), 1);
    common.addXp(player, 100);
  }
}
function onLogin({ player }) {
  const { CacheDefinitions, Location } = common.core();
  for (let i = 0; i < REWARDS.length; i++) player.getPacketSender().sendVarbit(
    CacheDefinitions.getVarbitId(`sailing_charting_drink_crate_fishier_stout_${REWARDS[i][0]}`), ((player.getAttribute(REWARDS_ATTRIBUTE) | 0) >> i) & 1);
  // Session instances cannot survive a process restart; never hydrate a player into freed tiles.
  if (player.getAttribute(ARENA_ATTRIBUTE) === true) {
    player.setAttribute(ARENA_ATTRIBUTE, false);
    player.moveTo(new Location(...LONGHALL));
    controls(player, false);
  }
}
function attach(api) {
  common.init(api);
  api.persistAttribute(ARENA_ATTRIBUTE, false);
  api.persistAttribute(REWARDS_ATTRIBUTE, 0);
  api.onBeforeObjectInteraction(exit);
  api.onItemAction(rewardDrink);
  api.onPlayerLogout(onLogout);
  api.onPlayerLogin(onLogin);
}
module.exports = { attach, warn, start, scenes, KEY, ARENA_ATTRIBUTE, REWARDS_ATTRIBUTE };
