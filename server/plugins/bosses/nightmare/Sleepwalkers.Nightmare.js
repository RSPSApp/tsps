/**
 * Sleepwalkers, as captured: two ticks after she takes her blast form, the message and sleepwalkers
 * rising by the totems, walking to her from their fourth tick; one that reaches her is absorbed.
 * She blasts once the last of them is gone: a tick after the last one's death animation, or three
 * after the last one is absorbed (it's removed two ticks after that animation) - 9 to 16 ticks after
 * they rise (rsprox 3350, 14 of 14 phases; 1875 14700, 16978). The blast lands on everyone two ticks
 * after its graphic, and nine ticks after her animation she restores her shield.
 *
 * Any damage kills one (they have 10 hitpoints; Phosani's always take a max hit, Wiki). The blast
 * does 5 if none reached her, and 144 more spread over the ones that did (Wiki's table; with every
 * one absorbed it always kills). The Nightmare sends one per player in the dream (up to 24),
 * Phosani's two, three, then four. In Phosani's desperation phase they come one at a time, every
 * 8 ticks (rsprox 1148 7173-7197, 559 19679-19695), and do 15 each.
 */
const Common = require("./Common.Nightmare");

const MAX = 24;

function howMany(fight) {
  if (fight.phosani) return Common.data.sleepwalkers.phosaniCounts[fight.phase - 1] ?? 4;
  return Math.max(1, Math.min(MAX, fight.players().length));
}

function rise(fight, tile, desperate = false) {
  const { sleepwalkers, npcs } = Common.data;
  const id = fight.phosani ? npcs.phosani.sleepwalker : Common.pick(npcs.sleepwalkers);
  const npc = fight.dream.spawn(id, [...tile, Common.data.arena.plane]);
  if (!npc) return null;
  npc.__nightmareFight = fight;
  npc.__nightmareWalker = { walkAt: fight.tick + sleepwalkers.walkTicks, desperate };
  npc.performAnimation(Common.animation(sleepwalkers.spawnAnim));
  npc.setScriptedMovement?.(true);
  fight.walkers.push(npc);
  return npc;
}

/** Her blast form: the sleepwalkers come, she blasts, then `done` (her next phase). */
function summon(fight, done) {
  const { sleepwalkers, fight: messages } = Common.data;
  const state = { spawned: 0, absorbed: 0, risen: false, blasted: false, readyAt: 0, done };
  fight.sleepwalkState = state;
  fight.at(sleepwalkers.spawnTicks, () => {
    const players = fight.players();
    for (const player of players) {
      player.sendMessage(messages.messages.charging);
      Common.sounds(player, [sleepwalkers.spawnSound]);
    }
    const tiles = Common.shuffled(sleepwalkers.tiles);
    const total = howMany(fight);
    for (let i = 0; i < total; i++) if (rise(fight, tiles[i % tiles.length])) state.spawned++;
    state.risen = true;
    state.readyAt = fight.tick + 1;
    // Should one never reach her nor die, she takes them all in at the latest captured blast.
    fight.at(sleepwalkers.latestBlastTicks, () => {
      if (fight.sleepwalkState !== state || state.blasted) return;
      for (const npc of fight.walkers.filter((walker) => !walker.__nightmareWalker?.desperate)) absorb(fight, npc);
    });
  });
}

/** The last sleepwalker gone: her blast, then her shield nine ticks after it. */
function blastWhenClear(fight) {
  const state = fight.sleepwalkState;
  if (!state || !state.risen || state.blasted || fight.stopped) return;
  if (fight.walkers.some((npc) => !npc.__nightmareWalker?.desperate) || fight.tick < state.readyAt) return;
  state.blasted = true;
  blast(fight, state);
  const { sleepwalkers, fight: messages } = Common.data;
  fight.at(sleepwalkers.restoreTicks, () => {
    if (fight.stopped || fight.sleepwalkState !== state) return;
    fight.sleepwalkState = null;
    const last = fight.phase >= fight.phaseCount;
    if (!last) for (const player of fight.players()) player.sendMessage(messages.messages.restores);
    state.done();
  });
}

/** One left the walk: the blast waits a tick after a death animation, three after an absorb. */
function gone(fight, npc, ticks) {
  fight.walkers = fight.walkers.filter((other) => other !== npc);
  const state = fight.sleepwalkState;
  if (state && !npc.__nightmareWalker?.desperate) state.readyAt = Math.max(state.readyAt, fight.tick + ticks);
}

function blast(fight, state) {
  if (fight.stopped) return;
  const { sleepwalkers } = Common.data;
  fight.boss.performAnimation(Common.animation(sleepwalkers.blastAnim));
  for (const player of fight.players()) Common.sounds(player, sleepwalkers.blastSounds);
  const absorbed = state.absorbed;
  const spawned = Math.max(1, state.spawned);
  fight.at(sleepwalkers.impactTicks, () => {
    for (const player of fight.players()) {
      player.performGraphic(Common.graphic(sleepwalkers.impact));
      Common.sounds(player, [sleepwalkers.impactSound]);
    }
  });
  fight.at(sleepwalkers.impactTicks + sleepwalkers.hitTicks, () => {
    for (const player of fight.players()) Common.damage(player, blastDamage(absorbed, spawned), fight, true);
  });
}

/** The blast: 5, and 144 more spread over the sleepwalkers that reached her (Wiki's table). */
function blastDamage(absorbed, spawned) {
  const { minDamage, fullDamage } = Common.data.sleepwalkers;
  return minDamage + Math.floor((fullDamage * absorbed) / Math.max(1, spawned));
}

/** One reached her: absorbed, gone two ticks later. */
function absorb(fight, npc) {
  if (!npc.isRegistered() || npc.getHitpoints() <= 0) {
    gone(fight, npc, 1);
    return;
  }
  gone(fight, npc, Common.data.sleepwalkers.absorbBlastTicks);
  npc.performAnimation(Common.animation(Common.data.sleepwalkers.absorbAnim));
  const desperate = npc.__nightmareWalker?.desperate;
  require("./CombatAchievements.Nightmare").sleepwalkerReached(fight, desperate === true);
  if (fight.sleepwalkState && !desperate) fight.sleepwalkState.absorbed++;
  if (desperate) {
    const { desperation } = Common.data.sleepwalkers;
    for (const player of fight.players()) Common.damage(player, desperation.damage, fight);
  }
  fight.at(2, () => npc.isRegistered() && Common.api.removeNpc(npc));
}

/** They walk a tile a tick to her, and she takes in any that reach her. */
function process(fight) {
  if (fight.walkers.length === 0) {
    blastWhenClear(fight);
    return;
  }
  const body = require("./Attacks.Nightmare").bodyBounds(fight.boss);
  for (const npc of [...fight.walkers]) {
    const walker = npc.__nightmareWalker;
    if (!npc.isRegistered() || npc.getHitpoints() <= 0) {
      gone(fight, npc, 1);
      continue;
    }
    if (fight.tick < walker.walkAt) continue;
    const at = npc.getLocation();
    const x = at.getX();
    const y = at.getY();
    if (x >= body.minX - 1 && x <= body.maxX + 1 && y >= body.minY - 1 && y <= body.maxY + 1) {
      absorb(fight, npc);
      continue;
    }
    const dx = x < body.minX ? 1 : x > body.maxX ? -1 : 0;
    const dy = y < body.minY ? 1 : y > body.maxY ? -1 : 0;
    npc.getMovementQueue().walkStep(dx, dy);
  }
  blastWhenClear(fight);
}

/** Phosani's desperation: one at a time from the edges, every 8 ticks. */
function desperation(fight) {
  const { sleepwalkers } = Common.data;
  const next = () => {
    if (fight.stopped || fight.stage !== "desperate") return;
    rise(fight, Common.pick(sleepwalkers.tiles), true);
    fight.at(sleepwalkers.desperation.every, next);
  };
  fight.at(2, next);
}

function clear(fight) {
  for (const npc of fight.walkers) if (npc.isRegistered()) Common.api.removeNpc(npc);
  fight.walkers = [];
  fight.sleepwalkState = null;
}

/** Any hit kills one (Phosani's always take a max hit, Wiki). */
function rollOnWalker(event) {
  const fight = event.target?.__nightmareFight;
  if (!fight || !event.target.__nightmareWalker) return;
  event.forceAccurate = true;
  if (fight.phosani) event.forceMaxHit = true;
}

function modifyWalkerHit({ npc, hit }) {
  if (!npc?.__nightmareWalker) return;
  if (hit.getTotalDamage() <= 0 && !npc.__nightmareFight?.phosani) return;
  const [first, ...rest] = hit.getHits();
  if (first) first.setDamage(Math.max(first.getDamage(), npc.getHitpoints()));
  for (const part of rest) part.setDamage(0);
  hit.updateTotalDamage();
}

function walkerDied({ npc }) {
  const fight = npc?.__nightmareFight;
  if (fight && npc.__nightmareWalker && fight.walkers.includes(npc)) gone(fight, npc, 1);
}

function attachSleepwalkers(api) {
  api.onCombatHitRoll(rollOnWalker);
  api.onNpcHitModify(modifyWalkerHit);
  api.onNpcDeath(walkerDied);
}

module.exports = { summon, process, desperation, clear, attachSleepwalkers, blastDamage, howMany };
