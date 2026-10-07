/**
 * Bryophyta, the Moss Giantess, as captured (stats and rules from the Wiki):
 * - she punches (4658) in reach, or casts (7173) an earth blast (139) that lands at 46 + 10 cycles
 *   a tile (its heights are the capture's 172/124 in the server's quarter units); her melee can
 *   poison (8);
 * - each attack has a 1/5 chance to summon three growthlings, one batch at a time and at least
 *   20 ticks apart; while any lives, she takes no damage;
 * - a growthling hit with an axe or magic secateurs equipped dies at once ("You prune the
 *   Growthling."); otherwise "Cut the growthling down with an axe or secateurs.", and it can be
 *   hurt but never killed;
 * - the logs in her lair give a bronze axe to a player without one, and grow it back.
 */
const Common = require("./Common.GiantLairs");
const Lair = require("./Lair.GiantLairs");

let DATA = null;
let LAIR = null;
const SECATEURS = new Set([7409, 11711]);
/** Woodcutting axes; not battleaxes, the zombie axe or the blessed axe (Wiki). */
const AXE_NAME = /(^|\s)axe(\s\(.*\))?$/i;
const NOT_AN_AXE = /^(zombie|blessed) axe/i;

let api = null;
let core = null;

const roll = (oneIn) => Math.floor(Math.random() * oneIn) === 0;

/** Per lair: its growthlings and when they were last summoned. */
function state(session) {
  if (!session.bryophyta) session.bryophyta = { growthlings: [], lastSummon: -Infinity };
  return session.bryophyta;
}

function liveGrowthlings(session) {
  const growth = state(session);
  growth.growthlings = growth.growthlings.filter((npc) => npc.isRegistered?.() !== false && npc.getHitpoints() > 0);
  return growth.growthlings;
}

function canPrune(player) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  const id = weapon?.getId?.() ?? -1;
  if (id <= 0) return false;
  if (SECATEURS.has(id)) return true;
  const name = core.ItemDefinition.forId(id).getName() ?? "";
  return AXE_NAME.test(name) && !NOT_AN_AXE.test(name);
}

function distanceFrom(npc, target) {
  const at = npc.getLocation();
  const size = npc.getSize?.() ?? 3;
  const to = target.getLocation();
  const dx = Math.max(at.getX() - to.getX(), 0, to.getX() - (at.getX() + size - 1));
  const dy = Math.max(at.getY() - to.getY(), 0, to.getY() - (at.getY() + size - 1));
  return Math.max(dx, dy);
}

function freeTileNear(npc, session) {
  const { Location, RegionManager } = core;
  const { radius } = DATA.growthlings;
  const centre = npc.getLocation();
  const { minX, maxX, minY, maxY } = LAIR.area;
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = centre.getX() + 1 + Math.floor(Math.random() * (radius * 2 + 1)) - radius;
    const y = centre.getY() + 1 + Math.floor(Math.random() * (radius * 2 + 1)) - radius;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    const tile = new Location(x, y, 0);
    if (!RegionManager.blocked(tile, session.area)) return tile;
  }
  return null;
}

/** On an attack: the 1/5 roll, when no batch is alive and the last was 20+ ticks ago. */
function maybeSummon(npc, target) {
  const session = Lair.sessionForNpc(npc);
  if (!session || !roll(DATA.growthlings.chance)) return;
  const growth = state(session);
  const now = core.World.getProcessCycle();
  if (liveGrowthlings(session).length > 0 || now - growth.lastSummon < DATA.growthlings.cooldown) return;
  growth.lastSummon = now;
  for (let i = 0; i < DATA.growthlings.count; i++) {
    const tile = freeTileNear(npc, session);
    if (!tile) continue;
    const growthling = api.spawnNpc({ id: DATA.growthling, x: tile.getX(), y: tile.getY(), z: 0, wanderRadius: 0 });
    if (!growthling) continue;
    growthling.__skipDefaultRespawn = true;
    session.area.add(growthling);
    growth.growthlings.push(growthling);
    if (target?.isPlayer?.()) growthling.getCombat().attack(target);
  }
}

function defineBryophytaCombatMethod() {
  const { Animation, CombatMethod, CombatType, PendingHit, CombatFactory, Graphic, Projectile } = core;

  return class BryophytaCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.MAGIC;
    }

    type() {
      return this.stance;
    }

    attackDistance() {
      return 8;
    }

    start(character, target) {
      const adjacent = distanceFrom(character, target) <= 1;
      this.stance = adjacent && roll(2) ? CombatType.MELEE : CombatType.MAGIC;
      if (this.stance === CombatType.MELEE) {
        character.performAnimation(new Animation(DATA.anim.melee));
      } else {
        character.performAnimation(new Animation(DATA.anim.magic));
        const p = DATA.projectile;
        this.landing = 46 + 10 * Math.max(1, distanceFrom(character, target));
        Projectile.createProjectile(character, target, p.id, p.startCycle, this.landing, p.startHeight, p.endHeight)
          .withAngle(p.curve)
          .sendProjectile();
        if (target.isPlayer?.()) target.getPacketSender().sendSound(p.sound, 1, 0);
      }
      maybeSummon(character, target);
    }

    hits(character, target) {
      const melee = this.stance === CombatType.MELEE;
      const delay = melee ? 1 : Math.max(1, Math.ceil(this.landing / 30));
      const hit = new PendingHit(character, target, this, delay);
      CombatFactory.applyStyleDamage(hit, melee ? DATA.maxHit.melee : DATA.maxHit.magic);
      if (!melee && target.isPlayer?.()) {
        target.performGraphic(new Graphic(DATA.projectile.impactGraphic, this.landing, DATA.projectile.impactHeight));
        target.getPacketSender().sendSound(DATA.projectile.impactSound, 1, this.landing);
      }
      return [hit];
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      if (this.stance === CombatType.MELEE && hit.getTotalDamage?.() > 0 && target?.isPlayer?.() && roll(DATA.poison.chance)) {
        CombatFactory.poisonEntity(target, DATA.poison.damage);
      }
    }
  };
}

const zero = (hit) => {
  for (const damage of hit.getHits()) damage.setDamage(0);
  hit.updateTotalDamage();
};

/** Bryophyta can't be hurt while her growthlings live; a growthling falls to an axe at once. */
function modifyHit({ npc, hit }) {
  const id = npc?.getId?.();
  if (id === LAIR.boss) {
    const session = Lair.sessionForNpc(npc);
    if (session && liveGrowthlings(session).length > 0) zero(hit);
    return;
  }
  if (id !== DATA.growthling) return;
  const player = hit?.getAttacker?.();
  if (!player?.isPlayer?.()) return;
  if (!canPrune(player)) {
    // Without an axe or secateurs it can be hurt, never killed.
    player.sendMessage(DATA.noAxeMessage);
    let left = Math.max(0, npc.getHitpoints() - 1);
    for (const damage of hit.getHits()) {
      damage.setDamage(Math.min(damage.getDamage(), left));
      left -= damage.getDamage();
    }
    hit.updateTotalDamage();
    return;
  }
  player.sendMessage(DATA.pruneMessage);
  const hits = hit.getHits();
  for (let i = 0; i < hits.length; i++) hits[i].setDamage(i === 0 ? Math.max(1, npc.getHitpoints()) : 0);
  hit.updateTotalDamage();
}

/** The logs' bronze axe, for a player who has none; the logs grow it back. */
function takeAxe(event) {
  const logs = DATA.logs;
  if (event.objectId !== logs.withAxe) return false;
  const { player } = event;
  const session = Lair.sessionOf(player);
  if (!session || session.lair.slug !== "bryophyta") return true;
  const { DialogueChainBuilder, ItemStatementDialogue, StatementDialogue, EndDialogue, GameObject, ObjectManager, Location } = core;
  const hasAxe = [...player.getInventory().getItems(), player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]]
    .some((item) => {
      const id = item?.getId?.() ?? -1;
      if (id <= 0) return false;
      const name = core.ItemDefinition.forId(id).getName() ?? "";
      return AXE_NAME.test(name) && !NOT_AN_AXE.test(name);
    });
  const say = (dialogue) => player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(dialogue, new EndDialogue(1)));
  if (hasAxe) {
    say(new StatementDialogue(0, logs.haveAxe));
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.getInventory().full();
    return true;
  }
  player.getInventory().adds(logs.axe, 1);
  say(new ItemStatementDialogue(0, logs.axe, logs.take));
  const at = new Location(logs.x, logs.y, logs.z);
  const place = (id) => {
    const object = new GameObject(id, at, logs.type, logs.face, session.area);
    ObjectManager.register(object, true);
    session.area.add(object);
  };
  place(logs.withoutAxe);
  session.schedule(logs.returnTicks, () => place(logs.withAxe));
  return true;
}

/** Bryophyta's own combat, her growthlings and the logs' axe. */
function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  DATA = Common.data.bryophyta;
  LAIR = Common.data.lairs.bryophyta;
  pluginApi.registerNpcCombatMethodProvider([LAIR.boss], defineBryophytaCombatMethod(), { singleton: false });
  pluginApi.onNpcHitModify(modifyHit);
  pluginApi.onObjectInteraction("Logs", { "Take-axe": takeAxe });
}

module.exports = attach;
Object.assign(module.exports, { defineBryophytaCombatMethod, modifyHit, takeAxe, canPrune, maybeSummon, liveGrowthlings });
