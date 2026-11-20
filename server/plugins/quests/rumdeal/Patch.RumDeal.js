/**
 * The blindweed patch (multiloc 10096 on varbit 1366, children 10097-10102) as the revision 242
 * capture plays it (RumDeal.bin; docs/quests/rum-deal/README.md "The blindweed patch"):
 *
 * - Rake (a rake used on it): seq 2273 with sound 2442 at once and every 4 ticks after, one stage off
 *   (1366 = 1, 2, 3) with a weed and 4 Farming XP on most swings, until it is weeded (ticks 817-833: the
 *   swing at 825 took nothing). Ours: every swing takes a stage (the odds of a miss aren't known).
 * - The seed: seq 2291 and sound 2432, the seed gone at once; 3 ticks later "You plant a seed in the
 *   blindweed patch." (spam), 1366 = 4 and 20 Farming XP (842-845).
 * - It grows on the next five-minute farming tick (1366 = 5, "I wonder how my Blindweed is coming
 *   along...", 1160), and empty weeds grow back one stage a farming tick (1659, 2168, 2653).
 * - Pick: seq 2292 and sound 2437; 3 ticks later the blindweed, 45 Farming XP and 1366 = 3 (1170-1173).
 * - Inspect: the patch state as a game message (805, 899, 1043, 1174).
 *
 * The farming ticks run on a five-minute grid from the epoch; live staggers them by a per-account
 * offset (Ours: no offset). The client only resolves the multiloc when it builds the scene, so each
 * stage change also swaps the child loc for this player.
 */
const { STAGES, VARBITS, ATTRIBUTES } = require("./State.RumDeal");

const CHILDREN = [10097, 10098, 10099, 10100, 10101, 10102];
const TILE = Object.freeze({ x: 2162, y: 5069, z: 0 });
const SHAPE = 10;
const ROTATION = 1;
const WEEDED = 3;
const GROWING = 4;
const GROWN = 5;

const RAKE_ANIMATION = 2273;
const RAKE_SOUND = 2442;
const RAKE_TICKS = 4;
const RAKE_XP = 4;
const PLANT_ANIMATION = 2291;
const PLANT_SOUND = 2432;
const PLANT_XP = 20;
const PICK_ANIMATION = 2292;
const PICK_SOUND = 2437;
const PICK_XP = 45;
const ACTION_TICKS = 3;
const FARMING_TICK_MS = 5 * 60 * 1000;
const TICK_MS = 600;

const INSPECT = "This is a blindweed patch. The soil has not been treated.";

module.exports = function rumDealPatch(api, ctx) {
  const { Animation, ChatType, CountdownTask, GameObject, ItemIdentifiers, Location, Skill, Task, TaskManager } = api.core;
  const BLINDWEED_SEED = ItemIdentifiers.BLINDWEED_SEED;
  const BLINDWEED = ItemIdentifiers.BLINDWEED;
  const WEEDS = ItemIdentifiers.WEEDS;
  const timers = new Map();
  const raking = new Map();

  const weeds = (player) => Number(player.getAttribute(ATTRIBUTES.WEEDS)) || 0;
  const weedsAt = (player) => Number(player.getAttribute(ATTRIBUTES.WEEDS_AT)) || 0;
  const plantedAt = (player) => Number(player.getAttribute(ATTRIBUTES.PLANTED)) || 0;
  const nextFarmingTick = (at) => (Math.floor(at / FARMING_TICK_MS) + 1) * FARMING_TICK_MS;
  const farmingTicksSince = (at, now) => (at > 0 ? Math.max(0, Math.floor(now / FARMING_TICK_MS) - Math.floor(at / FARMING_TICK_MS)) : 0);

  /** The patch's varbit value now: 0-3 how far it is raked (weeds growing back), 4 growing, 5 grown. */
  function stageOf(player, now = Date.now()) {
    const planted = plantedAt(player);
    if (planted > 0) return now >= nextFarmingTick(planted) ? GROWN : GROWING;
    return Math.max(0, weeds(player) - farmingTicksSince(weedsAt(player), now));
  }

  /** The varbit, and the child swapped on the client when the patch is in its scene. */
  function show(player, stage) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBITS.PATCH, stage);
    if (!player.getSession?.()?.isTileInScene?.(TILE.x, TILE.y, TILE.z)) return;
    const location = new Location(TILE.x, TILE.y, TILE.z);
    sender.sendObjectRemoval(new GameObject(CHILDREN[0], location, SHAPE, ROTATION, null));
    sender.sendObject(new GameObject(CHILDREN[stage], location, SHAPE, ROTATION, null));
  }

  /** Brings the weeds count up to date (so later raking starts from what is shown) and shows it. */
  function sync(player) {
    const now = Date.now();
    if (plantedAt(player) === 0 && weeds(player) > 0) {
      const left = stageOf(player, now);
      if (left !== weeds(player)) {
        player.setAttribute(ATTRIBUTES.WEEDS, left);
        // Growing back counts from the farming tick it last grew on.
        player.setAttribute(ATTRIBUTES.WEEDS_AT, left > 0 ? Math.floor(now / FARMING_TICK_MS) * FARMING_TICK_MS : 0);
      }
    }
    const stage = stageOf(player, now);
    show(player, stage);
    schedule(player);
    return stage;
  }

  /** One timer per player for the patch's next farming tick: the crop growing, or a weed growing back. */
  function schedule(player) {
    stop(player);
    const planted = plantedAt(player);
    const now = Date.now();
    let at = null;
    if (planted > 0 && now < nextFarmingTick(planted)) at = nextFarmingTick(planted);
    else if (planted === 0 && weeds(player) > 0) at = nextFarmingTick(now);
    if (at === null) return;
    const task = new CountdownTask(player, Math.max(1, Math.ceil((at - now) / TICK_MS)), () => {
      if (timers.get(player) !== task || !player.isRegistered?.()) return;
      timers.delete(player);
      const grew = plantedAt(player) > 0;
      sync(player);
      if (grew && stageOf(player) === GROWN) player.sendMessage("I wonder how my Blindweed is coming along...");
    });
    timers.set(player, task);
    TaskManager.submit(task);
  }

  function stop(player) {
    const task = timers.get(player);
    if (task) task.stop();
    timers.delete(player);
    const rake = raking.get(player);
    if (rake) rake.stop();
    raking.delete(player);
  }

  /** A rake used on the patch: a stage every four ticks until it is weeded. */
  function rake(event) {
    const { player } = event;
    event.handled = true;
    if (plantedAt(player) !== 0) {
      player.sendMessage("This patch already has something growing in it.");
      return;
    }
    if (sync(player) >= WEEDED) {
      player.sendMessage("This patch doesn't need weeding right now.");
      return;
    }
    const position = player.getLocation().clone();
    const swing = () => {
      player.performAnimation(new Animation(RAKE_ANIMATION));
      player.getPacketSender().sendSound(RAKE_SOUND, 1, 0);
    };
    swing();
    const task = new (class extends Task {
      constructor() { super(RAKE_TICKS, player, false); }
      execute() {
        if (raking.get(player) !== this || player.getHitpoints() <= 0 || !player.getLocation().equals(position)
          || plantedAt(player) !== 0 || !ctx.held(player, ItemIdentifiers.RAKE)) {
          raking.delete(player);
          this.stop();
          return;
        }
        const stage = Math.min(WEEDED, weeds(player) + 1);
        player.setAttribute(ATTRIBUTES.WEEDS, stage);
        player.setAttribute(ATTRIBUTES.WEEDS_AT, Date.now());
        // Ours: a full backpack loses the weed (the capture had room).
        if (ctx.hasFreeSlot(player)) player.getInventory().adds(WEEDS, 1);
        player.getSkillManager().addExperiences(Skill.FARMING, RAKE_XP);
        show(player, stage);
        if (stage < WEEDED) {
          swing();
          return;
        }
        player.performAnimation(new Animation(-1));
        raking.delete(player);
        this.stop();
        schedule(player);
      }
    })();
    const previous = raking.get(player);
    if (previous) previous.stop();
    raking.set(player, task);
    TaskManager.submit(task);
  }

  /** The seed used on the weeded patch. */
  function plant(event) {
    const { player } = event;
    event.handled = true;
    if (plantedAt(player) !== 0) {
      player.sendMessage("This patch already has something growing in it.");
      return;
    }
    if (sync(player) < WEEDED) {
      // Ours: not captured; the patch has to be raked first.
      player.sendMessage("This patch needs weeding first.");
      return;
    }
    if (ctx.level(player, Skill.FARMING) < 40) {
      ctx.statement(player, "You must be a Level 40 Farmer to plant those.");
      return;
    }
    player.getInventory().deleteNumber(BLINDWEED_SEED, 1);
    player.performAnimation(new Animation(PLANT_ANIMATION));
    player.getPacketSender().sendSound(PLANT_SOUND, 1, 0);
    ctx.hold(player, ACTION_TICKS);
    TaskManager.submit(new CountdownTask(player, ACTION_TICKS, () => {
      if (!player.isRegistered?.()) return;
      player.setAttribute(ATTRIBUTES.PLANTED, Date.now());
      player.getPacketSender().sendTypedMessage(ChatType.SPAM, "You plant a seed in the blindweed patch.");
      player.getSkillManager().addExperiences(Skill.FARMING, PLANT_XP);
      show(player, GROWING);
      schedule(player);
    }));
  }

  /**
   * Inspect: the capture's three states (needs weeding, growing, empty and weeded); the grown one is
   * the Wiki's with its "(Crop)" left out (Ours).
   */
  function inspect(event) {
    const { player } = event;
    event.handled = true;
    const stage = sync(player);
    if (stage === GROWN) player.sendMessage(`${INSPECT} The patch is fully grown.`);
    else if (stage === GROWING) player.sendMessage(`${INSPECT} The patch has something growing in it.`);
    else if (stage === WEEDED) player.sendMessage(`${INSPECT} The patch is empty and weeded.`);
    else player.sendMessage(`${INSPECT} The patch needs weeding.`);
  }

  /** Pick: the grown patch gives one blindweed and goes back to weeded. */
  function pick(event) {
    const { player } = event;
    event.handled = true;
    if (sync(player) !== GROWN) {
      inspect(event);
      return;
    }
    if (!ctx.hasFreeSlot(player)) {
      player.sendMessage("You do not have any free space for the Blindweed.");
      return;
    }
    player.performAnimation(new Animation(PICK_ANIMATION));
    player.getPacketSender().sendSound(PICK_SOUND, 1, 0);
    ctx.hold(player, ACTION_TICKS);
    TaskManager.submit(new CountdownTask(player, ACTION_TICKS, () => {
      if (!player.isRegistered?.() || plantedAt(player) === 0) return;
      // The backpack can fill during the pick (an item unequipped into the last slot): the crop stays grown.
      if (!ctx.hasFreeSlot(player)) {
        player.sendMessage("You do not have any free space for the Blindweed.");
        return;
      }
      player.setAttribute(ATTRIBUTES.PLANTED, 0);
      player.setAttribute(ATTRIBUTES.WEEDS, WEEDED);
      player.setAttribute(ATTRIBUTES.WEEDS_AT, Date.now());
      player.getInventory().adds(BLINDWEED, 1);
      player.getSkillManager().addExperiences(Skill.FARMING, PICK_XP);
      if (ctx.quest().getStage(player) === STAGES.GIVEN_SEEDS) ctx.quest().setStage(player, STAGES.GROWN_BLINDWEED);
      show(player, WEEDED);
      schedule(player);
    }));
  }

  const planted = (player) => plantedAt(player) !== 0;

  /** The agent MCP's advance_time: the patch's clock moves `ms` earlier, then it catches up. */
  function advanceTime(request) {
    const { player, ms } = request ?? {};
    if (!player || !(ms > 0) || (plantedAt(player) === 0 && weeds(player) === 0)) return;
    if (plantedAt(player) > 0) player.setAttribute(ATTRIBUTES.PLANTED, plantedAt(player) - ms);
    if (weedsAt(player) > 0) player.setAttribute(ATTRIBUTES.WEEDS_AT, weedsAt(player) - ms);
    const grew = plantedAt(player) > 0 && stageOf(player, Date.now() - Math.max(0, ms)) !== GROWN;
    if (sync(player) === GROWN && grew) player.sendMessage("I wonder how my Blindweed is coming along...");
    request.handledBy?.push?.("RumDeal");
  }

  return { CHILDREN, rake, plant, inspect, pick, sync, stop, stageOf, planted, advanceTime };
};
