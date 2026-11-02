/**
 * A fight with Yama (docs/yama.md), as captured from the Challenge:
 * - at once Yama snaps his fingers on his throne (12154, spot 3278) and flames close the arena's
 *   mouth; two ticks later he appears in the arena (12156, spot 3279), facing north; three ticks
 *   after that he can be attacked, the throne empties and the boss HUD comes up.
 * - Phases 1 and 2 (Attacks.Yama, Glyphs.Yama, Hazards.Yama, Flares.Yama) end at his next attack
 *   after 66.6% and 33.3% in the Judge of Yama (Judge.Yama); phase 3 is PhaseThree.Yama.
 * - His stance follows the challenger's last style on him (Wiki): after melee he chases and his
 *   magic defence is -30; after magic or ranged he stands his ground with +60. Phase 3 has its own
 *   bonuses and keeps him in the centre.
 * - The kill (captured): 12161 with spot 3284 and the flames give way; five ticks later the
 *   success count, the fight's time and Yama back on his throne; his line at nine; at eleven
 *   the loot in front of the throne.
 */
const Common = require("./Common.Yama");
const Hits = require("./Hits.Yama");
const Attacks = require("./Attacks.Yama");
const Glyphs = require("./Glyphs.Yama");
const Hazards = require("./Hazards.Yama");
const Flares = require("./Flares.Yama");
const Judge = require("./Judge.Yama");
const PhaseThree = require("./PhaseThree.Yama");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

const SUCCESS_VARP = 4701;
const BEST_TICKS_ATTRIBUTE = "yama:best-ticks";
const BOSS_NAME = "Yama";
const LOC_SHAPE = 10;
/** Read by demonbane weapons and spells (Wiki: Yama 120%). */
const DEMONBANE_VULNERABILITY_ATTRIBUTE = "combat:demonbane-vulnerability";
const LOW_HITPOINTS_SHARE = 0.25;
const STANDING_REACH = 10;

class Fight {
  constructor(session) {
    this.session = session;
    this.player = session.player;
    this.player.__yamaHurt = false;
    this.yama = null;
    this.flames = [];
    this.tick = 0;
    this.events = [];
    this.startTick = Common.core.World.getProcessCycle();
    this.state = "summoning";
    this.phase = 1;
    this.stance = "melee";
    this.nextAttackTick = Infinity;
    this.nextSpecialTick = Infinity;
    this.pendingTransition = false;
    this.immunity = { fire: 0, shadow: 0 };
    this.glyphs = [];
    this.flares = [];
    this.waves = [];
    this.streaks = [];
    this.hazardTurn = 0;
    this.rotation = null;
    this.judge = null;
    this.loot = null;
    this.shownHp = -1;
    this.hudShown = false;
    this.over = false;
    this.stopped = false;
  }

  /** Runs `action` `ticks` ticks into the fight. */
  at(ticks, action) {
    this.events.push({ tick: this.tick + Math.max(1, ticks), action });
  }

  start() {
    const { fight } = Common.data;
    const throne = this.session.throne;
    throne?.performAnimation(new Common.core.Animation(fight.throneSummon.anim));
    throne?.performGraphic(Hits.graphic(fight.throneSummon.spot));
    this.placeFlames(fight.flames.id);
    this.at(fight.summonTicks, () => this.summon());
  }

  summon() {
    const { fight, npcs } = Common.data;
    const yama = this.session.spawn(npcs.yama, fight.yamaTile, fight.yamaFace);
    if (!yama) return;
    this.yama = yama;
    yama.__yamaFight = this;
    yama.setAttribute(DEMONBANE_VULNERABILITY_ATTRIBUTE, fight.demonbaneVulnerability);
    yama.setUntargetable(true);
    yama.performAnimation(new Common.core.Animation(fight.yamaSummon.anim));
    yama.performGraphic(Hits.graphic(fight.yamaSummon.spot));
    yama.setPositionToFace(this.player.getLocation());
    this.at(fight.attackableTicks, () => this.engage());
  }

  engage() {
    if (this.stopped || !this.yama) return;
    this.player.getPacketSender().sendVarbit(Common.data.varbits.throneState, 1);
    this.startPhase(1);
  }

  /** A phase begins: Yama attackable, the HUD, the glyphs (phases 1 and 2), his first attack. */
  startPhase(phase) {
    const { fight, attacks } = Common.data;
    if (this.stopped || !this.yama?.isRegistered()) return;
    this.phase = phase;
    this.state = "fighting";
    this.pendingTransition = false;
    this.speed = attacks.speed[String(phase)];
    this.yama.setUntargetable(false);
    this.showHud();
    const firstAttack = fight.firstAttackTicks[String(phase)];
    if (phase < 3) {
      const firstSpecial = Attacks.startRotation(this);
      this.majorGlyph = firstSpecial;
      this.hazardTurn = 0;
      this.setStance("melee");
      this.at(fight.glyphsAfterTicks, () => Glyphs.light(this, firstSpecial));
      this.nextSpecialTick = this.tick + firstAttack + this.speed;
    } else {
      this.yama.getMovementQueue().setBlockMovement(true).reset();
      this.yama.setDefenceBonusOverrides(fight.defence.phase3);
      PhaseThree.start(this, this.majorGlyph ?? "shadow");
    }
    this.nextAttackTick = this.tick + firstAttack;
    this.yama.getCombat().attack(this.player);
  }

  /** After the Judge: the next phase, from in front of the throne. */
  nextPhase() {
    if (this.stopped) return;
    this.at(Common.data.fight.phaseStartTicks.ticks, () => this.startPhase(this.phase + 1));
  }

  /** The challenger's last style on him sets his stance (phases 1 and 2). */
  setStance(stance) {
    if (!this.yama || this.phase === 3) return;
    this.stance = stance;
    this.yama.setDefenceBonusOverrides(Common.data.fight.defence[stance]);
    const movement = this.yama.getMovementQueue();
    movement.setBlockMovement(stance !== "melee");
    if (stance !== "melee") movement.reset();
  }

  /** Every tick: due events, the attack timer, the glyphs, hazards, the Judge, the HUD. */
  process() {
    if (this.stopped) return;
    this.tick++;
    // His attacks aren't the combat engine's, which would count him out of combat and
    // regenerate him (a tenth of his hitpoints a tick).
    if (this.yama?.isRegistered()) this.yama.getCombat().getLastAttack().reset();
    const due = this.events.filter((event) => event.tick <= this.tick);
    this.events = this.events.filter((event) => event.tick > this.tick);
    for (const event of due) if (!this.stopped) event.action();
    if (this.stopped) return;
    if (this.state === "fighting") this.fightTick();
    if (this.phase < 3 && this.state === "fighting") Glyphs.process(this);
    Hazards.process(this);
    Judge.process(this);
    this.updateHud();
  }

  fightTick() {
    const yama = this.yama;
    if (!yama?.isRegistered() || yama.getHitpoints() <= 0) return;
    // He keeps facing the challenger (as captured), whichever way the combat engine left him.
    if (yama.getInteractingMobile?.() !== this.player) yama.setMobileInteraction(this.player);
    const { thresholds } = Common.data.fight;
    if (this.phase < 3 && !this.pendingTransition && yama.getHitpoints() <= thresholds[this.phase - 1]) {
      this.pendingTransition = true;
    }
    if (this.phase < 3 && this.tick === this.nextSpecialTick - this.hazardLead()) this.hazard();
    if (this.tick < this.nextAttackTick) return;
    this.nextAttackTick = this.tick + this.speed;
    if (this.pendingTransition) {
      Judge.begin(this);
      return;
    }
    if (this.phase === 3) {
      PhaseThree.beat(this);
      return;
    }
    const specialsBefore = this.rotation.specials;
    Attacks.attack(this);
    if (this.rotation.specials > specialsBefore) this.nextSpecialTick = this.tick + this.speed * 4;
  }

  /** The hazard before a special (none before the phase's first): a wave, then streaks, in turn. */
  hazardLead() {
    if (!this.rotation || this.rotation.specials === 0) return Infinity;
    const { wave, streak } = Common.data.hazards;
    return this.hazardTurn % 2 === 0 ? wave.leadTicks : streak.leadTicks;
  }

  hazard() {
    const { streak } = Common.data.hazards;
    if (this.hazardTurn++ % 2 === 0) {
      const first = Math.random() < 0.5 ? "southEast" : "southWest";
      Hazards.wave(this, first);
      if (this.phase === 2) Hazards.wave(this, first === "southEast" ? "southWest" : "southEast");
    } else {
      Hazards.streaks(this, streak.rows[String(this.phase)]);
    }
  }

  showHud() {
    this.hudShown = true;
    this.shownHp = this.yama.getHitpoints();
    Common.api.emitCustomEvent("boss-hud:show", {
      player: this.player, npcId: Common.data.npcs.yama, current: this.shownHp, maximum: Common.data.fight.hp,
    });
  }

  updateHud() {
    if (!this.hudShown || !this.yama) return;
    const hp = Math.max(0, this.yama.getHitpoints());
    if (hp === this.shownHp) return;
    this.shownHp = hp;
    Common.api.emitCustomEvent("boss-hud:update", { player: this.player, current: hp });
  }

  hideHud(fade = true) {
    if (!this.hudShown) return;
    this.hudShown = false;
    Common.api.emitCustomEvent("boss-hud:hide", fade ? { player: this.player } : { player: this.player, fade: false, afterTicks: 0 });
  }

  placeFlames(id) {
    const { GameObject, ObjectManager } = Common.core;
    for (const object of this.flames) ObjectManager.deregister(object, false);
    this.flames = Common.data.fight.flames.tiles.map(([x, y, z, rotation]) => {
      const object = new GameObject(id, this.session.tile([x, y, z]), LOC_SHAPE, rotation, this.session.area);
      ObjectManager.register(object, true);
      return object;
    });
  }

  // ------------------------------------------------------------------ the kill

  /** Yama falls (his death starting): the kill's captured timeline. */
  won() {
    if (this.over) return;
    this.over = true;
    this.state = "over";
    const { kill, varbits } = Common.data;
    const { player } = this;
    const sender = player.getPacketSender();
    this.yama.performGraphic(Hits.graphic(kill.spot));
    Flares.clear(this);
    Hazards.clear(this);
    this.placeFlames(Common.data.fight.flames.open);
    const ticks = Common.core.World.getProcessCycle() - this.startTick;
    this.at(kill.throneTicks, () => {
      sender.sendVarbit(varbits.throneState, 0);
      this.count(ticks);
      const throne = this.session.throne;
      throne?.performAnimation(new Common.core.Animation(kill.throneAnim));
      throne?.performGraphic(Hits.graphic(kill.throneSpot));
      sender.sendJingle(kill.jingle, 0);
    });
    this.at(kill.lineTicks, () => {
      const low = player.getHitpoints() <= player.getSkillManager().getMaxLevel(Common.core.Skill.HITPOINTS) * LOW_HITPOINTS_SHARE;
      const moment = !player.__yamaHurt ? "defeatPerfect" : low ? "defeatLow" : "defeat";
      const lines = Common.data.overheads[moment];
      this.session.throne?.forceChat(lines[Math.floor(Math.random() * lines.length)]);
    });
    this.at(kill.lootTicks, () => {
      this.dropLoot();
      this.hideHud();
      this.stopped = true;
      this.session.fight = null;
    });
  }

  count(ticks) {
    const { player } = this;
    const successes = Common.count(player, Common.SUCCESS_COUNT_ATTRIBUTE) + 1;
    player.setAttribute(Common.SUCCESS_COUNT_ATTRIBUTE, successes);
    player.setAttribute(Common.LAST_RESULT_ATTRIBUTE, "victorious");
    player.getPacketSender().sendConfig(SUCCESS_VARP, successes);
    player.sendMessage(`Your Yama success count is: <col=ff0000>${successes}</col>.`);
    const best = Common.count(player, BEST_TICKS_ATTRIBUTE);
    if (!best || ticks < best) {
      player.setAttribute(BEST_TICKS_ATTRIBUTE, ticks);
      Common.api.emitCustomEvent("boss:personal-best", { player, boss: BOSS_NAME, ticks });
      player.sendMessage(`Fight duration: <col=ff0000>${formatTicks(ticks)}</col> (new personal best)`);
    } else {
      player.sendMessage(`Fight duration: <col=ff0000>${formatTicks(ticks)}</col>. Personal best: ${formatTicks(best)}`);
    }
  }

  /** The kill's loot, rolled by NpcDrops on his death and held for this moment (as captured). */
  dropLoot() {
    const drops = this.loot ?? [];
    this.loot = null;
    if (drops.length === 0) return;
    const { Item, ItemDefinition } = Common.core;
    const { kill } = Common.data;
    const manager = Common.api.getItemOnGroundManager();
    const where = this.session.tile(kill.lootTile);
    Hits.sound(this.player, kill.lootSound);
    for (const drop of drops) {
      if (!Number.isInteger(drop.itemId) || drop.amount <= 0) continue;
      const noteId = ItemDefinition.forId(drop.itemId).getNoteId();
      const itemId = drop.noted && noteId >= 0 && ItemDefinition.forId(noteId).isNoted() ? noteId : drop.itemId;
      if (ItemDefinition.forId(itemId).isStackable()) {
        manager.registerLocation(this.player, new Item(itemId, drop.amount), where, this.session.area);
      } else {
        for (let i = 0; i < drop.amount; i++) manager.registerLocation(this.player, new Item(itemId, 1), where, this.session.area);
      }
    }
  }

  /** The player flees through the flames: an escape, and Yama back on his throne. */
  flee() {
    if (this.stopped || this.over) return;
    this.player.setAttribute(Common.LAST_RESULT_ATTRIBUTE, "escaped");
    this.player.getPacketSender().sendVarbit(Common.data.varbits.throneState, 0);
    this.placeFlames(Common.data.fight.flames.open);
    Glyphs.clear(this);
    this.stop();
    this.session.fight = null;
  }

  /** The fight ends without a kill (death, escape, the domain closing). */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.events = [];
    Flares.clear(this);
    Hazards.clear(this);
    if (this.judge?.npc?.isRegistered?.()) Common.api.removeNpc(this.judge.npc);
    for (const surge of this.judge?.surges ?? []) if (surge.npc.isRegistered()) Common.api.removeNpc(surge.npc);
    if (this.player.isRegistered?.()) this.hideHud(false);
    if (this.yama && this.yama.isRegistered?.()) Common.api.removeNpc(this.yama);
    this.yama = null;
  }
}

/** A fight's length as Yama's messages print it: m:ss. */
function formatTicks(ticks) {
  const seconds = Math.round(ticks * 0.6);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Starts the session's fight and runs it on its own tick task. */
function challenge(session) {
  if (session.fight || session.ended) return;
  const fight = new Fight(session);
  session.fight = fight;
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      if (fight.stopped || session.ended) {
        this.stop();
        return;
      }
      fight.process();
    }
  })());
  fight.start();
}

// ------------------------------------------------------------------ hooks

/** Yama's combat: the fight times his attacks; the engine only walks him after a melee user. */
function combatClass() {
  const { CombatMethod, CombatType } = Common.core;
  return class YamaCombat extends CombatMethod {
    start() {}

    hits() {
      return [];
    }

    attackSpeed() {
      return 1;
    }

    attackDistance(npc) {
      const fight = npc?.__yamaFight;
      return fight && fight.phase < 3 && fight.stance === "melee" ? 1 : STANDING_REACH;
    }

    type() {
      return CombatType.MELEE;
    }
  };
}

function onYamaDeathStart(event) {
  const fight = event.npc?.__yamaFight;
  if (!fight || fight.stopped || fight.over) return;
  fight.won();
}

/** The challenger's style on Yama sets his stance (Wiki). */
function onYamaHit({ npc, hit }) {
  const fight = npc?.__yamaFight;
  if (!fight || fight.phase === 3 || !hit?.getAttacker?.()?.isPlayer?.()) return;
  const stance = hit.getCombatType?.() === Common.core.CombatType.MELEE ? "melee" : "magic";
  if (stance !== fight.stance) fight.setStance(stance);
}

/** Holds the kill's loot for the moment it lands in front of the throne. */
function holdLoot(event) {
  const fight = event.npc?.__yamaFight;
  if (event.npcId !== Common.data.npcs.yama || !fight) return;
  fight.loot = [...(event.drops ?? [])];
  event.handled = true;
}

/** The flames during a fight: through them to the south side, fleeing it. */
function passFlames({ player, object, objectId }, ask) {
  const fight = require("./Domain.Yama").sessionOf(player)?.fight;
  if (objectId !== Common.data.fight.flames.id || !fight || fight.stopped || fight.over) return false;
  const { flee } = Common.data.fight.flames;
  const go = () => {
    const at = object.getLocation();
    const [x, y] = fight.session.worldTile(at);
    const through = [fight.session.tile([x, y, 0]), fight.session.tile([x, y - 1, 0])].map((t) => [t.getX(), t.getY()]);
    fight.flee();
    ObstacleRunner.run({ player }, [{ walk: through }]);
  };
  if (!ask) {
    go();
    return true;
  }
  Common.api.sendMultiChatboxPrompt(player, flee.question, flee.yes, () => {
    player.getPacketSender().sendInterfaceRemoval();
    go();
  }, flee.no, () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

const pass = (event) => passFlames(event, true);
const quickPass = (event) => passFlames(event, false);

function sendSuccessCount({ player }) {
  const successes = Common.count(player, Common.SUCCESS_COUNT_ATTRIBUTE);
  if (successes > 0) player.getPacketSender().sendConfig(SUCCESS_VARP, successes);
}

function attachFight(api) {
  api.persistAttribute(Common.SUCCESS_COUNT_ATTRIBUTE);
  api.persistAttribute(BEST_TICKS_ATTRIBUTE);
  api.registerNpcCombatMethodProvider(Common.data.npcs.yama, combatClass());
  api.onNpcBeforeDeath(onYamaDeathStart);
  api.onNpcHitModify(onYamaHit);
  api.onCustomEvent("npc-drops:generated", holdLoot);
  api.onPlayerLogin(sendSuccessCount);
  api.onObjectInteraction("Flames", { Pass: pass, "Quick Pass": quickPass });
}

module.exports = { attachFight, challenge, formatTicks };
