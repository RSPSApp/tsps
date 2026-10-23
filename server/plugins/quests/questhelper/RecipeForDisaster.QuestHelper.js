'use strict';

// Compatibility adapter for quests/RecipeForDisaster.Quest.js. This module only
// describes actions. It deliberately does not call any dialogue/game action API.
const PREFIX = 'recipe-for-disaster:';
const OWNED_ATTRIBUTES = Object.freeze([
  'quest.points', 'quest.recipe_for_disaster.stage', ...['rescues', 'pirate-state', 'pirate-hides-given',
    'goblin-state', 'dwarf-state', 'guide-state', 'evil-dave-state',
    'evil-dave-stew', 'skrach-state', 'awowogei-state', 'amik-state',
    'culinaromancer-wave', 'culinaromancer-defeated'].map(name => PREFIX + name),
]);
const VARIANTS = Object.freeze([
  'START', 'DWARF', 'WARTFACE_AND_BENTNOZE', 'PIRATE_PETE',
  'LUMBRIDGE_GUIDE', 'EVIL_DAVE', 'SKRACH_UGLOGWEE', 'SIR_AMIK_VARZE',
  'MONKEY_AMBASSADOR', 'FINALE',
].map(name => 'RECIPE_FOR_DISASTER_' + name));

// Native completion values are pinned by the upstream RFD helpers' own
// isCompleted/getState methods. Unknown intermediate native stages are omitted.
// QuestRuntime.stageAttribute('recipe_for_disaster') owns this exact stage key.
function completionProjection(player) {
  const rawStage = Number(player.getAttribute('quest.recipe_for_disaster.stage'));
  const stage = Number.isFinite(rawStage) ? rawStage | 0 : 0;
  const flags = Number(player.getAttribute(PREFIX + 'rescues')) || 0;
  const result = {};
  if (stage >= 5) result[1850] = 5;
  else if (stage === 4) result[1850] = flags === 255 ? 4 : 3;
  else if (stage === 0 || stage === 1) result[1850] = stage;
  for (const [flag, id, value] of [[1,1892,60],[2,1867,40],[4,1895,110],
    [8,1896,5],[16,1878,5],[32,1904,170],[64,1910,20],[128,1914,50]]) {
    if (flags & flag) result[id] = value;
  }
  return result;
}

// Exact public quiz data from GUIDE_QUIZZES in the server quest. Random question
// selection and shuffled answer positions stay in the game; only visible text
// is matched here. The source-parity regression covers every question.
const GUIDE_ANSWERS = new Map([
  ['A vision shows a ghostly woman in white. Who is she?', 'Velorina'],
  ['A vision shows an elf with long blond hair. Who is he?', 'Islwyn'],
  ['A vision shows a man wearing a crown in East Ardougne. Who is he?', 'King Lathas'],
  ['A vision shows a man in a blue shirt with a book. Who is he?', 'Reldo'],
  ['A vision shows a woman in a pink top. Who is she?', 'Gertrude'],
  ['A vision shows a witch in a pointed hat. Who is she?', 'Hetty'],
  ['A vision shows a pirate in a bandana. Who is he?', 'Pirate Pete'],
  ['A vision shows a man in ordinary clothes from a nearby farm. Who is he?', 'Unferth'],
  ['A vision shows a desert merchant with a white beard. Who is he?', 'Ali Morrisane'],
  ['A vision shows a man in a brown vest. Who is he?', 'Professor Gronigen'],
  ['What is the combat level of the goblins near Lumbridge?', '2'],
  ['What defence level is required to wear a Mystic hat?', '20'],
  ['What ingredients are used in a cake?', 'Flour, egg and milk'],
  ['How many coins does the Al Kharid gate guard charge?', '10'],
  ['Which castle does not lie between Morytania and Asgarnia?', 'Keep Le Faye'],
  ['A gold ring is to 5 as a holy symbol is to...', '16'],
  ['A glass vial is to 33 as a glass orb is to...', '46'],
  ['Which guild is closest to the Fishing Platform?', "Legends' Guild"],
  ['What is the bar west of Pollnivneach called?', 'Bandit Camp'],
  ['Which direction does the River Salve run?', 'North to south'],
  ['Where can you hear howling one way and buzzing the other?', 'Catherby'],
  ['What do you need to make glass?', 'Sand, a bucket, soda ash and a glassblowing pipe'],
  ['Which tower is closest to the Crafting Guild?', "Dark Wizards' Tower"],
  ["Which item began with the letter 'M'?", 'Mind talisman'],
  ['Which of the following items was NOT shown to you?', 'Trout'],
  ['How many weapons were you shown?', 'Three'],
  ['Which items were among those you were shown?', 'Guthix prayer book, magic logs and pike'],
  ['How many types of runes were there?', 'Two'],
]);

function visibleQuiz(widgets) {
  const pending = Array.isArray(widgets) ? [...widgets] : [];
  let visited = 0;
  while (pending.length && visited++ < 20000) {
    const widget = pending.shift();
    if (!widget || typeof widget !== 'object' || widget.hidden === true || widget.isHidden === true) continue;
    const text = typeof widget.text === 'string' ? widget.text.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
    const answer = GUIDE_ANSWERS.get(text);
    if (answer) return {question: text, answer, id: widget.id};
    for (const key of ['staticChildren', 'dynamicChildren', 'nestedChildren', 'children']) {
      if (Array.isArray(widget[key])) pending.push(...widget[key]);
    }
  }
  return null;
}

function createRfdRenderer({core, getQuests}) {
  if (typeof getQuests !== 'function') throw new Error('RFD requires registered quest handles');
  const identifiers = (group) => new Proxy(core[group] || {}, {
    get(table, name) {
      const value = table[name];
      if (!Number.isInteger(value) || value < 0) throw new Error(`Missing RFD identifier ${group}.${String(name)}`);
      return value;
    },
  });
  const I = identifiers('ItemIdentifiers');
  const N = identifiers('NpcIdentifiers');
  const O = identifiers('ObjectIdentifiers');
  const rescueRows = [
    ['DWARF', 1, 'the Mountain Dwarf', [N.MOUNTAIN_DWARF], I.DWARVEN_ROCK_CAKE_2, 3236, 3219],
    ['WARTFACE_AND_BENTNOZE', 2, 'the goblin generals', [N.GENERAL_WARTFACE_5, N.GENERAL_BENTNOZE_5], I.SLOP_OF_COMPROMISE, 3237, 3219],
    ['PIRATE_PETE', 4, 'Pirate Pete', [N.PIRATE_PETE_3], I.COOKED_FISHCAKE, 3239, 3219],
    ['LUMBRIDGE_GUIDE', 8, 'the Lumbridge Guide', [N.LUMBRIDGE_GUIDE, N.LUMBRIDGE_GUIDE_4], I.CAKE_OF_GUIDANCE, 3240, 3219],
    ['EVIL_DAVE', 16, 'Evil Dave', [N.EVIL_DAVE_3], I.SPICY_STEW, 3236, 3220],
    ['SKRACH_UGLOGWEE', 32, 'Skrach Uglogwee', [N.SKRACH_UGLOGWEE], I.COOKED_JUBBLY, 3237, 3220],
    ['SIR_AMIK_VARZE', 64, 'Sir Amik Varze', [N.SIR_AMIK_VARZE_3, N.SIR_AMIK_VARZE_4], I.BRULEE_SUPREME, 3238, 3220],
    ['MONKEY_AMBASSADOR', 128, 'King Awowogei', [N.AWOWOGEI], I.STUFFED_SNAKE, 3239, 3220],
  ];
  const cookedRanges = () => [O.COOKING_RANGE, O.RANGE, O.COOKING_RANGE_2, O.RANGE_2, O.RANGE_3];

  return function rfdResult(request, player) {
    const response = {
      protocol: 1, sourceCommit: 'tsps-native-rfd-v1', session: request.session,
      sequence: request.sequence, questKey: 'recipe_for_disaster', status: 'active',
      activeStep: null, panels: [], diagnostics: [],
    };
    try {
      const variant = request.helperVariant || VARIANTS[0];
      if (!VARIANTS.includes(variant)) throw new Error(`Unknown RFD helper variant: ${variant}`);
      const part = variant.slice('RECIPE_FOR_DISASTER_'.length);
      const quests = getQuests();
      const quest = quests.find(q => q.key === 'recipe_for_disaster');
      if (!quest) throw new Error('Missing registered Recipe for Disaster quest');
      const stage = quest.getStage(player);
      const attr = name => {
        const key = name === 'quest.points' ? name : PREFIX + name;
        if (!OWNED_ATTRIBUTES.includes(key)) throw new Error(`Unowned RFD attribute: ${key}`);
        return player.getAttribute(key);
      };
      const number = name => Number(attr(name)) || 0;
      const flags = number('rescues');
      const inv = player.getInventory();
      const eq = player.getEquipment();
      const has = (id, amount = 1) => inv.getAmount(id) >= amount;
      const any = ids => ids.some(id => has(id));
      const location = player.getLocation();
      const x = location.getX(), y = location.getY(), plane = location.getZ();
      const at = (minX, maxX, minY, maxY, z = 0) => plane === z && x >= minX && x <= maxX && y >= minY && y <= maxY;
      const npc = (ids, tx, ty, z = 0) => ({kind: 'npc', id: Array.isArray(ids) ? ids[0] : ids,
        ...(Array.isArray(ids) ? {ids} : {}), ...(tx === undefined ? {} : {x: tx, y: ty, plane: z})});
      const object = (ids, tx, ty, z = 0) => ({kind: 'object', id: Array.isArray(ids) ? ids[0] : ids,
        ...(Array.isArray(ids) ? {ids} : {}), ...(tx === undefined ? {} : {x: tx, y: ty, plane: z})});
      const item = id => ({kind: 'item', id});
      const tile = (tx, ty, z = 0) => ({kind: 'tile', x: tx, y: ty, plane: z});
      const cook = () => npc([N.COOK, N.COOK_2, N.COOK_3, N.COOK_4, N.COOK_5, N.COOK_6, N.COOK_7, N.COOK_8], 3209, 3215);
      const aris = () => npc([N.ARIS_2, N.ARIS_3], 3240, 3220);
      const requirements = [];
      const need = (name, met, ids, quantity) => {
        const r = {name, met: Boolean(met)};
        if (ids) r.ids = ids;
        if (quantity !== undefined) r.quantity = quantity;
        requirements.push(r);
        return r.met;
      };
      const ingredient = (name, id, amount = 1) => need(name, has(id, amount), [id], amount);
      const skill = (name, level) => {
        const skillId = core.Skill[name.toUpperCase()];
        const actual = player.getSkillManager().getCurrentLevel(skillId);
        if (!Number.isFinite(actual)) throw new Error(`Missing current ${name} level`);
        return need(`${name} ${level}`, actual >= level);
      };
      const completed = key => quests.find(q => q.key === key)?.isComplete(player) === true;
      const needsQuest = key => need('Complete ' + key.replaceAll('_', ' '), completed(key));
      const points = n => need(`${n} quest points`, number('quest.points') >= n);
      const equipped = (slot, ids) => ids.includes(eq.get(slot)?.getId?.());
      const speech = () => {
        const ids = [I.MSPEAK_AMULET, I.MSPEAK_AMULET_2, I.MSPEAK_AMULET_3, I.MSPEAK_AMULET_4];
        return need("M'speak amulet carried or worn", any(ids) || equipped(core.Equipment.AMULET_SLOT, ids), ids);
      };
      const step = (id, text, targets, choices = []) => {
        response.activeStep = {id, text: Array.isArray(text) ? text : [text], targets,
          requirements, dialogueChoices: choices.map(text => ({text})), widgets: [], overlays: []};
        response.panels = [{title: 'Recipe for Disaster', text: [part.replaceAll('_', ' ').toLowerCase()], requirements}];
        return response;
      };
      const complete = () => { response.status = 'complete'; return response; };
      const failedRequirements = () => requirements.some(r => !r.met);

      if (quest.isComplete(player) || stage >= 5) return complete();
      const rescue = rescueRows.find(r => r[0] === part);
      if (rescue && (flags & rescue[1])) return complete();
      if (part === 'START') {
        if (stage >= 4) return complete();
        needsQuest('cooks_assistant'); skill('Cooking', 10);
        if (stage === 0) return step('opening-start', 'Speak to the Cook in Lumbridge Castle about preparing the banquet. Finish Cook\'s Assistant and meet the Cooking requirement first.', [cook()]);
        ingredient('Eye of newt', I.EYE_OF_NEWT); ingredient("Greenman's ale", I.GREENMANS_ALE);
        ingredient('Rotten tomato', I.ROTTEN_TOMATO); ingredient('Dirty blast', I.DIRTY_BLAST);
        if (has(I.DIRTY_BLAST) && has(I.EYE_OF_NEWT) && has(I.GREENMANS_ALE) && has(I.ROTTEN_TOMATO))
          return step('opening-handover', 'Talk to the Cook with all four ingredients and continue the banquet dialogue. The server opens the council rescues when he accepts them.', [cook()], ['About those ingredients you wanted for the banquet...']);
        if (!has(I.DIRTY_BLAST)) {
          ingredient('Fruit blast', I.FRUIT_BLAST); ingredient('Ashes', I.ASHES);
          return step('opening-dirty-blast', 'Use ashes on a fruit blast to make a dirty blast. Bring it, an eye of newt, a Greenman\'s ale and a rotten tomato to the Cook.', [item(I.FRUIT_BLAST), item(I.ASHES), cook()]);
        }
        return step('opening-ingredients', 'Gather the missing banquet ingredients shown below, then talk to the Lumbridge Cook.', [cook()]);
      }
      if (stage < 4) return step('opening-required', 'Complete the Cook\'s opening banquet task before starting this part of Recipe for Disaster.', [cook()]);

      // These are the server's rescueRequirement checks, not RuneLite's broader
      // historical prerequisites. Current (including boosted) levels are used.
      if (rescue) {
        switch (rescue[1]) {
          case 1: needsQuest('fishing_contest'); break;
          case 2: needsQuest('goblin_diplomacy'); break;
          case 4: skill('Cooking', 31); break;
          case 8:
            skill('Cooking', 40);
            ['big_chompy_bird_hunting', 'biohazard', 'demon_slayer', 'murder_mystery', 'nature_spirit', 'witchs_house'].forEach(needsQuest); break;
          case 16: skill('Cooking', 25); ['gertrudes_cat', 'shadow_of_the_storm'].forEach(needsQuest); break;
          case 32: skill('Cooking', 41); skill('Firemaking', 20); needsQuest('big_chompy_bird_hunting'); break;
          case 64:
            points(107);
            ['family_crest', 'heroes_quest', 'lost_city', 'merlins_crystal', 'shield_of_arrav', 'dragon_slayer_i', 'shilo_village', 'jungle_potion', 'druidic_ritual', 'underground_pass', 'biohazard', 'plague_city', 'waterfall_quest'].forEach(needsQuest);
            need("Legends' Quest: Kharazi access (stage 5)", (quests.find(q => q.key === 'legends_quest')?.getStage(player) ?? 0) >= 5); break;
          case 128: skill('Cooking', 70); skill('Agility', 48); needsQuest('monkey_madness_i'); break;
        }
        if (failedRequirements()) return step('rescue-requirements', `Meet the listed requirements before asking Aris about freeing ${rescue[2]}.`, [aris()]);
        if (has(rescue[4]) && (rescue[1] !== 16 || (number('evil-dave-state') & 4))) {
          if (rescue[1] === 128) speech();
          if ((flags | rescue[1]) === 255) need('One empty inventory slot for the final rescue', inv.getFreeSlots() >= 1);
          return step('rescue-' + part.toLowerCase(), `Use the prepared item on ${rescue[2]} at the actual Lumbridge Castle council. ${rescue[1] === 16 ? 'Use the same spice mixture Dave accepted; if you changed it, test that mixture with him first.' : ''}`.trim(),
            [item(rescue[4]), npc(rescue[3], rescue[5], rescue[6])]);
        }
      }

      if (part === 'DWARF') {
        const state = number('dwarf-state');
        const rohak = () => npc([N.OLD_DWARF, N.ROHAK, N.ROHAK_2, 4810, 6254, 6255]);
        if (has(I.DWARVEN_ROCK_CAKE)) {
          const gloves = need('Ice gloves worn', equipped(core.Equipment.HANDS_SLOT, [I.ICE_GLOVES]), [I.ICE_GLOVES]);
          return step('dwarf-cool', gloves ? 'Use the hot rock cake on the Mountain Dwarf while wearing ice gloves. This cools it; use the cooled cake on him again to free him.' : 'Wear ice gloves and use the hot rock cake on the Mountain Dwarf, or kill an icefiend while carrying it.', [item(I.DWARVEN_ROCK_CAKE), item(I.ICE_GLOVES), npc(N.MOUNTAIN_DWARF,3236,3219), npc([N.ICEFIEND,N.ICEFIEND_2,N.ICEFIEND_3])]);
        }
        if (state & 0x800) {
          [['Bowl of water', I.BOWL_OF_WATER], ['Egg', I.EGG], ['Pot of flour', I.POT_OF_FLOUR], ['Bucket of milk', I.BUCKET_OF_MILK]].forEach(([name,id]) => ingredient(name,id));
          return step('dwarf-cake', 'Bring Rohak another bowl of water, egg, flour and milk to replace the lost hot rock cake. Then cool the cake with ice gloves or an icefiend.', [rohak()]);
        }
        if (state & 0x400) {
          [['Bowl of water', I.BOWL_OF_WATER], ['Egg', I.EGG], ['Pot of flour', I.POT_OF_FLOUR], ['Bucket of milk', I.BUCKET_OF_MILK]].forEach(([name,id]) => ingredient(name,id));
          return step('dwarf-ingredients', 'Bring Rohak the bowl of water, egg, flour and milk. Continue speaking to him until he gives you the hot rock cake.', [rohak()]);
        }
        if (state & 0x200) return step('dwarf-sober', 'Talk to the sober Rohak again about the rock cake recipe.', [rohak()]);
        if ((state & 7) >= 4) return step('dwarf-drunk', 'Continue talking to Rohak after giving him four asgoldian ales. His next conversations advance the recipe.', [rohak()]);
        if ((state & 16) || (state & 7) || has(I.ASGOLDIAN_ALE)) {
          ingredient('Asgoldian ales still needed', I.ASGOLDIAN_ALE, Math.max(0, 4 - (state & 7)));
          return step('dwarf-ale', `Give Rohak ${Math.max(0, 4 - (state & 7))} more asgoldian ale(s). Make each by using a coin on an Asgarnian ale.`, [rohak(), item(I.ASGARNIAN_ALE), item(I.COINS)]);
        }
        return step('dwarf-rohak', 'Ask Aris about the Mountain Dwarf, then talk to Rohak below White Wolf Mountain. Ask a Falador bartender how dwarves and ale work, pay for the information, and prepare four asgoldian ales.', [rohak(), npc([N.EMILY, N.KAYLEE, N.TINA, N.TINA_2]), aris()]);
      }

      if (part === 'WARTFACE_AND_BENTNOZE') {
        const goblin = () => npc([N.GOBLIN_COOK, N.GOBLIN_COOK_2, N.GOBLIN_COOK_3]);
        if (!(number('goblin-state') & 2)) {
          ingredient('Charcoal', I.CHARCOAL);
          return step('goblin-charcoal', 'Talk to the goblin cook in the Goblin Village cellar. Bring charcoal and give it to him, or use it on the cauldron. The cellar entrance is the ladder at 2960,3507.', [goblin(), object(12389,2960,3507), item(I.CHARCOAL)]);
        }
        if (!has(I.SOGGY_BREAD)) {
          ingredient('Bread',I.BREAD); ingredient('Bucket of water',I.BUCKET_OF_WATER);
          return step('goblin-bread', 'Use a bucket of water on bread to make soggy bread.', [item(I.BREAD),item(I.BUCKET_OF_WATER)]);
        }
        if (!has(I.DYED_ORANGE)) {
          if (!has(I.ORANGE_SLICES)) {
            ingredient('Orange',I.ORANGE); ingredient('Knife',I.KNIFE);
            return step('goblin-orange', 'Use a knife on an orange to make orange slices.', [item(I.ORANGE),item(I.KNIFE)]);
          }
          const dyes = [I.BLUE_DYE,I.BLACK_DYE,I.GREEN_DYE,I.PURPLE_DYE];
          need('Blue, black, green or purple dye',any(dyes),dyes);
          return step('goblin-dye', 'Use blue, black, green or purple dye on the orange slices.', [item(I.ORANGE_SLICES),...dyes.map(item)]);
        }
        if (!has(I.SPICY_MAGGOTS)) {
          ingredient('Fishing bait',I.FISHING_BAIT); need('Spice or gnome spice',any([I.SPICE,I.GNOME_SPICE]),[I.SPICE,I.GNOME_SPICE]);
          return step('goblin-spice', 'Use spice or gnome spice on fishing bait to make spicy maggots.', [item(I.FISHING_BAIT),item(I.SPICE),item(I.GNOME_SPICE)]);
        }
        return step('goblin-slop', 'Talk to the burnt goblin cook with soggy bread, dyed orange and spicy maggots to receive the slop of compromise.', [goblin()]);
      }

      if (part === 'PIRATE_PETE') {
        const state = number('pirate-state');
        const murphy = () => npc([N.MURPHY,N.MURPHY_2,N.MURPHY_3,N.MURPHY_4],2668,3162);
        const nung = () => npc(N.NUNG);
        if (!(state & 16)) return step('pete-aris', 'Talk to Aris at the Lumbridge council and choose to free Pirate Pete. Then speak to the Cook about the fishcake.', [aris(),cook()]);
        if (has(I.RAW_FISHCAKE)) return step('pete-cook-cake', 'Use the raw fishcake on a cooking range, then use the cooked fishcake on Pirate Pete at the council.', [item(I.RAW_FISHCAKE),object(cookedRanges())]);
        const pieces = [I.GROUND_COD,I.GROUND_KELP,I.GROUND_GIANT_CRAB_MEAT,I.BREADCRUMBS];
        if (pieces.every(id => has(id))) return step('pete-mix', 'Use any two prepared ingredients together while carrying ground cod, ground kelp, ground giant crab meat and breadcrumbs to make the raw fishcake.', pieces.map(item));
        if (state & 8) {
          if ((has(I.KELP)||has(I.GROUND_KELP)) && (has(I.GIANT_CRAB_MEAT)||has(I.GROUND_GIANT_CRAB_MEAT))) {
            if (at(2938,3002,9470,9540,1) || (state & 4)) return step('pete-surface', 'Drop all underwater rocks before climbing an anchor to surface. Keep the kelp and crab meat.', [object([O.ANCHOR_4,O.ANCHOR_5,O.ANCHOR_6,O.ANCHOR_7]),item(I.ROCK_7)]);
            for (const [raw,tool,result,label] of [[I.GIANT_CRAB_MEAT,I.PESTLE_AND_MORTAR,I.GROUND_GIANT_CRAB_MEAT,'crab meat'],[I.KELP,I.PESTLE_AND_MORTAR,I.GROUND_KELP,'kelp'],[I.RAW_COD,I.PESTLE_AND_MORTAR,I.GROUND_COD,'raw cod'],[I.BREAD,I.KNIFE,I.BREADCRUMBS,'bread']]) {
              if (!has(result)) { ingredient(label,raw); ingredient('Preparation tool',tool); return step('pete-grind-'+raw,`Use the ${tool===I.KNIFE?'knife':'pestle and mortar'} on ${label}. Keep all four prepared ingredients for the fishcake.`,[item(raw),item(tool)]); }
            }
          }
        }
        if (!(state & 1)) return step('pete-cook', 'Speak to the Cook about the fishcake, then talk to Murphy at Port Khazard and choose Recipe for Disaster.', [cook(),murphy()],['Talk about Recipe for Disaster.']);
        if (!(state & 2)) { ingredient('Empty fishbowl',I.EMPTY_FISHBOWL); return step('pete-gear', 'Bring Murphy an empty fishbowl and room for diving gear. Continue his Recipe for Disaster dialogue to receive the fishbowl helmet and diving apparatus.',[murphy()]); }
        if (!(state & 4) && !at(2938,3002,9470,9540,1)) {
          need('Fishbowl helmet worn',equipped(core.Equipment.HEAD_SLOT,[I.FISHBOWL_HELMET]),[I.FISHBOWL_HELMET]);
          need('Diving apparatus worn',equipped(core.Equipment.CAPE_SLOT,[I.DIVING_APPARATUS]),[I.DIVING_APPARATUS]);
          need('Seven free inventory slots',inv.getFreeSlots()>=7);
          return step('pete-dive','Wear the fishbowl helmet and diving apparatus. Keep weight below 28 kg, leave seven inventory slots free, put away pets, and ask Murphy to dive.',[murphy()]);
        }
        if (!has(I.KELP)&&!has(I.GROUND_KELP)) return step('pete-kelp','Pick kelp underwater before preparing the fishcake.',[object([O.KELP,O.KELP_2])]);
        if (!has(I.ROCK_7,5)) { ingredient('Underwater rocks',I.ROCK_7,5); return step('pete-rocks','Take five rocks from the underwater rock piles to cross the current and enter the mudskipper cave.',[object([O.PILE_OF_ROCK_5,O.PILE_OF_ROCK_6,O.PILE_OF_ROCK_7,O.PILE_OF_ROCK_8],2946,9515,1)]); }
        if (number('pirate-hides-given') < 5) {
          const remaining = Math.max(0,5-number('pirate-hides-given'));
          return step('pete-hides',`Enter the mudskipper cavern with five rocks. Kill mudskippers, then use ${remaining} more hide(s) on Nung, one at a time.`,[object([O.UNDERWATER_CAVERN_ENTRANCE,O.UNDERWATER_CAVERN_ENTRANCE_2,O.UNDERWATER_CAVERN_ENTRANCE_3,O.UNDERWATER_CAVERN_ENTRANCE_4]),npc(N.MUDSKIPPER),nung()]);
        }
        if (!(state & 8)) { ingredient('Needle',I.NEEDLE); ingredient('Bronze wire',I.BRONZE_WIRE,3); return step('pete-wire','Use a needle on Nung while carrying three bronze wires to repair access to the crab pen.',[nung(),item(I.NEEDLE)]); }
        return step('pete-crab','Open the crab pen with five rocks and kill a giant crab for its meat. Keep kelp as well, then surface to prepare the fishcake.',[object([O.PEN_DOOR,O.PEN_DOOR_2]),npc([N.CRAB_3,N.CRAB_4])]);
      }

      if (part === 'LUMBRIDGE_GUIDE') {
        const quiz = visibleQuiz(request.snapshot?.widgets);
        if (quiz) {
          const result=step('guide-quiz',[quiz.question,'Choose: '+quiz.answer],[npc([N.WIZARD_TRAIBORN,N.WIZARD_TRAIBORN_2])],[quiz.answer]);
          if(Number.isInteger(quiz.id))result.activeStep.widgets.push({id:quiz.id,label:quiz.question});
          return result;
        }
        if (has(I.RAW_GUIDE_CAKE)) return step('guide-bake','Use the raw Cake of Guidance on a cooking range.',[item(I.RAW_GUIDE_CAKE),object(cookedRanges())]);
        const ingredients = [[I.EGG,I.ENCHANTED_EGG,'egg'],[I.BUCKET_OF_MILK,I.ENCHANTED_MILK,'milk'],[I.POT_OF_FLOUR,I.ENCHANTED_FLOUR,'flour']];
        number('guide-state'); // Saved enchantment history is not proof of possession.
        if (ingredients.every(([,id])=>has(id)) && has(I.CAKE_TIN)) return step('guide-mix','Use the enchanted ingredients together while carrying a cake tin to make the raw Cake of Guidance.',ingredients.map(([,id])=>item(id)).concat(item(I.CAKE_TIN)));
        for(const[plain,enchanted,name]of ingredients)need('Enchanted '+name,has(enchanted),[enchanted]);
        ingredient('Cake tin',I.CAKE_TIN);
        return step('guide-enchant','Bring an egg, a bucket of milk and flour to Wizard Traiborn upstairs in the Wizards\' Tower. Speak to him and answer three questions for each missing enchantment. Lost enchanted ingredients must be replaced. Carry a cake tin to combine all three.',[npc([N.WIZARD_TRAIBORN,N.WIZARD_TRAIBORN_2]),...ingredients.filter(([,id])=>!has(id)).map(([id])=>item(id))]);
      }

      if (part === 'EVIL_DAVE') {
        const state=number('evil-dave-state');
        const dave=()=>npc([N.EVIL_DAVE,N.EVIL_DAVE_2,N.EVIL_DAVE_3]);
        if(!(state&1))return step('dave-talk','Talk to Evil Dave in the Edgeville basement and ask what he ate at the secret council meeting.',[dave()],['What did you eat at the secret council meeting?']);
        if(!(state&2))return step('dave-doris','Talk to Doris upstairs after learning what Dave ate. Then bring a non-overgrown cat to catch hell-rats for spices.',[npc([N.DORIS])]);
        const doses=attr('evil-dave-stew')?.doses;
        const known = doses && typeof doses==='object' ? Object.entries(doses).filter(([color,n])=>['red','orange','brown','yellow'].includes(color)&&Number.isFinite(n)).map(([color,n])=>`${color}: ${n}`).join(', ') : '';
        if(has(I.SPICY_STEW))return step('dave-taste',`Use your spicy stew on Dave in Edgeville to test it. Adjust one spice at a time using his feedback. ${known?'Current stew doses: '+known+'.':''}`.trim(),[dave(),item(I.SPICY_STEW)]);
        if(state&4)return step('dave-repeat','Dave accepted a recipe and consumed the tasting stew. Recreate the same accepted doses in another stew, then take it to the council. If you changed the mix, test it with Dave again.',[item(I.STEW),dave()]);
        return step('dave-spices','Have your cat catch hell-rats in Dave\'s basement. Add red, orange, brown and yellow spices to stew; use each test stew on Dave and adjust the mixture from his feedback. Spice doses come from the bottle used, up to four doses per colour.',[npc(N.HELL_RAT),item(I.STEW),dave()]);
      }

      if (part === 'SKRACH_UGLOGWEE') {
        const state=number('skrach-state');
        const rantz=()=>npc([N.RANTZ,N.RANTZ_2,N.RANTZ_3,N.RANTZ_4,N.RANTZ_5,1470]);
        if(!(state&1))return step('skrach-rantz','Talk to Rantz in the Feldip Hills about helping Skrach and continue until he explains the boat and jubbly hunt.',[rantz()]);
        if(has(I.SKEWERED_CHOMPY))return step('skrach-cook-chompy','Cook the skewered chompy on a fire on the Karamja beach to signal the ogre boat. Keep the cooked chompy for the return trip.',[item(I.SKEWERED_CHOMPY),object([O.FIRE,O.FIRE_2,O.FIRE_3])]);
        if(!(state&2))return step('skrach-tree','Use an axe on the large tree at 2652,2960 to trim the log roots.',[object(10819,2652,2960)]);
        if(!(state&4))return step('skrach-hollow','Use an axe on the tree/log at 2652,2960 again to hollow out the boat, then speak to Rantz.',[object(10819,2652,2960),rantz()]);
        if(!(state&8)){
          if(state&16)return step('skrach-return','Board the ogre boat from Karamja after cooking the chompy. Bring a cooked chompy; continue the return dialogue, then speak to Rantz.',[npc([4858,6261]),item(I.COOKED_CHOMPY)]);
          return step('skrach-chompy','Talk to Rantz after hollowing the boat. Travel to Karamja, use an iron spit on a raw chompy and cook it on a beach fire to signal the return boat.',[rantz(),npc([4858,4859,6260,6261]),item(I.RAW_CHOMPY),item(I.IRON_SPIT)]);
        }
        if(has(I.RAW_JUBBLY))return step('skrach-cook-jubbly','Cook the raw jubbly on the ogre spit roast. If it burns, hunt another; use the cooked jubbly on Skrach at the council.',[item(I.RAW_JUBBLY),object(O.OGRE_SPIT_ROAST_4,2632,2985)]);
        const ground=(request.snapshot?.groundItems||[]).find(i=>i.id===I.RAW_JUBBLY&&i.quantity>0&&i.plane===plane);
        if(ground)return step('skrach-loot','Pick up the raw jubbly meat, then cook it on the ogre spit roast.',[{kind:'item',id:I.RAW_JUBBLY,x:ground.x,y:ground.y,plane:ground.plane}]);
        const bird=(request.snapshot?.npcs||[]).find(n=>[N.JUBBLY_BIRD,N.JUBBLY_BIRD_2,N.JUBBLY_BIRD_3].includes(n.id)&&n.plane===plane);
        if(bird){need('Ogre bow or comp ogre bow equipped',equipped(core.Equipment.WEAPON_SLOT,[I.OGRE_BOW,I.COMP_OGRE_BOW]),[I.OGRE_BOW,I.COMP_OGRE_BOW]);need('Ogre arrows equipped',equipped(core.Equipment.AMMUNITION_SLOT,[I.OGRE_ARROW]),[I.OGRE_ARROW]);return step('skrach-hunt','Kill the attracted Jubbly bird using an ogre bow and ogre arrows. Collect its raw meat.',[npc([N.JUBBLY_BIRD,N.JUBBLY_BIRD_2,N.JUBBLY_BIRD_3],bird.x,bird.y,bird.plane)]);}
        if(has(I.BALLOON_TOAD))return step('skrach-drop','Drop the balloon toad near Rantz\'s cave or the Feldip chompy grounds (2510–2670,2890–3050). Kill the attracted Jubbly bird and collect its raw meat.',[item(I.BALLOON_TOAD),npc(N.JUBBLY_BIRD),tile(2632,2985)]);
        if(has(I.BLOATED_TOAD)){ingredient('Rock',I.ROCK);ingredient('Ball of wool',I.BALL_OF_WOOL);return step('skrach-balloon','Use filled ogre bellows on the bloated toad while carrying a rock and a ball of wool to make a balloon toad.',[item(I.BLOATED_TOAD),item(I.OGRE_BELLOWS_3_),item(I.ROCK),item(I.BALL_OF_WOOL)]);}
        if(any([I.OGRE_BELLOWS_3_,I.OGRE_BELLOWS_2_,I.OGRE_BELLOWS_1_]))return step('skrach-toad','Use filled ogre bellows on a swamp toad to obtain a bloated toad. Bring a rock and ball of wool for the balloon.',[npc(N.SWAMP_TOAD),item(I.OGRE_BELLOWS_3_)]);
        return step('skrach-bellows','Fill ogre bellows at swamp bubbles, then use them on a swamp toad. Bring a rock and ball of wool for the balloon toad.',[object([O.SWAMP_BUBBLES,O.SWAMP_BUBBLES_2,O.SWAMP_BUBBLES_3,O.SWAMP_BUBBLES_4]),item(I.OGRE_BELLOWS)]);
      }

      if (part === 'SIR_AMIK_VARZE') {
        if(number('amik-state')!==1)return step('amik-aris','Talk to Aris at the Lumbridge council and choose to free Sir Amik Varze. Then ask the Wise Old Man about the Evil Chicken lair.',[aris(),npc([N.WISE_OLD_MAN,N.WISE_OLD_MAN_2,N.WISE_OLD_MAN_3])]);
        if(has(I.BRULEE_3)){
          if(has(I.DRAGON_TOKEN)){need('Ice gloves worn',equipped(core.Equipment.HANDS_SLOT,[I.ICE_GLOVES]),[I.ICE_GLOVES]);return step('amik-flambe','Wear ice gloves, rub the dragon token in Lumbridge or Zanaris, then talk to K\'klik while carrying the brulee to have it flambéed.',[item(I.DRAGON_TOKEN),npc(N.KKLIK),tile(3235,3219)]);}
          return step('amik-token','Kill a black dragon while carrying the cinnamon brulee to obtain a dragon token. Rub the token in Lumbridge or Zanaris and talk to K\'klik.',[npc([N.BLACK_DRAGON,N.BLACK_DRAGON_2,N.BLACK_DRAGON_3,N.BLACK_DRAGON_4]),item(I.BRULEE_3)]);
        }
        if(has(I.BRULEE_2)) {ingredient('Cinnamon',I.CINNAMON);return step('amik-cinnamon','Grind a dramen branch with a pestle and mortar for cinnamon, then add the cinnamon to the egg brulee.',[item(I.DRAMEN_BRANCH),item(I.PESTLE_AND_MORTAR),item(I.BRULEE_2)]);}
        if(has(I.BRULEE)){
          if(has(I.EVIL_CHICKENS_EGG))return step('amik-add-egg','Use the Evil Chicken\'s egg on the brulee.',[item(I.EVIL_CHICKENS_EGG),item(I.BRULEE)]);
          return step('amik-egg','Use a raw chicken on the chicken shrine in Zanaris. Kill the Evil Chicken in its lair (2455,4399) and collect its egg; add the egg to your brulee.',[object(O.CHICKEN_SHRINE),npc([N.EVIL_CHICKEN,N.EVIL_CHICKEN_2,N.EVIL_CHICKEN_3],2455,4399),item(I.RAW_CHICKEN)]);
        }
        if(has(I.CORNFLOUR_MIXTURE)){ingredient('Vanilla pod',I.VANILLA_POD);return step('amik-vanilla','Pick a vanilla pod from a vanilla plant and add it to the cornflour mixture.',[object(O.VANILLA_PLANT),item(I.CORNFLOUR_MIXTURE)]);}
        if(has(I.MILKY_MIXTURE)){ingredient('Pot of cornflour',I.POT_OF_CORNFLOUR);return step('amik-cornflour','Add a pot of cornflour to the milky mixture.',[item(I.POT_OF_CORNFLOUR),item(I.MILKY_MIXTURE)]);}
        ingredient('Bucket of milk',I.BUCKET_OF_MILK); ingredient('Pot of cream',I.POT_OF_CREAM);
        return step('amik-milk','Combine a bucket of milk and a pot of cream. Keep one empty inventory slot for each recipe combination. Ask the Wise Old Man about the Evil Chicken lair if you need directions.',[item(I.BUCKET_OF_MILK),item(I.POT_OF_CREAM),npc([N.WISE_OLD_MAN,N.WISE_OLD_MAN_2])]);
      }

      if (part === 'MONKEY_AMBASSADOR') {
        const state=number('awowogei-state');
        speech();
        const monkeys=()=>npc([N.MIZARU,N.KIKAZARU,N.IWAZARU]);
        if(has(I.RAW_STUFFED_SNAKE)){
          need('Zombie monkey greegree worn',equipped(core.Equipment.WEAPON_SLOT,[I.ZOMBIE_MONKEY_GREEGREE,I.ZOMBIE_MONKEY_GREEGREE_2]));
          if((state&1024)&&at(3050,3062,5478,5492))return step('awowogei-cook','While wearing a zombie monkey greegree, use the raw stuffed snake on the hot rocks in this room. Then use the cooked snake on Awowogei at the council.',[object([16077,16078,16079,16080,26175]),item(I.RAW_STUFFED_SNAKE)]);
          return step('awowogei-dungeon','Wear a zombie monkey greegree and enter the crack (16061) in the Ape Atoll temple dungeon to reach the hot rocks. Cook the snake there.',[object(16061),item(I.RAW_STUFFED_SNAKE)]);
        }
        if(!(state&8))return step('awowogei-king','With an M\'speak amulet, talk to King Awowogei on Ape Atoll. The live King interaction is a mapped object; the council Awowogei in Lumbridge is a separate NPC.',[object([O.AWOWOGEI,O.AWOWOGEI_2,O.AWOWOGEI_3])]);
        if((state&7)!==7)return step('awowogei-monkeys','Talk to all three wise monkeys on Ape Atoll while carrying or wearing an M\'speak amulet.',[monkeys()]);
        if(!(state&16)){ingredient('Banana',I.BANANA);return step('awowogei-banana-offer','Use an ordinary banana on one of the three wise monkeys to learn about the red banana.',[monkeys(),item(I.BANANA)]);}
        if(!(state&32)){ingredient('Monkey nuts',I.MONKEY_NUTS);return step('awowogei-nuts-offer','Use ordinary monkey nuts on one of the three wise monkeys to learn about Tchiki nuts.',[monkeys(),item(I.MONKEY_NUTS)]);}
        if(!has(I.SNAKE_CORPSE))return step('awowogei-snake','Travel to Crash Island, enter the snake pit, kill the Big Snake and collect its corpse.',[npc(N.BIG_SNAKE),item(I.SNAKE_CORPSE)]);
        const preparedFilling=[I.SLICED_RED_BANANA,I.TCHIKI_NUT_PASTE].find(id=>has(id));
        if(preparedFilling){need('One empty inventory slot',inv.getFreeSlots()>=1);return step('awowogei-stuff','Use either filling on the snake corpse: sliced red banana or Tchiki nut paste. One filling is sufficient on this server; you do not need to gather the other.',[item(I.SNAKE_CORPSE),item(preparedFilling)]);}
        if(has(I.RED_BANANA)){ingredient('Knife',I.KNIFE);return step('awowogei-slice','Use a knife on the red banana. Then use the sliced banana on the snake corpse; this filling alone is sufficient.',[item(I.KNIFE),item(I.RED_BANANA)]);}
        if(has(I.TCHIKI_MONKEY_NUTS)){ingredient('Pestle and mortar',I.PESTLE_AND_MORTAR);return step('awowogei-grind','Grind the Tchiki monkey nuts with a pestle and mortar. Then use the paste on the snake corpse; this filling alone is sufficient.',[item(I.TCHIKI_MONKEY_NUTS),item(I.PESTLE_AND_MORTAR)]);}
        if(state&256){
          need('Ninja monkey greegree worn',equipped(core.Equipment.WEAPON_SLOT,[I.NINJA_MONKEY_GREEGREE,I.NINJA_MONKEY_GREEGREE_2,I.NINJA_MONKEY_GREEGREE_3,I.NINJA_MONKEY_GREEGREE_4]));
          if(!(state&512)||!at(3018,3027,5454,5460))return step('awowogei-hole','After swinging across the course rope, enter the hole to reach the Tchiki cave at 3020,5457.',[object(O.HOLE_18)]);
          return step('awowogei-nuts','Pick the Tchiki nut bush in this cave while wearing a ninja monkey greegree. Leave through the exit at 3025,5457.',[object([O.TCHIKI_MONKEY_NUT_BUSH,16059],3020,5457),object(16060,3025,5457)]);
        }
        return step('awowogei-filling-choice','Choose one filling route. Red banana: wear a gorilla greegree, use a rope on the red banana tree, then slice the banana with a knife. Tchiki paste: wear a ninja greegree, put away pets/followers, cross the Ape Atoll course rope, enter its hole, pick Tchiki nuts and grind them. Either prepared filling alone can stuff the snake on this server.',[object([O.RED_BANANA_TREE,O.RED_BANANA_TREE_2,15580]),item(I.ROPE),object(O.ROPE_20),object(O.HOLE_18)]);
      }

      if (part === 'FINALE') {
        if(flags!==255)return step('final-rescues','Free all eight council members before facing the Culinaromancer. Ask Aris about the remaining rescues.',[aris(),...rescueRows.filter(r=>!(flags&r[1])).map(r=>npc(r[3],r[5],r[6]))]);
        points(175);needsQuest('desert_treasure_i');needsQuest('horror_from_the_deep');
        if(failedRequirements())return step('final-requirements','Meet the listed requirements, then talk to Aris at the Lumbridge council about the Culinaromancer.',[aris()]);
        if(attr('culinaromancer-defeated')===true)return step('final-claim','Continue the post-fight dialogue with Aris to claim completion. The server only marks Recipe for Disaster complete after this dialogue.',[npc([N.ARIS,N.ARIS_2,N.ARIS_3])]);
        const wave=number('culinaromancer-wave');
        if(wave===-1)return step('final-enter','Enter the portal at 3209,3218 in Lumbridge Castle to begin the dessert gauntlet. Bring combat supplies; prayer and retreat rules follow the encounter.',[object(O.PORTAL,3209,3218)]);
        if(wave>=1&&wave<=6){
          if(!at(1889,1910,5345,5366,2))return step('final-resume',`Enter the Lumbridge portal to resume dessert wave ${wave}.`,[object(O.PORTAL,3209,3218)]);
          const waves=[
            [[N.AGRITH_NA_NA],'Defeat Agrith Na-Na.'],
            [[N.FLAMBEED],'Wear ice gloves before attacking Flambeed to avoid having your weapon unequipped.'],
            [[N.KARAMEL],'Defeat Karamel; restore drained stats and manage her freeze attacks.'],
            [[N.DESSOURT],'Defeat Dessourt with your combat supplies.'],
            [[4884,4885,4886,4887,4888,4889],'Match the Gelatinnoth Mother\'s current colour: white = air, blue = water, orange = melee, brown = earth, red = fire, green = ranged. She changes every 30 server ticks.'],
            [[N.CULINAROMANCER_9],'Defeat the Culinaromancer, then continue Aris\'s completion dialogue.'],
          ];
          if(wave===2)need('Ice gloves worn',equipped(core.Equipment.HANDS_SLOT,[I.ICE_GLOVES]),[I.ICE_GLOVES]);
          return step('final-wave-'+wave,waves[wave-1][1],[npc(waves[wave-1][0],1900,5355,2)]);
        }
        return step('final-aris','Speak to Aris at the Lumbridge council about defeating the Culinaromancer, and continue until she opens the portal.',[aris()]);
      }
      throw new Error('Unhandled RFD component');
    } catch(error) {
      response.status='unavailable';response.activeStep=null;response.panels=[];
      response.diagnostics=[{code:'RFD_STATE_UNAVAILABLE',message:String(error.message),helper:'tsps-native-rfd-v1'}];
      return response;
    }
  };
}

module.exports={createRfdRenderer,completionProjection,OWNED_ATTRIBUTES,VARIANTS};

