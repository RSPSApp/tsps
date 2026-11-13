/** The four Tower of Ascension trials: RSProx 1695 and the OSRS Wiki walkthrough. */
module.exports = function tower(shared) {
  const { api, PAGE, S, Scenes, play, after, locate, variantSteps, advance, held, stage, stopFollowing } = shared;
  const { Animation, CombatMethod, CombatType, Graphic, HitDamage, HitMask, Location, PendingHit, PrayerHandler, Skill } = api.core;
  const ObstacleRunner = require('../../skills/agility/ObstacleRunner.Agility');
  const { crossingFor } = require('../../objects/WallDoor.Doors');
  const STATE_ATTRIBUTE = 'the-heart-of-darkness:tower';
  const JANUS = 13766, ITZLA = 13770, ITZLA_FIGHTER = 13771, ITZLA_HURT = 13772, ITZLA_OPPONENT = 13784, ITZLA_DOWN = 13785;
  const STRONG_BRAWLERS = [13775, 13776];
  const ASCENDED = [13767, 13768, 13769], ACOLYTES = [13780, 13781, 13782, 13783];
  const NAMES = ['Tenoch', 'Silia', 'Adrius', 'Eleuia'];
  const KEY = 29877, BOOK = 29878, POEM = 29879, SCRAPS = [29880, 29881, 29882], NOTE = 29883, BANDAGE = 29884;
  const GATE = 55354, BOOK_CHEST = 54372, LETTER_CHEST = 54376, DIRECTION_CHEST = 54374, MEDICAL_BOX = 54378, STAIRS = [54370, 54371];
  const LETTER_INTERFACE = 809, DIRECTION_INTERFACE = 810, PAPER_INTERFACE = 808;
  const MAIN_MODAL = (161 << 16) | 16;
  const WORDS = [['Chua', 'Moki', 'Lini', 'Kualt'], ['Chaki', 'Koma', 'Ueai', 'Huka'], ['Iknil', 'Kemo', 'Ami', 'Ikam']];
  const DIRECTIONS = ['Makt', 'Takam', 'Uitt', 'Silam'];
  const PREFIX = 'descending-into-the-tower-of-ascension-';
  const V = {
    FIRST: PREFIX + 'first-trial', KEY: PREFIX + 'first-trial-pickpocketing-a-cultist',
    BOOK: PREFIX + 'first-trial-unlocking-the-south-west-gate-and-chest',
    HINT: PREFIX + 'first-trial-talking-to-prince-itzla-arkan-before-receiving-the-poem',
    TRANSLATE: PREFIX + 'first-trial-talking-to-prince-itzla-arkan-after-reading-the-poem',
    NOTE: PREFIX + 'first-trial-talking-to-prince-itzla-arkan-with-the-completed-note',
    PHRASE: PREFIX + 'first-trial-talking-to-forebearer-janus-with-the-completed-note',
    ASCENDED: PREFIX + 'first-trial-talking-to-an-emissary-ascended-before-completing-the-first-trial',
    ASCENDED_DONE: PREFIX + 'talking-to-an-emissary-ascended-after-completing-the-first-trial',
    AFTER_FIRST: PREFIX + 'talking-to-forebearer-janus-after-completing-the-first-trial',
    SECOND: PREFIX + 'second-trial-talking-to-forebearer-janus',
    SECOND_ITZLA: PREFIX + 'second-trial-talking-to-itzla-before-beginning-the-fight',
    SECOND_DONE: PREFIX + 'second-trial-after-the-fight',
    SECOND_ITZLA_DONE: PREFIX + 'second-trial-after-the-fight-talking-to-itzla',
    THIRD: PREFIX + 'third-trial', THIRD_ITZLA: PREFIX + 'third-trial-talking-to-prince-itzla-again',
    CHOOSE: PREFIX + 'third-trial-choosing-the-traitor',
    THIRD_DONE: PREFIX + 'third-trial-talking-to-prince-itzla-arkan-after-the-execution',
    FOURTH: PREFIX + 'fourth-trial', YIELDED: PREFIX + 'speaking-to-forebearer-janus-after-defeating-prince-itzla',
  };
  const pick = values => values[Math.floor(Math.random() * values.length)];
  const shuffled = values => { const result = [...values]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; };
  const active = player => Scenes.get(player)?.name === 'tower' ? Scenes.get(player) : null;
  const locks = new WeakMap();

  function state(player) {
    let value = player.getAttribute(STATE_ATTRIBUTE);
    if (!value || typeof value !== 'object') {
      value = { letters: pick(['DAWN', 'RALO', 'RANI']), directions: shuffled([0, 1, 2, 3]), phrase: WORDS.map(pick), traitor: Math.floor(Math.random() * 4) };
      player.setAttribute(STATE_ATTRIBUTE, value);
    }
    return value;
  }

  function change(player, values) {
    player.setAttribute(STATE_ATTRIBUTE, { ...state(player), ...values });
    syncVarbits(player);
  }

  function syncVarbits(player) {
    if (stage(player) < S.TRIALS_EXPLAINED) return;
    const data = state(player), sender = player.getPacketSender();
    for (const [id, value] of [[11133, data.failed2], [11134, data.consulted], [11135, data.failed3], [11140, data.failures],
      [11165, data.gate], [11166, data.lettersOpen], [11167, data.directionsOpen], [11168, data.attempts], [11170, data.readPoem], [11171, data.translated]]) sender.sendVarbit(id, Number(value) || 0);
  }

  function box(player, text, items = []) {
    play(player, JANUS, V.FIRST, () => [{ type: 'message', text, id: 'hod-tower-box', items }]);
  }

  function give(player, ids, text) {
    const missing = ids.filter(id => !held(player, id) && !(SCRAPS.includes(id) && held(player, NOTE)));
    if (!missing.length) { box(player, 'You open the chest, but there is nothing of interest inside.'); return; }
    if (player.getInventory().getFreeSlots() < missing.length) { box(player, text.replace(/\.$/, ", but you don't have enough room to take them."), ids); return; }
    for (const id of missing) player.getInventory().adds(id, 1);
    box(player, text, ids);
  }

  function selectVariant({ player, npcId }) {
    if (!active(player)) return null;
    const current = stage(player);
    if (npcId === JANUS) {
      if (current === S.TRIAL_1) return held(player, NOTE) ? V.PHRASE : V.FIRST;
      if (current === S.PASSPHRASE) return V.AFTER_FIRST;
      if (current === S.TRIAL_2) return V.SECOND;
      if (current === S.SURVIVED) return V.THIRD;
      if (current === S.TRIAL_3) return PREFIX + 'third-trial-talking-to-janus-during-the-trial';
      if (current === S.TRAITOR) return V.FOURTH;
      if (current >= S.YIELDED) return V.YIELDED;
    }
    if ([ITZLA, ITZLA_FIGHTER, ITZLA_HURT].includes(npcId)) {
      if (current === S.TRIAL_1) return held(player, NOTE) ? V.NOTE : state(player).readPoem ? V.TRANSLATE : V.HINT;
      if (current === S.TRIAL_2) return V.SECOND_ITZLA;
      if (current === S.SURVIVED) return V.SECOND_ITZLA_DONE;
      if (current === S.TRIAL_3) return V.THIRD_ITZLA;
      if (current === S.TRAITOR) return V.THIRD_DONE;
    }
    if (ASCENDED.includes(npcId)) return current < S.PASSPHRASE ? V.ASCENDED : V.ASCENDED_DONE;
    const index = ACOLYTES.indexOf(npcId);
    return index >= 0 ? PREFIX + 'third-trial-questioning-' + NAMES[index].toLowerCase() : null;
  }

  const traitorConditions = {
    DFyb_t: [0, false], rgz6SK: [0, false], eXupGb: [0, true], '-Kj4rx': [0, true],
    LX4ceH: [1, false], W981Jm: [1, false], 'rTbiB-': [1, true], eHBR0T: [1, true],
    gA4fIP: [2, false], V9XCM3: [2, false], xfk_Av: [2, true], JQsjvj: [2, true],
    ahMG0V: [3, false], Rp_XWa: [3, false], BoafeO: [3, true], 'F-P-z3': [3, true],
  };
  function answerCondition({ player, stepId }) {
    if (!active(player)) return null;
    const data = state(player);
    if (traitorConditions[stepId]) { const [index, yes] = traitorConditions[stepId]; return (data.traitor === index) === yes; }
    switch (stepId) {
      case 'axmZBm': return false;
      case 'HrF8WL': return !held(player, NOTE) && !SCRAPS.some(id => held(player, id));
      case 'fiET8W': return SCRAPS.some(id => held(player, id)) && !held(player, NOTE);
      case 'pI4GD8': return !held(player, KEY) && !data.gate;
      case 'EgeN2l': return (held(player, KEY) || data.gate) && !held(player, BOOK);
      case 'vl7lj7': return held(player, BOOK) && !held(player, POEM);
      case 'sWx0Gp': return !held(player, BANDAGE);
      case 'QK5TP0': return held(player, BANDAGE);
      case '428YHT': return stage(player) >= S.SURVIVED;
      case '4c5cRY': return data.accused !== data.traitor;
      case 'LdzHnw': return data.accused === data.traitor;
      default: return null;
    }
  }

  function transition(player, value, next, variant, transform = null) {
    Scenes.fade(player, true);
    Scenes.hold(player);
    Scenes.controls(player, true);
    Scenes.later(active(player) ?? player, 2, () => {
      Scenes.end(player, false);
      advance(player, value);
      const remove = value >= S.TRIAL_3 ? [BANDAGE] : value === S.TRIAL_2 ? [KEY, BOOK, POEM, NOTE, ...SCRAPS] : [];
      for (const id of remove) if (held(player, id)) player.getInventory().deleteNumber(id, player.getInventory().getAmount(id));
      const plane = value < S.TRIAL_2 ? 1 : 2;
      const scene = Scenes.open(player, 'tower', [[1632, 1649, 3214, 3229, plane]], {
        multi: true, npcAggression: () => false,
        canAttack: (attacker, target) => target?.__questSceneOwner === player || attacker?.__questSceneOwner === player ? null : false,
      });
      player.moveTo(new Location(1637, 3221, plane));
      scene.janus = Scenes.actor(scene, JANUS, [1644, 3225, plane], [1642, 3223]);
      scene.itzla = Scenes.actor(scene, value === S.TRIAL_2 ? ITZLA_FIGHTER : ITZLA, [1638, 3220, plane], [1637, 3221]);
      scene.wave = -1;
      if (value < S.TRIAL_2) for (const [index, id] of ASCENDED.entries()) Scenes.actor(scene, id, [1637 + index * 3, 3225, plane]);
      if (value === S.TRIAL_3) scene.acolytes = ACOLYTES.map((id, i) => Scenes.actor(scene, id, [1637 + i * 2, 3223, plane], [1640, 3221]));
      if (value === S.TRIAL_2) {
        scene.bandages = new Map();
        for (const tile of [[1645, 3218], [1645, 3219], [1645, 3224]]) Scenes.loc(scene, { id: MEDICAL_BOX, x: tile[0], y: tile[1], z: plane });
      }
      Scenes.controls(player, false);
      Scenes.fade(player, false);
      Scenes.later(scene, 2, () => { Scenes.closeFade(player); if (variant) play(player, next, variant, transform); });
    });
  }

  function afterFirst(steps) {
    const correct = locate(variantSteps(V.PHRASE), 'QtU6YH').list.find(step => step.id === 'QtU6YH');
    return [steps[0], correct.steps.find(step => step.type === 'choice')];
  }

  function climb(player) {
    stopFollowing(player);
    const current = stage(player);
    if (current <= S.TRIAL_1) transition(player, S.TRIAL_1, JANUS, V.FIRST, steps => steps.slice(0, 1));
    else if (current <= S.TRIAL_2) transition(player, current, JANUS, current === S.PASSPHRASE ? V.AFTER_FIRST : V.SECOND, current === S.PASSPHRASE ? afterFirst : null);
    else if (current <= S.TRIAL_3) transition(player, current, JANUS, current === S.SURVIVED ? V.SECOND_DONE : V.THIRD);
    else transition(player, current, JANUS, V.FOURTH);
  }

  /** The transcript nests every later word under only the last option; build all 64 paths. */
  function phraseMenu(player, index = 0, chosen = []) {
    return { type: 'choice', options: WORDS[index].map(word => ({ text: word + '.', steps: index < 2 ? [phraseMenu(player, index + 1, [...chosen, word])] : [{ type: 'action', id: 'hod-phrase', words: [...chosen, word] }] })) };
  }

  function talk({ player, npcId, npc }) {
    if (!active(player)) return false;
    const variant = selectVariant({ player, npcId });
    if (!variant) return false;
    if (npcId === JANUS && stage(player) === S.TRIAL_1) {
      play(player, JANUS, V.PHRASE, steps => {
        const menu = steps.find(step => step.type === 'choice');
        return [steps[0], { ...menu, options: menu.options.map(option => option.text !== 'About that passphrase...' ? option : {
          ...option, steps: [{ player: 'About that passphrase...' }, { type: 'line', speaker: 'Forebearer Janus', text: 'Do you have it yet?' },
            ...(held(player, NOTE) || SCRAPS.some(id => held(player, id)) ? [{ player: 'I think so!' }, phraseMenu(player)] : [{ player: "Not quite yet, but I'll have it in no time." }, { type: 'line', speaker: 'Forebearer Janus', text: 'We shall see.' }])],
        }) }];
      }, npc);
    } else play(player, npcId, variant, npcId === JANUS && stage(player) === S.PASSPHRASE ? afterFirst : null, npc);
    return true;
  }

  function pickpocket({ player, npcId }) {
    if (!active(player) || stage(player) !== S.TRIAL_1 || !ASCENDED.includes(npcId)) return false;
    if (held(player, KEY) || state(player).gate) box(player, "There doesn't seem to be anything of value in their pocket.");
    else if (player.getInventory().getFreeSlots() > 0) {
      player.performAnimation(new Animation(881));
      Scenes.later(active(player), 1, () => { give(player, [KEY], "You pull a key out of the cultist's pocket."); player.getSkillManager().addExperiences(Skill.THIEVING, 10); });
    } else player.sendMessage('You need some free inventory space.');
    return true;
  }

  function unlockGate(event) {
    const { player } = event;
    if (!active(player) || event.itemId !== KEY || (event.objectId ?? event.object?.getId?.()) !== GATE || stage(player) !== S.TRIAL_1) return false;
    event.handled = true;
    if (!held(player, KEY)) return true;
    player.getInventory().deleteNumber(KEY, 1);
    change(player, { gate: 1 });
    box(player, 'You use the key to unlock the gate.', [KEY]);
    return true;
  }

  function gate(event) {
    const { player, object } = event;
    if (!active(player) || (event.objectId ?? object?.getId?.()) !== GATE) return false;
    event.handled = true;
    if (!state(player).gate) { player.sendMessage('The gate is locked.'); return true; }
    const crossing = crossingFor(object, player.getLocation());
    ObstacleRunner.run({ player, object }, [{ run: () => player.getPacketSender().sendObject(new api.core.GameObject(38848, object.getLocation(), object.getType(), object.getFace(), active(player).area)) },
      { walk: [crossing.approach, crossing.destination].map(({ x, y }) => [x, y]) }, { run: () => player.getPacketSender().sendObject(object) }]);
    return true;
  }

  function chest(event) {
    const { player } = event, id = event.objectId ?? event.definition?.id;
    if (!active(player) || stage(player) !== S.TRIAL_1 || ![BOOK_CHEST, LETTER_CHEST, DIRECTION_CHEST].includes(id)) return false;
    if (id === BOOK_CHEST) {
      if (!state(player).gate) return true;
      give(player, [BOOK, SCRAPS[0]], 'You open the chest and find a book and a scrap of paper inside.');
    } else {
      const letters = id === LETTER_CHEST, data = state(player);
      if (data[letters ? 'lettersOpen' : 'directionsOpen']) {
        give(player, letters ? [POEM, SCRAPS[1]] : [SCRAPS[2]], letters ? 'You open the chest and find a poem and a scrap of paper inside.' : 'You open the chest and find a scrap of paper inside.');
        return true;
      }
      const group = letters ? LETTER_INTERFACE : DIRECTION_INTERFACE;
      locks.set(player, group);
      player.setInterfaceId(group);
      const sender = player.getPacketSender();
      sender.sendSubInterface(MAIN_MODAL, group, 0);
      if (letters) sender.sendInterfaceScript(6963, [(group << 16) | 1, (group << 16) | 4, 4, 3783, 1]);
      else sender.sendInterfaceScript(1799, [4949]);
      player.setEnteredAmountAction({ execute: value => {
        if (locks.get(player) !== group || !active(player) || stage(player) !== S.TRIAL_1 || player.getInterfaceId() !== group) return;
        locks.delete(player);
        sender.sendInterfaceRemoval();
        let correct;
        if (letters) {
          const wheels = [3698, 3699, 3700, 3701].map(row => api.core.CacheDefinitions.getDbRow(row)?.columns.get(0) ?? []);
          const code = data.letters.split('').map((letter, index) => wheels[index].indexOf(letter)).join('') + '00';
          correct = Number.isInteger(value) && value === Number(code);
        } else {
          const code = data.directions.reduce((sum, direction, i) => sum + direction * 4 ** i, 0) * 10 + 4;
          correct = Number.isInteger(value) && value === code;
        }
        if (!correct) { box(player, "That didn't seem to work."); return; }
        change(player, { [letters ? 'lettersOpen' : 'directionsOpen']: 1 });
        give(player, letters ? [POEM, SCRAPS[1]] : [SCRAPS[2]], letters ? 'You unlock the chest and find a poem and a scrap of paper inside.' : 'You unlock the chest and find a scrap of paper inside.');
      } });
    }
    return true;
  }

  function read({ player, itemId }) {
    if (![BOOK, POEM, NOTE, ...SCRAPS].includes(itemId) || !held(player, itemId)) return false;
    const data = state(player), sender = player.getPacketSender();
    if (SCRAPS.includes(itemId)) {
      if (SCRAPS.every(id => held(player, id))) { for (const id of SCRAPS) player.getInventory().deleteNumber(id, 1); player.getInventory().adds(NOTE, 1); box(player, 'You combine the scraps of paper together.', [NOTE]); }
      else paper(player, '', [data.phrase[SCRAPS.indexOf(itemId)]]);
    } else if (itemId === NOTE) paper(player, '', [data.phrase.join(' ')]);
    else if (itemId === POEM) {
      change(player, { readPoem: 1 });
      paper(player, 'Twilight', data.directions.map((dir, i) => `<col=faf9f6>${DIRECTIONS[dir]}</col>, ${["the dawn whispers light's embrace.", "twilight's hues paint the sky's face.", 'echoes tales of ancient lore.', 'where dreams soar evermore.'][i]}`));
    } else {
      const word = data.letters;
      require('../QuestRuntime').openBook(player, 'The Recruit', [{
        44: 'I arrived at the tower,',
        45: `<col=FAF9F6>${word[0] === 'D' ? 'Disconcerted' : 'Restless'}</col> and full of nerves.`,
        46: 'As I prepared for the trials', 47: 'that <col=FAF9F6>Awaited</col>, I asked myself',
        48: 'if I had what it took to join', 49: 'the Emissaries?',
        51: 'The tower was cold and',
        52: word[2] === 'W' ? 'dark, isolated from the rest' : 'dark, with no sign of natural',
        53: word[2] === 'W' ? 'of the <col=FAF9F6>World</col>. Entering' : `<col=FAF9F6>${word[2] === 'L' ? 'Light' : 'Nature'}</col> anywhere. Entering`,
        54: 'through the shadow-filled', 55: 'gates, I hoped that all my',
        56: `${word[3] === 'N' ? '<col=FAF9F6>New</col>' : 'new'} research would be`, 57: 'enough.',
        60: 'I prayed that I would be able',
        61: `to ${word[3] === 'O' ? '<col=FAF9F6>Obey</col>' : 'obey'} their beliefs and`,
        62: `${word[3] === 'I' ? '<col=FAF9F6>Invoke</col>' : 'deliver'} the Final Dawn.`,
      }]);
    }
    return true;
  }

  function paper(player, title, lines) {
    const sender = player.getPacketSender();
    for (let i = 5; i <= 18; i++) sender.sendString('', (PAPER_INTERFACE << 16) | i);
    sender.sendString(title, (PAPER_INTERFACE << 16) | 7);
    lines.forEach((line, i) => sender.sendString(line, (PAPER_INTERFACE << 16) | (10 + i * 2)));
    player.setInterfaceId(PAPER_INTERFACE); sender.sendSubInterface(MAIN_MODAL, PAPER_INTERFACE, 0);
  }

  function handleLine(event) {
    const { player, text } = event;
    if (!active(player)) return;
    const trigger = (line, value, run, when = 'after') => {
      if (text !== line) return;
      const previous = event[when];
      event[when] = () => { previous?.(); if (stage(player) === value) run(); };
    };
    if (text === 'Welcome to your next trial. Here, there is one simple goal...') trigger(text, S.PASSPHRASE, () => transition(player, S.TRIAL_2, JANUS, V.PHRASE, () => [
      { type: 'line', speaker: 'Forebearer Janus', text: 'Survive.' },
      { type: 'line', speaker: 'Forebearer Janus', text: 'Speak to me when you are ready to start.' },
    ]));
    trigger('Then let the trial commence.', S.TRIAL_2, () => startWaves(player));
    if (text.startsWith('Welcome to your third trial.')) {
      trigger(text, S.SURVIVED, () => transition(player, S.TRIAL_3, JANUS, V.THIRD, steps => steps.find(step => step.type === 'choice').options.find(option => option.text === 'Yes.').steps.slice(2)));
    }
    trigger('Ready yourselves! May the best warrior win!', S.TRAITOR, () => startDuel(player));
    if (text.startsWith('You and your companion will fit in nicely here.')) trigger(text, S.YIELDED, () => leave(player));
  }

  function handleAction(event) {
    const { player, stepId, step } = event;
    if (stepId === 'hod-tower-box') { event.handled = true; event.box = step?.items?.length ? { items: step.items } : { statement: true }; return; }
    if (!active(player)) return;
    if (stepId === 'hod-phrase') {
      event.handled = true; event.end = true;
      if (!step?.words?.every((word, i) => word === state(player).phrase[i])) {
        change(player, { attempts: Math.min(7, (state(player).attempts || 0) + 1) });
        play(player, JANUS, V.PHRASE, () => [{ player: (step?.words ?? []).join(' ') + '.' }, { type: 'line', speaker: 'Forebearer Janus', text: "No, that's not quite right." }]);
      } else {
        advance(player, S.PASSPHRASE);
        play(player, JANUS, V.PHRASE, steps => locate(steps, 'QtU6YH')?.list.find(value => value.id === 'QtU6YH')?.steps ?? []);
      }
    }
    if (stepId === '7ZcbBM' || stepId === '38TuFO') {
      event.handled = true;
      const scene = active(player), data = state(player), npc = scene.acolytes?.[data.accused];
      scene.janus?.performAnimation(new Animation(9144)); npc?.performGraphic(new Graphic(131));
      if (data.accused === data.traitor) {
        advance(player, S.TRAITOR);
        Scenes.later(scene, 2, () => Scenes.removeActor(scene, npc));
      } else {
        change(player, { failed3: 1, failures: Math.min(3, (data.failures || 0) + 1), traitor: Math.floor(Math.random() * 4) });
      }
    }
  }

  function choose({ player, npcId }) {
    const scene = active(player), index = ACOLYTES.indexOf(npcId);
    if (!scene || index < 0 || stage(player) !== S.TRIAL_3) return false;
    change(player, { accused: index });
    play(player, JANUS, V.CHOOSE, steps => JSON.parse(JSON.stringify(steps).replaceAll("[member's name]", NAMES[index])));
    return true;
  }

  function wave(player, index) {
    const scene = active(player);
    if (!scene || stage(player) !== S.TRIAL_2) return;
    scene.wave = index;
    scene.pending = [];
    scene.fighters = new Set();
    if (index === 4) {
      advance(player, S.SURVIVED);
      scene.itzla?.getCombat().reset();
      play(player, JANUS, V.SECOND_DONE);
      return;
    }
    const ids = [[13773, 13774, 13773, 13774], [13774, 13776, 13773, 13775], [13777, 13776, 13773, 13778], [13775, 13778, 13777, 13776]][index];
    const origins = [
      [[1639,3226],[1640,3227],[1641,3227],[1642,3226]],
      [[1645,3223],[1646,3222],[1646,3221],[1645,3220]],
      [[1642,3217],[1641,3216],[1640,3216],[1639,3217]],
      [[1637,3217],[1636,3218],[1636,3225],[1637,3226]],
    ];
    scene.janus.forceChat(['Brawlers attack!', "Don't go so easy on them this time, brawlers!", 'Conjurers, aid your brawlers!', 'Brawlers attack!'][index]);
    scene.pending = ids.map((id, i) => ({ id, target: i % 2 === 0 ? player : scene.itzla, at: origins[index][i] }));
    Scenes.later(scene, index === 0 ? 3 : 6, () => {
      if (active(player) !== scene) return;
      const count = index === 3 ? 4 : 2;
      for (let i = 0; i < count; i++) reinforce(scene);
    });
  }

  function reinforce(scene) {
    const next = scene.pending.shift();
    if (!next) return;
    const npc = Scenes.actor(scene, next.id, [...next.at, 2]);
    if (!npc) return;
    npc.__hodTrial = scene;
    scene.fighters.add(npc);
    npc.getCombat().attack(next.target);
    if (next.target === scene.itzla) scene.itzla.getCombat().attack(npc);
  }

  function startWaves(player) {
    const scene = active(player);
    if (!scene || scene.wave >= 0) return;
    scene.itzla.__hodCompanion = scene;
    change(player, { failed2: 0 });
    wave(player, 0);
  }

  function medical({ player, object }, amount = 1) {
    const scene = active(player);
    if (!scene || stage(player) !== S.TRIAL_2 || object?.getId() !== MEDICAL_BOX) return false;
    const location = object.getLocation(), key = `${location.getX()},${location.getY()}`, remaining = scene.bandages.get(key) ?? 5;
    if (remaining === 0) { box(player, 'The box is empty.'); return true; }
    if (player.getInventory().getFreeSlots() < 1) { player.sendMessage('You need some free inventory space.'); return true; }
    const take = Math.min(remaining, player.getInventory().getFreeSlots(), amount);
    if (!Number.isInteger(take) || take <= 0) return true;
    player.getInventory().adds(BANDAGE, take); scene.bandages.set(key, remaining - take);
    box(player, 'You take some bandages from the box.', [BANDAGE]); return true;
  }

  function medicalMany(event) {
    if (!active(event.player) || stage(event.player) !== S.TRIAL_2 || event.objectId !== MEDICAL_BOX) return false;
    event.player.setEnteredAmountAction({ execute: amount => medical(event, amount) });
    event.player.getPacketSender().sendEnterAmountPrompt('How many bandages would you like?');
    return true;
  }

  function healPlayer({ player, itemId }) {
    if (itemId !== BANDAGE || !active(player) || ![S.TRIAL_2, S.SURVIVED].includes(stage(player)) || !held(player, BANDAGE)) return false;
    player.getInventory().deleteNumber(BANDAGE, 1); player.heal(12); return true;
  }

  function bandage(event) {
    const { player, itemId = BANDAGE } = event;
    const npc = event.target ?? event.npc;
    const scene = active(player);
    if (!scene || scene.itzla !== npc || itemId !== BANDAGE || !held(player, BANDAGE)) return false;
    player.getInventory().deleteNumber(BANDAGE, 1); npc.heal(18); npc.setNpcTransformationId(ITZLA_FIGHTER); return true;
  }

  function beforeDeath(event) {
    const npc = event.npc, scene = npc?.__hodTrial ?? npc?.__hodCompanion ?? npc?.__hodDuel;
    if (!scene || active(scene.owner) !== scene) return;
    event.preventDeath = true;
    if (npc.__hodDefeated) return;
    npc.__hodDefeated = true;
    npc.getCombat().reset();
    if (npc.__hodTrial) {
      scene.fighters.delete(npc);
      npc.performAnimation(new Animation(11558));
      Scenes.later(scene, 2, () => Scenes.removeActor(scene, npc));
      if (scene.pending.length) reinforce(scene);
      else if (!scene.fighters.size) wave(scene.owner, scene.wave + 1);
    } else if (npc.__hodCompanion) {
      change(scene.owner, { failed2: 1 });
      scene.owner.sendMessage('Itzla is knocked out, causing you to fail the trial.');
      leave(scene.owner);
    } else {
      scene.owner.getCombat().reset();
      npc.forceChat('I yield!'); npc.performAnimation(new Animation(11558)); npc.setNpcTransformationId(ITZLA_DOWN);
      advance(scene.owner, S.YIELDED);
      Scenes.later(scene, 2, () => play(scene.owner, JANUS, V.YIELDED));
    }
  }

  class BrawlerCombat extends CombatMethod {
    type() { return CombatType.MELEE; }
    attackSpeed() { return 5; }
    attackDistance() { return 1; }
    start(npc) { if (!npc.__hodDefeated) npc.performAnimation(new Animation(388)); }
    hits(npc, target) {
      const scene = npc.__hodTrial;
      if (!scene || npc.__hodDefeated) return [];
      npc.__hodSwings = (npc.__hodSwings || 0) + 1;
      if (npc.__hodSwings % 3) return [new PendingHit(npc, target, this, 0)];
      const at = npc.getLocation();
      npc.performAnimation(new Animation(11556));
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const tile = new Location(at.getX() + dx, at.getY() + dy, at.getZ());
        scene.owner.getPacketSender().sendGraphic(new Graphic(1446), tile).sendGraphic(new Graphic(92, 0, 88), tile);
      }
      if (target === scene.itzla) scene.itzla.getMovementQueue().addSteps(new Location(at.getX() + 2, at.getY(), at.getZ()));
      Scenes.later(scene, 3, () => {
        if (npc.__hodDefeated) return;
        for (const victim of [scene.owner, scene.itzla]) {
          if (!victim?.isRegistered() || victim.getLocation().getDistance(at) > 1) continue;
          // shortcut: the Wiki does not give the slam's max hit; use the normal max until captured.
          victim.getCombat().getHitQueue().addPendingDamage([new HitDamage(8, HitMask.RED)]);
        }
      });
      return [];
    }
  }

  class ItzlaCombat extends CombatMethod {
    type() { return CombatType.MELEE; }
    attackSpeed() { return 4; }
    attackDistance() { return 1; }
    start(npc, target) { npc.performAnimation(new Animation(390)); }
    hits(npc, target) {
      const scene = npc.__hodDuel;
      if (!scene || npc.__hodDefeated) return [];
      npc.__hodAttacks = (npc.__hodAttacks || 0) + 1;
      if (npc.__hodAttacks % 4 !== 0) return [new PendingHit(npc, target, this, 1, 0)];
      if (npc.__hodAttacks % 8 === 0) {
        npc.forceChat('Prayers? What prayers?'); PrayerHandler.deactivatePrayers(target);
      } else {
        npc.forceChat('You might want to dodge this!');
        const from = npc.getLocation(), to = target.getLocation(), dx = Math.sign(to.getX() - from.getX()), dy = Math.sign(to.getY() - from.getY());
        Scenes.later(scene, 2, () => {
          if (npc.__hodDefeated) return;
          npc.performAnimation(new Animation(1872)); npc.performGraphic(new Graphic(347));
          const at = target.getLocation();
          if ((at.getX() - from.getX()) * dx + (at.getY() - from.getY()) * dy > 0 && at.getDistance(from) <= 3) target.getCombat().getHitQueue().addPendingDamage([new HitDamage(20, HitMask.RED)]);
        });
      }
      return [];
    }
  }

  function startDuel(player) {
    const scene = active(player);
    if (!scene || scene.duel) return;
    advance(player, S.TRIAL_4);
    Scenes.removeActor(scene, scene.itzla);
    scene.duel = Scenes.actor(scene, ITZLA_OPPONENT, [1642, 3222, 2], [1640, 3222]);
    scene.duel.__hodDuel = scene;
    scene.duel.getCombat().attack(player);
  }

  function protectSpecial({ target, attacker, combatType, damage }) {
    if (!target?.__hodDuel || !attacker?.isSpecialActivated?.()) return;
    const prayer = combatType === CombatType.MAGIC ? PrayerHandler.PROTECT_FROM_MAGIC : combatType === CombatType.RANGED ? PrayerHandler.PROTECT_FROM_MISSILES : PrayerHandler.PROTECT_FROM_MELEE;
    PrayerHandler.activatePrayerPrayerId(target, prayer);
    damage.setDamage(0);
    Scenes.later(target.__hodDuel, 1, () => PrayerHandler.deactivatePrayers(target));
  }

  function leave(player) {
    locks.delete(player);
    Scenes.end(player, false);
    player.moveTo(new Location(1637, 3221, 0));
    player.getPacketSender().sendInterfaceRemoval();
  }

  function stairs(event) {
    const { player, objectId } = event;
    if (!active(player) || !STAIRS.includes(objectId)) return false;
    event.handled = true;
    leave(player); return true;
  }

  function logout(player) {
    locks.delete(player);
    if (player.getLocation().getX() >= 1632 && player.getLocation().getX() <= 1649 && player.getLocation().getY() >= 3214 && player.getLocation().getY() <= 3229 && player.getLocation().getZ() > 0) player.moveTo(new Location(1637, 3221, 0));
  }

  function register() {
    api.persistAttribute(STATE_ATTRIBUTE);
    api.onNpcsInteraction(['Forebearer Janus', 'Prince Itzla Arkan', 'Emissary Ascended', ...NAMES], { 'Talk-to': talk, Pickpocket: pickpocket, Choose: choose, Heal: bandage });
    api.onObjectInteraction('Chest', { Open: chest });
    api.onObjectInteraction('Medical box', { 'Take-from': medical, 'Take-many': medicalMany });
    api.onCustomEvent('ladders:climb', stairs);
    api.onObjectInteraction('Staircase', { Exit: stairs, 'Quick-exit': stairs });
    api.onCustomEvent('door:toggle', gate);
    api.onItemOnObject(unlockGate);
    api.onItemOnNpc(bandage);
    api.onItemAction('Book', { Read: read });
    api.onItemAction('Poem', { Read: read });
    api.onItemAction('Scrap of paper', { Inspect: read });
    api.onItemAction('Completed note', { Read: read });
    api.onItemAction('Bandages', { Heal: healPlayer });
    api.onNpcBeforeDeath(beforeDeath);
    api.onCombatHitDamage(protectSpecial);
    api.registerNpcCombatMethodProvider(ITZLA_OPPONENT, ItzlaCombat);
    api.registerNpcCombatMethodProvider(STRONG_BRAWLERS, BrawlerCombat);
  }
  return { register, syncVarbits, selectVariant, answerCondition, handleLine, handleAction, climb, logout, reset: player => player.setAttribute(STATE_ATTRIBUTE, null), inTrial: player => !!active(player) };
};
