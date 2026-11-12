// A crewmate on a salvaging hook, as live (rsprox, Jobless Jim and Cabin Boy Jenkins on a
// sloop): with a raised wreck in range they cast on their own (the crew cast, 1180/1181, and the
// hook's), then every 5 ticks play the hook's idle and roll; salvage goes into the cargo hold
// ("Managed to hook some salvage! I'll put it in the cargo hold.") and the captain gets a share of
// its XP by their Deckhandiness (Wiki: 10/20/30/40% at D1-D4) with "You gain some experience by
// watching your crew work." A full hold stops them: "Your crewmate on the salvaging hook cannot
// salvage as the cargo hold is full." and their line about it; they try again once there's room.
// A wreck above the captain's Sailing level they won't touch: "Afraid that ship is a bit too
// complicated for me to salvage." (rsprox, with the hook's reset; the transcript's condition is
// "Without the Sailing level for the ship", as crew salvage at the captain's level).
const common = require("./Common.Crew");
const lines = require("./Lines.Crew");
const salvaging = require("../Salvaging.Sailing");
const shipwrecks = require("../Shipwrecks.Salvaging");
const cargo = require("../Cargo.Sailing");
const { animateDeckLoc } = require("../SailingContent.Sailing");

/** `crew_facility` of salvaging hooks (table 176). */
const CREW_FACILITY_HOOK = 7;
/** A crewmate's hook plays its idle and rolls every 5 ticks (rsprox: 36, 41 ... 71, 76). */
const ROLL_TICKS = 5;
/** Share of a salvage's XP by Deckhandiness 1-4 (Wiki, Crewmates, after the 5 December 2025 hotfix). */
const SALVAGE_XP_SHARE = [0, 0.1, 0.2, 0.3, 0.4];
const HOLD_FULL = "Your crewmate on the salvaging hook cannot salvage as the cargo hold is full.";
/** A roll that comes up empty: "'avin a butchers at the hook." now and then (rsprox: 17,629 in 1.28M hook idles). */
const HOOK_CHATTER_CHANCE = 1 / 72;

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(common.core().ChatType.SPAM, text);
}

/** The hook loc on a hotspot of a boat at sea. */
function hookOn(boat, hotspot) {
  return common.core().BoatManager.getSpec(boat)?.locs.find((loc) => loc.hotspot === hotspot && loc.shape === 10);
}

/** Whether the cargo hold has no room for one more of an item. */
function holdFull(owned, itemId) {
  if (cargo.isStackable(itemId) && owned.cargo.some((slot) => slot?.id === itemId)) return false;
  for (let slot = 0; slot < cargo.capacityOf(owned); slot++) if (!owned.cargo[slot]) return false;
  return true;
}

/** Works the hook on `hotspot` until the job stops. */
function work(player, boat, owned, member, hotspot) {
  const { npc, crew } = member;
  const hook = hookOn(boat, hotspot);
  if (!hook) return undefined;
  const { Animation, CacheDefinitions, Skill, Task, TaskManager } = common.core();
  const tier = salvaging.hookTierOf(CacheDefinitions.getObject(hook.id)?.name);
  if (tier < 0) return undefined;
  const anims = salvaging.hookAnims(hook.id);
  let session;
  let full = false;
  /** The wreck (and its generation) last called too complicated, so it's said once. */
  let refused;
  const reset = () => {
    session = undefined;
    npc.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
    animateDeckLoc(player, boat, hook, anims.locReset);
  };
  const task = new (class extends Task {
    constructor() { super(1, npc, false); }
    execute() {
      if (!npc.isRegistered?.() || member.job !== job) return this.stop();
      const at = salvaging.hookTile(boat, hook);
      if (!session) {
        const wreck = shipwrecks.raisedWreckNear(at.x, at.y, at.level, salvaging.HOOK_RANGE);
        if (!wreck) return;
        const type = shipwrecks.wreckType(wreck.type);
        if (common.sailingLevel(player) < type.level) {
          if (refused?.wreck !== wreck || refused.generation !== wreck.generation) {
            refused = { wreck, generation: wreck.generation };
            lines.say(npc, crew, "tooComplicated");
            animateDeckLoc(player, boat, hook, anims.locReset);
          }
          return;
        }
        if (holdFull(owned, type.salvage)) {
          if (!full) {
            full = true;
            spam(player, HOLD_FULL);
            lines.say(npc, crew, "holdFull");
          }
          return;
        }
        full = false;
        session = { wreck, type, generation: wreck.generation, ticks: 0 };
        npc.performAnimation(new Animation(anims.crewDrop));
        animateDeckLoc(player, boat, hook, anims.locDrop);
        shipwrecks.startDespawn(wreck);
        return;
      }
      const { wreck, type } = session;
      if (wreck.generation !== session.generation || wreck.z !== at.level
        || shipwrecks.distanceTo(wreck, at.x, at.y) > salvaging.HOOK_RANGE) return reset();
      if (++session.ticks % ROLL_TICKS !== 0) return;
      npc.performAnimation(new Animation(anims.idle));
      animateDeckLoc(player, boat, hook, anims.locIdle);
      const [low, high] = type.success[tier];
      if (Math.random() >= salvaging.successChance(low, high, common.sailingLevel(player))) {
        if (Math.random() < HOOK_CHATTER_CHANCE) lines.say(npc, crew, "hook");
        return;
      }
      if (cargo.store(owned, type.salvage, 1) === 0) {
        full = true;
        spam(player, HOLD_FULL);
        lines.say(npc, crew, "holdFull");
        return reset();
      }
      common.core().PluginManager.emitCustomEvent("sailing:cargo-changed", { player, boat: owned });
      lines.say(npc, crew, "salvaged");
      const share = SALVAGE_XP_SHARE[common.statOf(owned, crew, common.STAT.DECKHANDINESS)] ?? 0;
      if (share > 0) {
        player.getSkillManager().addExperiences(Skill.SAILING, type.xp * share);
        spam(player, "You gain some experience by watching your crew work.");
      }
    }
  })();
  const job = {
    stop: () => {
      task.stop();
      if (session) reset();
    },
  };
  TaskManager.submit(task);
  return job;
}

function attach(api) {
  common.init(api);
}

module.exports = attach;
module.exports.work = work;
module.exports.CREW_FACILITY_HOOK = CREW_FACILITY_HOOK;
module.exports.SALVAGE_XP_SHARE = SALVAGE_XP_SHARE;
module.exports.HOLD_FULL = HOLD_FULL;
