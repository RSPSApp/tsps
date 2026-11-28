/**
 * One player's fight with a Moon (docs/moons-of-peril.md). The Moon is shared, its health is not:
 * each fighter has their own 500 hitpoints (pmoon_boss_hp and the boss HUD), their own curse
 * stacks (pmoon_boss_condition), and their own copy of a special's pieces. The Moon's NPC keeps its
 * hitpoints locked; a player's hits come off their Fight instead (onNpcHitModify).
 */
const Common = require("./Common.MoonsOfPeril");
const Curses = require("./Curses.MoonsOfPeril");

class Fight {
  constructor(arena, player) {
    this.arena = arena;
    this.moon = arena.moon;
    this.player = player;
    this.hp = Common.data.hud.maxHitpoints;
    this.condition = 0;
    this.decayTicks = 0;
    this.offGlyphDamage = 0;
    this.special = null;
    this.state = {};
    this.killed = false;
    this.ended = false;
    this.hud = false;
  }

  /** Into the arena: the HUD, the varbits the client reads, the music, and any running special. */
  begin() {
    const { player, arena } = this;
    const { hud } = Common.data;
    Common.varbit(player, "multiway", 1);
    Common.varbit(player, "hp", this.hp);
    Common.varbit(player, "inCombat", 1);
    Common.varbit(player, "focus", arena.focus());
    Common.varbit(player, "lastFocus", arena.focus());
    Common.varbit(player, "condition", 0);
    Common.varbit(player, "wearPrevent", 0);
    this.sendHideNpc();
    Common.api.emitCustomEvent("boss-hud:show", {
      player, npcId: arena.spec.npc, current: this.hp, maximum: hud.maxHitpoints,
    });
    this.hud = true;
    Common.openHud(player);
    Common.playMusic(player, Common.data.music);
    // The face update went out before they arrived: send it again for them.
    const focus = arena.glyphToFace();
    if (focus != null) Common.later(1, () => arena.faceGlyph(focus));
    const running = arena.specialFor();
    if (running?.special) this.startSpecial(running.special, running.offset);
  }

  // ------------------------------------------------------------------ the loop's calls

  setFocus(focus) {
    Common.varbit(this.player, "focus", focus);
  }

  sendHideNpc() {
    Common.varbit(this.player, "hideNpc", this.killed ? 1 : 0);
  }

  startSpecial(special, offset) {
    this.stopSpecial();
    if (!special || this.killed) return;
    this.special = special;
    this.state = {};
    special.start(this, offset);
  }

  tickSpecial(special, offset) {
    if (this.special !== special || this.killed) return;
    special.tick(this, offset);
  }

  stopSpecial() {
    const special = this.special;
    this.special = null;
    if (special) special.stop(this);
    this.state = {};
  }

  /** Every tick: a special that has ended is cleaned up, curses wear off. */
  process(where) {
    if (this.ended) return;
    if (this.special && !where.segment.special) this.stopSpecial();
    Curses.decay(this);
  }

  // ------------------------------------------------------------------ health

  /** Whether the Moon can take this player's hits right now. */
  canHit() {
    return !this.killed && !this.ended && this.arena.attackable && !this.arena.hidden;
  }

  /** The player's hit on the Moon: off their own health, shown on the HUD. */
  damage(amount) {
    if (this.killed || amount <= 0) return;
    this.setHp(this.hp - amount);
    if (this.hp <= 0) require("./Kill.MoonsOfPeril").kill(this);
  }

  /** The Moon heals (Blood Moon's thirst, Blue Moon's braziers), with the heal hitsplat. */
  heal(amount, { splat = true } = {}) {
    const value = Math.max(0, Math.floor(amount));
    if (value <= 0 || this.killed) return;
    this.setHp(this.hp + value);
    if (splat && this.arena.npc) this.arena.npc.showHitsplat(value, { mine: HEAL_SPLAT, others: HEAL_SPLAT }, this.headBar());
  }

  /** Damage the Moon does itself (no hitsplat), as captured after its attacks. */
  selfDamage(amount) {
    if (this.killed) return;
    this.setHp(Math.max(1, this.hp - Math.max(0, Math.floor(amount))));
  }

  /** A chunk of the Moon's health at once (Frost Storm), shown with a heal splat of 0 (capture). */
  drain(amount) {
    if (this.killed || amount <= 0) return;
    this.selfDamage(amount);
    this.arena.npc?.showHitsplat(0, { mine: HEAL_SPLAT, others: HEAL_SPLAT }, this.headBar());
  }

  setHp(value) {
    const max = Common.data.hud.maxHitpoints;
    this.hp = Math.max(0, Math.min(max, Math.floor(value)));
    Common.varbit(this.player, "hp", this.hp);
    if (this.hud) Common.api.emitCustomEvent("boss-hud:update", { player: this.player, current: this.hp });
  }

  /**
   * What the Moon's head bar shows with a hitsplat this player caused: their own Moon's health,
   * not the shared NPC's (always full). Set on the tick of each of their hits and heals.
   */
  headBar() {
    return { current: this.hp, max: Common.data.hud.maxHitpoints };
  }

  showHeadBar() {
    this.arena.npc?.setDisplayedHealth(this.headBar());
  }

  // ------------------------------------------------------------------ the player

  /** Typeless damage to the player (pools, storms, the off-glyph burn), landing now. */
  hurt(amount) {
    const { HitDamage, HitMask } = Common.core;
    const value = Math.max(0, Math.floor(amount));
    if (!Common.alive(this.player)) return 0;
    this.player.getCombat().getHitQueue().addPendingDamage([new HitDamage(value, value > 0 ? HitMask.RED : HitMask.BLUE)]);
    return value;
  }

  // ------------------------------------------------------------------ the end

  /** Leaving the arena any way: the HUD and the varbits go back, the special's pieces go. */
  end({ quiet = false } = {}) {
    if (this.ended) return;
    this.ended = true;
    this.stopSpecial();
    this.arena.fights.delete(this.player);
    const { player } = this;
    if (!player.isRegistered?.() && !quiet) return;
    Common.varbit(player, "multiway", 0);
    Common.varbit(player, "inCombat", 0);
    Common.varbit(player, "hp", Common.data.hud.maxHitpoints);
    Common.varbit(player, "condition", 0);
    Common.varbit(player, "hideNpc", 0);
    Common.varbit(player, "wearPrevent", 0);
    Common.closeHud(player);
    if (this.hud) {
      this.hud = false;
      Common.api.emitCustomEvent("boss-hud:hide", { player, fade: false, afterTicks: 0 });
    }
  }
}

/** The heal hitsplat (as the Phantom Muspah's and Blood Moon's captures show it). */
const HEAL_SPLAT = 6;

module.exports = { Fight };
