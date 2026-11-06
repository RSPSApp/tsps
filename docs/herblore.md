# Herblore

`server/plugins/skills/Herblore.plugin.js` (members), with one unit per activity in
`server/plugins/skills/herblore/`. Herbs and recipes are data, in
`server/plugins/skills/data/herblore.json`, named by cache gameval.

## Sources

- **Recipes, levels, XP and ticks:** the OSRS Wiki's recipe data (the `recipe` bucket behind each
  item's Creation section, https://oldschool.runescape.wiki/w/Herblore and the potion pages).
  The cache has no recipe table, and nothing in it holds XP.
- **Levels:** also checked against the cache's own skill guide (dbtable 213
  `skill_feature_herblore_*`) by `tests/herblore.test.cjs`.
- **Messages, animation, sounds and timing:** rsprox captures (https://rsprox.net/database).
  Normal-world recordings: 239, 3140, 4098, 4100, 4213 (rev 227-238). Many Herblore recordings are
  Leagues worlds, where potions come out with 4 doses; they were used for message text only.

## Cleaning

Recording 4213; the level message is from recordings 1757 and 1835.

- **Clean** swaps the grimy herb for the clean one in the same slot. There is no delay: several
  clicks in one tick each clean a herb.
- **Sound:** one of synth 3920, 3921, 3922 or 3923, picked at random.
- **Message:** "You clean the Grimy ranarr weed." (spam filter), naming the grimy herb.
- **Below the level:** "You need level 25 Herblore to clean the Grimy ranarr weed."
- **XP** is the Wiki's: guam 2.5 up to torstol 15. Huasca, toadflax, snapdragon and lantadyme are
  included.

## Mixing

- **Unfinished potions** give no XP (111 captured makes, no XP drop). The message names the herb
  in title case: "You put the Ranarr Weed into the vial of water."; the vial of blood one is
  "You put the Cadantine into the vial of blood.". Corals keep their case ("Pillar coral").
- **Finished potions:** "You mix the snape grass into your potion." Each secondary has its own
  wording ("the eggs", "the wine", "the Mort Myre fungi", "the dragon scale", "the unicorn horn"
  for antipoison); blood potions say "into your blood potion"; the Sailing potions say "into the
  potion" (haddock eye, rainbow crab paste).
- **Animation and sound:** `human_herbing_vial` (363) and synth 2608 with every step.
  `Sound.POTION_MIX` (2611), which the old plugin used, is not it.
- **Below the level:** "You need a Herblore level of 38 to combine those." (captured).
- **Herblore cape:** a grimy herb goes straight into a vial of water. Recording 3140 shows both
  messages, "You clean the Grimy marrentill." then "You put the Marrentill into the vial of
  water.", with the cleaning XP and no animation or sound.

### Make-X and timing

Recordings 239, 3140, 4098, 4100, 4213. Using one ingredient on the other opens the skillmulti
menu in the chatbox: clientscript 2046 (`skillmulti_setup`) with first argument 0, the title "How
many do you wish to make?" and the product, and the most the inventory makes as both the limit and
the amount it opens on. With only one to make there is no menu. Amylase into a super energy and
crushed crystal into a combat potion (stamina and divine potions, `"menu": "upgrade"` in
`herblore.json`) open mode 15 instead, "How many would you like to upgrade?", showing the potion
being upgraded (recordings 1108, 1863). Yellow fin and marlin scales keep the make menu
(recording 4103).

Ticks count from the click in the menu:

| Tick | Captured |
| --- | --- |
| 0 | the menu closes; `human_herbing_vial` and synth 2608, no product yet |
| 1 | the first product, with the animation, the sound and the message |
| then | one more every 1 tick (unfinished potions), 2 ticks (potions) or 3 ticks (forgotten brew, extended anti-venom+), each with the animation and sound |

The Herblore cape's grimy herbs (recording 3140) start on tick 0 and go every tick. The Wiki's
recipe data gives the same ticks per recipe.

### Potions made from potions

The Wiki's recipes, one row per dose where the dose count matters:

- **One secondary per dose:** stamina (amylase), extended antifire and extended super antifire
  (lava scale shards), extended stamina (marlin scales), extreme energy (yellow fin), the divine
  potions (crystal dust), extended anti-venom+ (araxyte venom sac). Anti-venom takes 5 Zulrah's
  scales per dose, forgotten brew 20 ancient essence. The message counts them: "You mix 4
  crystals of amylase into your potion.", "You mix 4 pieces of crushed crystal into your potion.",
  "You mix 4 lava scale shards into your potion." (captured).
- **Four-dose only:** super combat (super attack, strength and defence (4) with a torstol or torstol
  potion (unf); captured: "You carefully mix the potions and torstol together.", the attack and
  strength potions leave empty vials), super antifire (crushed superior dragon bones, captured
  message), anti-venom+ (torstol).
- **Sanfew serum** in three steps, each its own XP (Wiki): unicorn horn dust into a super restore,
  then snake weed, then a nail beast nail: "You mix the nail beast nail into your potion and make a
  3-dose Sanfew Serum." (captured).
- **Below the level:** "You need level 77 Herblore to upgrade the potion." (captured).
- **Short of an ingredient:** a mesbox listing what the potion takes, "You don't have the right
  ingredients: 1 x Anti-venom+(4) 4 x Araxyte venom sac" (recording 1438, one sac on an
  anti-venom+(4); live's rev 224 still called it "sack"). The same goes for super combat
  without all three potions.
- **Quests (Wiki):** super antifire and extended super antifire need Dragon Slayer II, with the
  captured "You don't know how to make super antifire potions yet. Maybe someone can teach you.";
  the divine potions need Song of the Elves; the sanfew steps need Zogre Flesh Eaters started, the
  last one finished. Those other refusals have no capture and say "Nothing interesting happens."

### Sanfew serum manual production

The [Sanfew serum Creation section](https://oldschool.runescape.wiki/w/Sanfew_serum%283%29)
specifies manual, one-at-a-time mixing for every step, with no Make-X menu. All four dose
counts use that path, even with enough ingredients for several mixtures. Each click consumes
one base and one secondary, retains the base's dose count, and awards only that step's XP.
The recipe data marks these steps `manual`; ordinary potions retain their Make-X loop.

| Doses | Horn dust → step 1 XP | Snake weed → step 2 XP | Nails → serum XP | Total XP |
| --- | --- | --- | --- | --- |
| 1 | 28.5 | 31.5 | 36 | 96 |
| 2 | 38 | 42 | 48 | 128 |
| 3 | 47.5 | 52.5 | 60 | 160 |
| 4 | 57 | 63 | 72 | 192 |

Rsprox recordings **1148 and 1875** show the three mixing messages, animation
`human_herbing_vial` and sound 2608. Both are Leagues recordings: they corroborate presentation,
while the Wiki establishes normal-world manual production, ingredients and XP. Their saved
secondaries and accelerated production are not evidence for normal-world consumption or speed.

Recording **1875** also shows horn dust used on Mixture - step 1(4) being refused with
“I've already used this item in the mixture. I don't need to use it again.” This refusal applies
to the step-1 dose variants in either item-use direction, without consuming anything, granting XP,
or playing the mixing animation or sound. `repeatMessage` on a recipe describes its secondary
used again on its product. No other repeat-ingredient refusals are inferred from this recording.

Regression coverage exercises all three steps and all dose counts in both directions, including
spare ingredients, no automatic continuation, XP, animation, sound, repeat-horn refusal and the
existing level/quest gates. In-game verification covers the three four-dose steps, one result per
click with spare ingredients, the repeat-horn refusal, XP totals, and ordinary potion Make-X.
There is no normal-world Sanfew mixing recording in the indexed captures consulted here.

### Barbarian mixes

Barbarian Training's Herblore section (`server/plugins/npcs/BarbarianTraining.plugin.js`). A
two-dose potion with roe or caviar makes a two-dose mix. The 29 rows in `herblore.json` come from the
Wiki's mix table on its Barbarian Training page: level, XP, and roe only for the attack,
antipoison, Relicym's, strength and restore mixes, with caviar for every mix. Each row has an
`unlock`, which `Common.unlocked` asks about through `"herblore:unlocked"`:

- `barbarian_herblore:started` (the attack mix): once Otto has asked for one.
- `barbarian_herblore` (every other mix): once the attack mix has been handed to him.

Without it, the pair says "Nothing interesting happens.", like any pair that makes nothing. Live's
refusal is not captured.

Recording 1533 (rev 224): "You combine your potion with the fish eggs." (spam), the usual
`human_herbing_vial` and synth 2608, and 8 XP for the attack mix, made at once from the one pair.
The first attack mix also shows a message box, "You feel you have learned more of barbarian ways.
Otto might wish to talk to you more." Mixes are `manual`, one per use. The Wiki's changelog adds an
optional Make-All setting (May 2024), which is not here. Caviar uses the same message, which has
not been captured for caviar.

## Grinding

A pestle and mortar on a secondary; no Herblore level or XP. Recordings 70 and 1875 (unicorn
horn), 468 (anchovies, the same loop), 1849 (bird nest); the other messages are from the capture
archive's message log.

- **Timing:** at once, two ticks later, then every three ticks until none are left or the player
  does something else (also the Wiki's "0, then 2, then 3 ticks").
- **Animation and sound:** `human_herbing_grind` (364) with synth 2608.
- **Messages:** "You grind the unicorn horn to dust.", "You grind the chocolate to dust.", "You
  grind the bird's nest down.", "You grind down the blue dragon scale.", "You grind the goat's
  horn into dust.", "You grind down the superior dragon bones.", "You grind the lava dragon scale
  into 5 shards.", "You crush your crystal shards down to a powdery form."
- **Lava scale (Wiki):** 3 to 6 shards, and half as many again, rounded down, with the hard
  Wilderness Diary. The Wiki says higher levels average more; with no formula, tsps rolls evenly.
- **Crystal shards:** recording 1618 opens "How many shards would you like to crush? (0 - 5)"
  without changing inventory. Entering 5 produces 50 dust, the grind animation and sound,
  and "You crush your crystal shards down to a powdery form." Recordings 3274 and 1107
  show "You crush some of your crystal shards down to a powdery form." when shards remain.
  Only the selected quantity is converted, in one batch; there is no auto-repeat. The
  [Crystal dust Wiki page](https://oldschool.runescape.wiki/w/Crystal_dust) confirms ten
  dust per selected shard. Zero cancels, and the callback rechecks both supplies. Capacity
  is checked before spending shards, including a full inventory with existing dust or a
  slot freed by consuming all shards.
- **Nihil shards:** the [Nihil dust Wiki page](https://oldschool.runescape.wiki/w/Nihil_dust)
  specifies one dust per shard and auto-crushing at 0, then 2, then every 3 ticks. Stackability
  does not make this a bulk conversion. Walking or another action interrupts the loop.

Regression coverage exercises the registered item-on-item handler for quantity selection,
partial/all messages, zero/invalid input, supply removal, capacity/stack limits and nihil
cadence/cancellation. Live checks cover selected/all/zero quantities, full-inventory
preservation and nihil interruption. Grinding grants no XP.

The lava scale level-dependent distribution remains unverified: the
[Lava scale Wiki page](https://oldschool.runescape.wiki/w/Lava_scale) establishes the level
advantage, but the exact outcome probabilities have not been established. The existing
uniform roll predates these fixes; its introduction and tests document the approximation.
No replacement probability formula is inferred from the expected-yield chart.

## Doses

`server/plugins/items/Potions.plugin.js` owns doses. A potion's family comes from cache enum 5583
(every potion, mix and unfinished potion to its dose enum: key 0 the empty vial, 1-4 the doses),
so potions without a drink effect and the barbarian mixes combine too; Guthix rest and the CoX
gourds, which the enum lacks, keep their registered chains. Recordings 1104, 4100 and others.

- **Combining:** the used potion pours into the target, any excess staying behind: "You have
  combined the liquid into four doses." (the target's new count in words), synth 2401, spam
  filter. The old "You pour from one container into the other." is gone.
- **Dividing:** a potion used on its empty vial (or the vial on it) shares out, the larger half
  staying in the potion: "You divide the liquid between the vessels.", synth 2401.
- **Empty** on a potion, unfinished potion, weapon poison or a vial of water, coconut milk or
  blood: the empty vial, "You empty the vial." (no sound captured).

## Zahur

Nardah's herbalist (`server/plugins/npcs/Zahur.plugin.js`). Recordings 333, 1834, 3159.

- **Clean:** with less than 200 coins, "I'll want 200 coins to clean each herb."; otherwise the
  chatbox asks "Clean all your herbs at 200 coins each?" (Yes/No). Yes cleans every grimy herb she
  is paid for, noted ones only after the hard Desert Diary (Wiki), with no XP: "There, all done."
  or "I didn't find anything that I could clean."
- **Decant** opens the cache's `decant` interface (582) in live, as Bob Barter's does; it is not
  in tsps yet.

## Druidic Ritual

Herblore needs Druidic Ritual (dbrow `skill_feature_herblore_overview_0`). Without it, cleaning and
mixing say the skill guide's sentence, "You must complete the Druidic Ritual quest to unlock the
Herblore skill." Live's message has no capture. A world without the quest system does not lock
Herblore.

## Not captured

These messages follow the captured pattern but have no recording of their own:

- "You mix the cotton yarn into your potion." (haemostatic dressing)
- "You mix the crab paste into the potion." (super hunter potion)
- "You mix the squid paste into the potion." (haemostatic poultice)
- "You mix the kebbit teeth dust into your potion." (hunter potion)
- "You mix the yew roots into your potion.", "You mix the magic roots into your potion." (antidotes)
- "You mix the poison ivy berries into your potion." (weapon poison++)
- "You mix the nihil dust into your potion." (ancient brew)
- "You put the Toadflax into the coconut milk." (the four coconut milk unfinished potions)
- "You mix the ancient essence into your potion." (forgotten brew)
- "You mix the torstol into your potion." (anti-venom+)
- A super combat made with a torstol potion (unf) leaving three empty vials, not two
- Superantipoison reuses antipoison's "You mix the unicorn horn into your potion."
- Goading and prayer regeneration were both captured with aldarium, once as "the Aldarium" and
  once as "the aldarium"; which is which is a guess.

Grinding: "You grind the kebbit teeth to dust." and "You grind the nihil shard into dust." have no
capture. Nihil shard cadence is established by the Wiki above; its exact message remains
unchecked against live captures.

## Experience

tsps stores XP in tenths; the skill display reports whole XP. Fractional step XP is retained
when subsequent Sanfew ingredients are added, so a complete three-dose serum awards 160 XP.
