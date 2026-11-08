const Common = require('./Common.Whisperer');
const { Fight } = require('./Fight.Whisperer');
const Travel = require('./Travel.Whisperer');
const Records = require('./Records.Whisperer');
const sessions = Common.sessions;
const RECLAIM_VARIANT = 'the-whisperer-talking-to-ketla-with-the-ring-of-visibility-reclaiming-the-blackstone-fragment';
const RECLAIM_STEP = '5mQjA2';
let AreaClass;
function areaClass() {
  if (AreaClass)
    return AreaClass;
  const { PrivateArea, Boundary } = Common.core;
  AreaClass = class WhispererCathedral extends PrivateArea {
    constructor(session) {
      const [minX, maxX, minY, maxY, plane] = Common.data.site.arena, offset = Common.data.site.realmOffset;
      super([new Boundary(minX, maxX, minY, maxY, plane), new Boundary(minX - offset, maxX - offset, minY, maxY, plane)]);
      this.session = session;
    }
    getName() {
      return 'Sunken Cathedral';
    }
    isMulti() {
      return true;
    }
    allowSummonPet() {
      return false;
    }
    canAttack(attacker, target) {
      const { player, fight } = this.session;
      if (attacker === player)
        return (!fight?.waking && target === fight?.boss) || (target?.__whispererFight === fight && target.__whispererSoul != null && fight.shadow);
      return target === player && attacker === fight?.boss;
    }
    process(mobile) {
      if (mobile === this.session.player)
        this.session.fight?.process();
    }
    postLeave(mobile, logout) {
      if (mobile === this.session.player) {
        if (logout)
          mobile.setLocation(Common.location(Common.data.site.outside));
        this.session.end();
      }
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}
class Session {
  constructor(player) {
    this.player = player;
    this.ended = false;
    this.area = new (areaClass())(this);
    this.fight = null;
    this.figure = null;
  }
  spawn(id, x, y) {
    const npc = Common.api.spawnNpc({ id, x, y, z: 0, owner: this.player, ownerOnly: true, wanderRadius: 0 });
    if (!npc)
      return null;
    npc.__skipDefaultRespawn = true;
    npc.setFlag('combat:no-regen');
    npc.setScriptedMovement(true);
    this.area.add(npc);
    return npc;
  }
  start() {
    if (this.ended || this.fight?.alive())
      return;
    const figure = this.figure;
    this.figure = null;
    const [x, y] = Common.data.site.boss;
    const npc = figure ?? this.spawn(Common.data.npcs.boss, x, y);
    if (!npc)
      return;
    npc.setNpcTransformationId(Common.data.npcs.boss);
    npc.setMaxHitpoints(900);
    npc.setHitpoints(900);
    npc.setFlag('combat:freezable', true);
    this.fight = new Fight(this, npc);
    const known = { player: this.player, monster: Common.MONSTER, total: 0 };
    Common.api.emitCustomEvent('combat-achievements:count', known);
    if (Number(known.total) > (Number(this.player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0))
      this.player.setAttribute(Common.KILLS_ATTRIBUTE, known.total);
    npc.__whispererFight = this.fight;
    this.player.getPacketSender().sendSubInterface(Common.data.sanity.helper, Common.data.sanity.interface, 1);
    this.fight.wake();
    Common.fragment(this.fight, false);
    Common.api.emitCustomEvent('boss-hud:show', { player: this.player, npcId: Common.data.npcs.boss, current: 900, maximum: 900 });
  }
  begin() {
    if (this.ended || this.starting || this.fight?.alive())
      return;
    this.player.getMovementQueue().reset();
    this.player.performAnimation(new Common.core.Animation(Common.data.animations.pickup));
    this.start();
    Common.sound(this.player, Common.data.sounds.disturb);
    this.player.getPacketSender().sendSong(Common.data.song);
  }
  respawn() {
    respawn(this);
  }
  end() {
    if (this.ended)
      return;
    this.ended = true;
    this.player.setForceMovement(null);
    sessions.delete(this.player);
    this.fight?.stop();
    this.fight = null;
    this.player.setAttribute(Common.INSIDE_ATTRIBUTE, false);
    this.player.getPacketSender().sendVarbit(Common.data.sanity.realmVarbit, 0);
    this.player.getPacketSender().closeSubInterface(Common.data.sanity.helper);
    Common.api.emitCustomEvent('boss-hud:hide', { player: this.player, fade: false, afterTicks: 0 });
    if (!this.area.isDestroyed())
      this.area.destroy();
  }
}
const sessionOf = Common.sessionOf;
function complete(player) {
  const request = { player, key: Common.data.quest, complete: false };
  Common.api.emitCustomEvent('quest:is-complete', request);
  return request.complete === true;
}
function fragments() {
  return [Common.data.items.fragmentActive, Common.data.items.fragment];
}
function hasFragment(player) {
  return fragments().some(id => player.getInventory().contains(id));
}
/** Held, or in any bank tab but the search tab: a banked fragment is owned, so Ketla doesn't give another. */
function ownsFragment(player) {
  const searchTab = Common.core.Bank.BANK_SEARCH_TAB_INDEX;
  return hasFragment(player) || (player.getBanks?.() ?? [])
    .some((bank, tab) => tab !== searchTab && fragments().some(id => bank?.contains?.(id)));
}
function disturb({ player, npc }) {
  if (npc?.getId() !== Common.data.npcs.figure && npc?.getContentId?.(player) !== Common.data.npcs.figure)
    return false;
  if (!complete(player))
    return false;
  if (!hasFragment(player)) {
    Common.objectBox(player, Common.data.items.fragment, Common.data.messages.noFragment);
    return true;
  }
  const existing = sessionOf(player);
  if (existing) {
    if (existing.figure === npc)
      existing.begin();
    return true;
  }
  const p = npc.getLocation();
  if (!Common.inBounds(Common.data.site.arena, p))
    return false;
  const session = new Session(player);
  sessions.set(player, session);
  session.area.enter(player);
  player.setAttribute(Common.INSIDE_ATTRIBUTE, true);
  session.begin();
  return true;
}
function leave({ player }) {
  const session = sessionOf(player);
  if (!session)
    return false;
  player.getMovementQueue().reset();
  player.moveTo(Common.location(Common.data.site.outside));
  session.area.leave(player, false);
  return true;
}
function fragmentAction(event) {
  const session = sessionOf(event.player);
  if (!session || !fragments().includes(event.itemId) || !['activate', 'use'].includes(String(event.option).toLowerCase()))
    return false;
  const fight = session.fight;
  if (!fight?.alive())
    return true;
  event.handled = true;
  if (fight.enraged) {
    event.player.sendMessage('You cannot leave the Shadow Realm during the Whisperer\'s final stand.');
    return true;
  }
  if (!fight.special?.switchAllowed) {
    event.player.sendMessage(Common.data.messages.unresponsive);
    return true;
  }
  fight.setShadow(!fight.shadow);
  return true;
}
function ketlaVariant({ player, npcId }) {
  const { NpcIdentifiers } = Common.core;
  if (![NpcIdentifiers.KETLA, NpcIdentifiers.KETLA_2].includes(npcId) || !complete(player) || ownsFragment(player))
    return null;
  return { page: 'Transcript:Desert Treasure II - The Fallen Empire', variant: RECLAIM_VARIANT };
}
function reclaim(event) {
  const { player, npcId, stepId } = event, { NpcIdentifiers } = Common.core;
  if (stepId !== RECLAIM_STEP || ![NpcIdentifiers.KETLA, NpcIdentifiers.KETLA_2].includes(npcId) || !complete(player))
    return;
  if (ownsFragment(player)) {
    event.handled = true;
    return;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    event.text = 'You need an inventory space for the blackstone fragment.';
    event.box = { statement: true };
    return;
  }
  player.getInventory().adds(Common.data.items.fragment, 1);
  event.box = { items: [Common.data.items.fragment] };
}
function respawn(session) {
  if (session.ended)
    return;
  session.fight?.stop();
  const [x, y] = Common.data.site.boss;
  session.figure = session.spawn(Common.data.npcs.boss, x, y);
  session.figure?.setNpcTransformationId(Common.data.npcs.figure);
  Common.api.emitCustomEvent('boss-hud:hide', { player: session.player, fade: false, afterTicks: 0 });
}
function recover({ player }) {
  if (player.getAttribute(Common.INSIDE_ATTRIBUTE) && !sessionOf(player)) {
    player.setAttribute(Common.INSIDE_ATTRIBUTE, false);
    player.moveTo(Common.location(Common.data.site.outside));
    player.getPacketSender().sendVarbit(Common.data.sanity.realmVarbit, 0);
    player.getPacketSender().closeSubInterface(Common.data.sanity.helper);
  }
}
function grave(request) {
  if (!sessionOf(request.player))
    return;
  const [x, y, z] = Common.data.site.grave;
  request.tile = { x, y, z };
  if ((Number(request.player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) < 5)
    request.feeMultiplier = .25;
}
function suppressSpawn(event) {
  const p = event.location;
  if (event.npcId === Common.data.npcs.boss && Common.inBounds(Common.data.site.arena, p))
    event.allow = false;
}
function startup() {
  const [x, y, z] = Common.data.site.boss;
  Common.api.spawnNpc({ id: Common.data.npcs.figure, x, y, z, wanderRadius: 0 });
}
function counts({ player, counts }) {
  counts[Common.MONSTER] = Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0;
}
function recordDeath({ player }) {
  const fight = sessionOf(player)?.fight;
  if (!fight?.alive() || fight.deathRecorded)
    return;
  fight.deathRecorded = true;
  Records.died(player);
}
function best(request) {
  if (request.monster === Common.MONSTER)
    request.best = Number(request.player.getAttribute(Common.BEST_ATTRIBUTE)) || 0;
}
function attach(api) {
  Travel.attach(api);
  Records.attach(api);
  api.persistAttribute(Common.INSIDE_ATTRIBUTE, false);
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BEST_ATTRIBUTE, 0);
  api.onCanSpawnNpc(suppressSpawn);
  api.onServerStartup(startup);
  api.onNpcInteraction('Odd Figure', { Disturb: disturb });
  api.onNpcDialogueVariant(ketlaVariant);
  api.onCustomEvent('npc-dialogue:action', reclaim);
  api.onObjectInteraction('Tentacle', { Escape: leave, 'Quick-escape': leave, Leave: leave });
  api.onItemAction('Blackstone fragment', { Activate: fragmentAction, Use: fragmentAction });
  api.onPlayerLogin(recover);
  api.onPlayerDeath(recordDeath);
  api.onCustomEvent('gravestones:grave-location', grave);
  api.onCustomEvent('combat-achievements:kill-count', counts);
  api.onCustomEvent('combat-achievements:personal-best', best);
}
module.exports = { attach, Session, sessionOf, disturb, leave, fragmentAction, fragments, respawn, grave, suppressSpawn, reclaim, travel: Travel.travel };
