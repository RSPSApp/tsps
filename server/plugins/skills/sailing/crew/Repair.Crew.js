// A crewmate making repairs (Wiki: Boat combat, Repair kits): while the boat is damaged they use
// the hold's repair kits, each repairing its own hitpoints plus their Deckhandiness less 1, with
// no attack delay for the captain. They say their line (the transcript's "Aye, that's better."),
// and once the hold has no kits left they stop as live does without any ("Your crew can only make
// repairs if the boat has repair kits in its cargo hold.", Assign.Crew.js). How often they repair
// isn't captured (ours: every 5 ticks, the best kit first).
const common = require("./Common.Crew");
const lines = require("./Lines.Crew");
const cargo = require("../Cargo.Sailing");
const BoatHp = require("../seacombat/BoatHp.SeaCombat");

const REPAIR_TICKS = 5;
/** sailing_sidepanel_repairkits: what the hold's kits repair. */
const VARBIT_REPAIR_KITS = 19210;
const ANIM_REPAIR = 13252;
const REPAIRED_LINE = "Aye, that's better.";

/** The hold's best repair kit, or undefined. */
function bestKit(owned) {
  return Object.entries(cargo.REPAIR_KITS)
    .map(([kit, heals]) => ({ kit: Number(kit), heals }))
    .sort((a, b) => b.heals - a.heals)
    .find(({ kit }) => cargo.countIn(owned, kit) > 0);
}

/**
 * Repairs the boat until the job stops. `outOfKits` is called when the hold runs dry, to send them
 * back as a crewmate with no kits is.
 */
function work(player, boat, owned, member, outOfKits) {
  const { Animation, Task, TaskManager } = common.core();
  const task = new (class extends Task {
    constructor() { super(REPAIR_TICKS, member.npc, false); }
    execute() {
      if (!common.crewAboard(boat).includes(member) || common.core().Sailing.instanceAboard(player) !== boat) {
        this.stop();
        return;
      }
      if ((owned.damage ?? 0) <= 0) return;
      const kit = bestKit(owned);
      if (!kit) {
        this.stop();
        outOfKits();
        return;
      }
      cargo.take(owned, 0, kit.kit, 1);
      member.npc.performAnimation(new Animation(ANIM_REPAIR));
      BoatHp.heal(player, owned, kit.heals + Math.max(0, (common.statOf(owned, member.crew, common.STAT.DECKHANDINESS) || 1) - 1));
      player.getPacketSender().sendVarbit(VARBIT_REPAIR_KITS, cargo.repairKitUses(owned));
      common.core().PluginManager.emitCustomEvent("sailing:cargo-changed", { player, boat: owned });
      if (!lines.say(member.npc, member.crew, "repaired")) member.npc.forceChat(REPAIRED_LINE);
    }
  })();
  TaskManager.submit(task);
  return { stop: () => task.stop() };
}

module.exports = { work, bestKit, REPAIR_TICKS };
