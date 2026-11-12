const Common = require('./Common.Whisperer');

/** A spam line (filterable), as these are in the recordings. */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(Common.core.ChatType.SPAM, text);
}
const centre = fight => [Common.data.site.boss[0] - (fight.shadow ? Common.data.site.realmOffset : 0), Common.data.site.boss[1]];
/** Tile-grid transcription of the four route diagrams on the Wiki strategy page.
 * The first layout's camera is rotated: transform its diagonal grid into world tiles.
 * Normal capture3285 corroborates every tile/color of all four Wiki patterns. */
function seedLayout(pattern) {
  if (pattern < 2) {
    const grid = [[0, 0], [1, -1], [2, -2], [0, 1], [1, 0], [0, 2], [1, 1], [2, 0], [4, -2], [1, 2], [1, 3], [2, 2], [4, 0], [5, -1], [5, 0], [2, 4], [4, 2], [5, 1], [6, 0], [5, 2], [6, 1], [4, 4], [5, 3], [6, 2]];
    const light = new Set(pattern === 0 ? [0, 2, 5, 7, 8, 11, 12, 15, 16, 18, 21, 23] : [0, 1, 2, 5, 7, 8, 10, 11, 12, 13, 15, 16, 18, 21, 22, 23]);
    return grid.map(([x, y], index) => ({ dx: (x - 3) - (y - 1), dy: (x - 3) + (y - 1), light: light.has(index) }));
  }
  const seeds = [];
  for (const y of [-6, -4, 4, 6])
    for (const x of [-1, 0, 1])
      seeds.push({ dx: x, dy: y, light: x !== 0 && (Math.abs(y) === 4 || pattern === 3) });
  for (const y of [-2, 2])
    for (const x of [-5, -3, 3, 5])
      seeds.push({ dx: x, dy: y, light: Math.abs(x) === 3 || pattern === 2 });
  for (const x of [-6, -5, -4, -3, 3, 4, 5, 6])
    seeds.push({ dx: x, dy: 0, light: Math.abs(x) === 5 });
  return seeds;
}
function start(fight, kind) {
  clear(fight);
  fight.special = { kind, age: 0, active: false, switchAllowed: false };
  if (fight.boss.getNpcTransformationId() === Common.data.npcs.melee)
    fight.boss.setNpcTransformationId(Common.data.npcs.boss);
  fight.boss.performAnimation(new Common.core.Animation(Common.data.animations.teleport));
  Common.fragment(fight, false);
}
function activate(fight, kind) {
  const [x, y] = centre(fight);
  Object.assign(fight.special, { active: true, switchAllowed: true, left: kind === 'souls' ? 17 : kind === 'seeds' ? 40 : 12 });
  if (kind === 'seeds') {
    const pattern = Common.random(0, 3);
    fight.special.seeds = seedLayout(pattern).map(({ dx, dy, light }) => ({ x: x + 1 + dx, y: y + 1 + dy, light, active: true, materialX: x + 1 + dx + (fight.shadow ? Common.data.site.realmOffset : 0), object: null }));
    fight.special.clean = true;
  }
  else if (kind === 'screech') {
    fight.special.blasts = 3;
    const health = Array(8).fill(20), strongest = Common.random(0, 7);
    health[strongest] = 60;
    health[strongest === 7 ? 6 : strongest + 1] = 40;
    for (let i = 0; i < Common.random(0, 2); i++) {
      const candidates = health.flatMap((hp, index) => hp === 20 ? [index] : []);
      health[candidates[Common.random(0, candidates.length - 1)]] = 40;
    }
    fight.special.columns = Common.data.specials.columns.map(([columnX, columnY], index) => {
      const hp = health[index];
      const worldX = columnX - (fight.shadow ? Common.data.site.realmOffset : 0);
      const npc = fight.session.spawn(Common.data.npcs.column, worldX, columnY);
      npc.setMaxHitpoints(60);
      npc.setHitpoints(hp);
      return { materialX: columnX, x: worldX, y: columnY, hp, active: true, npc };
    });
  }
  else {
    fight.special.souls = [];
    fight.special.rewarded = new Set();
    const groups = Common.data.soulSets.flatMap((set, group) => Array(set.size).fill(group));
    for (let index = groups.length - 1; index > 0; index--) {
      const other = Common.random(0, index);
      [groups[index], groups[other]] = [groups[other], groups[index]];
    }
    Common.data.specials.souls.forEach(([soulX, soulY], index) => {
      const group = groups[index];
      const npc = fight.session.spawn(Common.data.npcs.soul, soulX - (fight.shadow ? Common.data.site.realmOffset : 0), soulY);
      npc.setMaxHitpoints(1);
      npc.setHitpoints(1);
      npc.__whispererFight = fight;
      npc.__whispererSoul = group;
      fight.special.souls.push({ npc, group, materialX: soulX, dead: false });
    });
  }
  fight.player.sendMessage(Common.data.messages[kind]);
  fight.player.sendMessage(Common.data.messages.pulse);
  Common.sound(fight.player, Common.data.sounds.pulse);
  Common.fragment(fight, true);
  render(fight);
}
function render(fight) {
  const special = fight.special;
  if (!special?.active)
    return;
  if (special.kind === 'seeds')
    for (const seed of special.seeds) {
      if (seed.object)
        fight.player.getPacketSender().sendObjectRemoval(seed.object);
      seed.x = seed.materialX - (fight.shadow ? Common.data.site.realmOffset : 0);
      if (!seed.active)
        continue;
      const id = fight.shadow ? (seed.light ? Common.data.objects.seedLight : Common.data.objects.seedDark) : Common.data.objects.seedReal;
      seed.object = new Common.core.GameObject(id, new Common.core.Location(seed.x, seed.y, 0), 22, 0, fight.session.area);
      fight.player.getPacketSender().sendObject(seed.object);
    }
  if (special.kind === 'screech')
    for (const column of special.columns) {
      if (!column.active)
        continue;
      const x = column.materialX - (fight.shadow ? Common.data.site.realmOffset : 0);
      column.x = x;
      column.npc.moveTo(new Common.core.Location(x, column.y, 0));
      column.npc.setNpcTransformationId(fight.shadow ? Common.data.npcs.columnShadow : Common.data.npcs.column);
      columnHealth(fight, column);
    }
  if (special.kind === 'souls')
    for (const soul of special.souls) {
      if (soul.dead)
        continue;
      const p = soul.npc.getLocation(), x = soul.materialX - (fight.shadow ? Common.data.site.realmOffset : 0);
      soul.npc.moveTo(new Common.core.Location(x, p.getY(), 0));
      soul.npc.setNpcTransformationId(fight.shadow ? Common.data.npcs.soulShadow : Common.data.npcs.soul);
      if (fight.shadow)
        soul.npc.forceChat(Common.data.soulSets[soul.group].phrase);
    }
}
function columnHealth(fight, column) {
  const bar = Common.data.specials.columnHeadbar;
  if (fight.shadow)
    column.npc.showHeadbar(bar.id, { fill: Math.ceil(column.hp * bar.width / bar.maximum) });
  else
    column.npc.removeHeadbar(bar.id);
}
function finish(fight, result) {
  // Recorded: the depletion (58) and both "deter" lines are spam; "Leeches from the shadows hatch..." is a game message.
  spam(fight.player, Common.data.messages.deplete);
  if (result === "seedsPerfect" || result === "seedsDone")
    spam(fight.player, Common.data.messages[result]);
  else if (result)
    fight.player.sendMessage(Common.data.messages[result]);
  clear(fight);
  fight.completed++;
  fight.nextAttack = fight.tick + 15;
  fight.setShadow(false);
  // A crossed health threshold replaces the bind with the next special.
  if (fight.startedSpecials < 3 && fight.boss.getHitpoints() <= Common.data.thresholds[fight.startedSpecials]) {
    fight.nextAttack = fight.tick;
    return;
  }
  fight.bind();
}
function screechWave(fight, special) {
  const { Graphic, Location, Projectile } = Common.core;
  const origin = Projectile.centreOf(fight.boss);
  // Native water fills this cathedral footprint except the standing columns'
  // footprints and their 2x2 cover. All 21 normal captured waves agree.
  for (const [dy, minimum, maximum] of Common.data.specials.screechWaveRows)
    for (let dx = minimum; dx <= maximum; dx++) {
      const x = origin.getX() + dx, y = origin.getY() + dy;
      if (special.columns.some(c => c.active && x >= c.x && x < c.x + 2 && y >= c.y && y < c.y + 4))
        continue;
      const graphic = new Graphic(Common.data.graphics.screechWater);
      // Set the public delay explicitly: the overloaded constructor treats
      // a delay of 50 as GraphicHeight.MIDDLE instead.
      graphic.delay = Math.max(5, 5 + 3 * (Math.abs(dx) + Math.abs(dy) - 2));
      fight.player.getPacketSender().sendGraphic(graphic, new Location(x, y, 0));
    }
}
function screechImpact(fight, special) {
  const pending = special.pendingBlast;
  for (const column of special.columns)
    if (column.removeAt === special.age) {
      Common.remove(column.npc);
      delete column.removeAt;
    }
  if (special.finishAt === special.age) {
    finish(fight);
    return true;
  }
  if (!pending)
    return false;
  if (special.age === pending.castAge + 1 && pending.cover) {
    const { Projectile, Location } = Common.core, geometry = Common.data.specials.screechProjectile;
    fight.player.getPacketSender().sendProjectile(Projectile.centreOf(fight.boss), new Location(pending.cover.x, pending.cover.y, 0), 0, geometry.cycles, Common.data.projectiles.screech, geometry.startHeight, geometry.endHeight, 0, 0, geometry.angle, geometry.progress);
  }
  if (special.age !== pending.castAge + 2)
    return false;
  if (!pending.cover)
    Common.damage(fight, 45, 45);
  for (const column of special.columns)
    if (column.active) {
      column.hp -= 20;
      column.npc.setHitpoints(Math.max(0, column.hp));
      column.npc.addTickHit(new Common.core.HitDamage(20, Common.core.HitMask.RED));
      if (column === pending.cover || column.hp <= 0) {
        column.active = false;
        column.removeAt = special.age + 1;
      }
      if (fight.shadow)
        columnHealth(fight, column);
    }
  special.pendingBlast = null;
  if (!special.blasts)
    special.finishAt = special.age + 1;
  return false;
}
function process(fight) {
  const special = fight.special;
  if (!special)
    return;
  special.age++;
  const animate = id => fight.boss.performAnimation(new Common.core.Animation(id));
  if (special.age === 1) {
    const [x, y] = centre(fight);
    fight.boss.moveTo(new Common.core.Location(x, special.kind === 'screech' ? Common.data.specials.screechY : y, 0));
    animate(special.kind === 'souls' ? Common.data.animations.souls : Common.data.animations.appear);
  }
  if (special.age === 3)
    animate(special.kind === 'souls' ? Common.data.animations.soulChant : special.kind === 'seeds' ? Common.data.animations.seeds : Common.data.animations.screech);
  if (special.kind === 'seeds' && special.age === 8)
    animate(Common.data.animations.screech);
  if (special.kind === 'seeds' && special.age === 10)
    animate(Common.data.animations.screechHold);
  if (!special.active) {
    if (special.age === { seeds: 6, screech: 5, souls: 4 }[special.kind]) {
      activate(fight, special.kind);
      if (special.kind === 'screech')
        animate(Common.data.animations.screechHold);
    }
    return;
  }
  if (special.kind === 'screech' && special.age === 14) {
    special.switchAllowed = false;
    Common.fragment(fight, false);
  }
  if (special.kind === 'screech' && [21, 27].includes(special.age))
    animate(Common.data.animations.screech);
  if (special.kind === 'screech' && fight.shadow)
    for (const column of special.columns)
      if (column.active)
        columnHealth(fight, column);
  if (special.kind === 'screech' && screechImpact(fight, special))
    return;
  special.left--;
  if (special.kind === 'seeds') {
    const p = fight.player.getLocation();
    const run = fight.player.getRunningDirection();
    const tiles = run.getId() >= 0 ? [[p.getX() - run.getX(), p.getY() - run.getY()], [p.getX(), p.getY()]] : [[p.getX(), p.getY()]];
    for (const [x, y] of tiles) {
      const seed = special.seeds.find(s => s.active && s.x === x && s.y === y);
      if (!seed)
        continue;
      seed.active = false;
      if (seed.object)
        fight.player.getPacketSender().sendObjectRemoval(seed.object);
      if (!seed.light) {
        special.clean = false;
        Common.damage(fight, Common.random(15, 25));
      }
      if (special.seeds.every(s => !s.light || !s.active)) {
        if (special.clean)
          fight.changeSanity(15);
        finish(fight, special.clean ? 'seedsPerfect' : 'seedsDone');
        return;
      }
    }
    if (special.left <= 0) {
      Common.damage(fight, 75, 75);
      finish(fight, 'seedsFailed');
    }
  }
  else if (special.kind === 'screech' && special.left <= 0) {
    animate(Common.data.animations.screechBlast);
    fight.boss.performGraphic(new Common.core.Graphic(Common.data.graphics.screech, 0, 125));
    screechWave(fight, special);
    const p = fight.player.getLocation();
    // Boss is south: cover consists of the 2x2 immediately north of a 2x2 column.
    const cover = special.columns.find(c => c.active && p.getX() >= c.x && p.getX() < c.x + 2 && p.getY() >= c.y + 2 && p.getY() < c.y + 4);
    special.pendingBlast = { castAge: special.age, cover };
    special.left = --special.blasts ? 6 : Infinity;
  }
  else if (special.kind === 'souls') {
    if (fight.shadow && special.left % 4 === 0)
      for (const soul of special.souls)
        if (!soul.dead)
          soul.npc.forceChat(Common.data.soulSets[soul.group].phrase);
    if (special.left <= 0) {
      animate(Common.data.animations.soulResolve);
      if (special.rewarded.size === 0) {
        Common.damage(fight, 50);
        fight.boss.heal(100);
      }
      finish(fight, special.rewarded.size ? 'soulsPartial' : 'soulsFailed');
    }
  }
}
function soulDied(fight, npc) {
  const special = fight.special;
  if (!special?.active || special.kind !== 'souls')
    return;
  const soul = special.souls.find(s => s.npc === npc);
  if (!soul || soul.dead)
    return;
  soul.dead = true;
  const group = soul.group;
  if (special.souls.some(s => s.group === group && !s.dead) || special.rewarded.has(group))
    return;
  special.rewarded.add(group);
  const player = fight.player, skills = player.getSkillManager(), { Skill } = Common.core;
  if (group === 0)
    player.heal(Math.floor(skills.getMaxLevel(Skill.HITPOINTS) * .2));
  else if (group === 1)
    skills.setCurrentLevel(Skill.PRAYER, Math.min(skills.getMaxLevel(Skill.PRAYER), skills.getCurrentLevel(Skill.PRAYER) + Math.floor(skills.getMaxLevel(Skill.PRAYER) * .2)), true);
  else if (group === 2)
    fight.changeSanity(15);
  else
    hurtBoss(fight, 50);
  if (special.souls.every(s => s.dead)) {
    hurtBoss(fight, 25);
    finish(fight, 'soulsFull');
  }
}
function hurtBoss(fight, amount) {
  const hit = new Common.core.HitDamage(amount, Common.core.HitMask.RED);
  hit.setSource(fight.player);
  fight.boss.getCombat().getHitQueue().addPendingDamage([hit]);
}
function clear(fight) {
  const special = fight.special;
  if (!special)
    return;
  for (const seed of special.seeds ?? [])
    if (seed.object)
      fight.player.getPacketSender().sendObjectRemoval(seed.object);
  for (const column of special.columns ?? [])
    Common.remove(column.npc);
  for (const soul of special.souls ?? [])
    Common.remove(soul.npc);
  fight.special = null;
  Common.fragment(fight, false);
}
module.exports = { start, process, render, clear, soulDied, seedLayout };
