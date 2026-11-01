# Yama

Yama (https://oldschool.runescape.wiki/w/Yama), solo, built from rsprox captures (https://rsprox.net/database), the OSRS Wiki and the cache. It is one plugin, `server/plugins/bosses/Yama.plugin.js`, with one unit per part in `server/plugins/bosses/yama/` and its data in `plugins/bosses/data/yama.json`.

Open access: OSRS asks for A Kingdom Divided first; tsps doesn't. Duo fights and contracts are not in yet.

## Layout

| File | What it owns |
| --- | --- |
| `Common.Yama.js` | The data, the saved attributes, the captured fade, music. |
| `Domain.Yama.js` | Yama's Domain: the instance, the way in and out, logging out inside, dying there. |
| `Voice.Yama.js` | The Voice of Yama: its talks, Travel, and the items it holds after a death. |
| `Throne.Yama.js` | Yama on his throne: his greetings, the contract, Challenge. |
| `Fight.Yama.js` | A fight: the summon, the phases, his stance, the HUD, the kill and its loot. |
| `Attacks.Yama.js` | His rotation, standard attacks and the specials of phases 1 and 2. |
| `Glyphs.Yama.js` | The glyphs: lighting, absorbing, immunity. |
| `Hazards.Yama.js` | Shadow waves, fire streaks and phase 3's Shadow Crash. |
| `Flares.Yama.js` | The void flares. |
| `Judge.Yama.js` | The phase change, the stepping stones, the Judge of Yama and the way back. |
| `PhaseThree.Yama.js` | Phase 3's beats. |
| `Hits.Yama.js` | The damage helpers: styled hits through prayer, burn, poison, roots, map animations. |
| `Commands.Yama.js` | Developer commands for testing. |

## The way in

| Step | What happens | Source |
| --- | --- | --- |
| Chasm (30236), Enter | The pick-up animation (827) a tick after arriving, the move to the Chasm's top floor (1435, 10077, 2) a tick later. A row in `plugins/world/data/loc-teleports.json`, with the Chasm's lifts. | capture |
| Chain shortcut (56242) | Already in `agility-shortcuts.json` (83 Agility). | capture |
| Voice of Yama, first talk | The Wiki's first-time transcript. As its menu comes up, varbit `chasm_voice_progress` (16284) goes to 2, which turns the Voice into the variant with Travel and Join. "Enter Yama's domain." / "Stay." | capture |
| Later talks | "Proceed or begone, human..." and the same menu. | capture |
| Travel | Straight into the domain. | capture |
| Join | Duo fights aren't in yet: "Yama does not yet accept challengers in pairs. Return alone, mortal." | ours |
| Entering | "You enter Yama's Domain." in a box with the fade out (`fade_overlay`), the minimap off a tick later, the move two ticks in (to (1503, 10050) in the copy, facing north), music 280 ("Sign Here", unlocked), then the fade in with the box again; the fade and the busy flag go when the player continues. The multiway indicator comes on. | capture |
| The instance | 11x7 chunks from chunk (181, 1256): every chunk of plane 0 and 36 of plane 1, unturned, as the capture's `rebuild_region` lists them. The Judge's arena is inside it. | capture |
| Glowing portal (56249), Leave | Back to the Voice behind the same fade, "You leave Yama's Domain." | Wiki (the portal); ours (the message and timing) |

Logging out in the domain, or a server stop, puts the player back by the Voice.

The Voice of Yama stands still (`wanderRadius` 0). The Chasm's NPC spawns (`npc-spawns.json`) were one plane too high: the Voice, the black demons and the lesser demons stood a floor above where the captures show them. All 45 now stand on the captured planes (black demons and the Voice on 0, greater demons on 1, lesser demons on 2).

## Yama on his throne

The throne NPC (123) shows Yama (124: Talk-to, Challenge) while varbit `yama_throne_state` (16286) is 0, and an empty throne (14157) during a fight.

| Talk-to | Variant (Wiki transcript) |
| --- | --- |
| Never offered the contract | First time: his questions, then the contract. |
| Offered, not signed | After backing out. |
| Signed, after a fight | After battle: victorious, defeated or escaped, once. |
| Signed | "Welcome, [name]. Have you come to challenge me?" |

The contract is offered once Yama says "Sign right here.", signed when he answers the second "Yes." ("Excellent... Challenge me when you are ready"). Challenge before signing plays the "right-click Challenge" variant. "Do you keep any record of our fights?" ends without the hiscores interface (not in tsps).

## The fight

| Tick | What happens | Source |
| --- | --- | --- |
| 0 | Yama on his throne snaps his fingers (12154, spot 3278); flames (56264) close the arena's mouth at (1502-1504, 10067). | capture |
| 2 | Yama (14176) appears at (1501, 10076), facing north (12156, spot 3279). | capture |
| 5 | He can be attacked: the throne empties (`yama_throne_state` 1) and the boss HUD shows his 2,500 hitpoints. | capture |
| 7 | The glyphs light up. | capture |
| 10 | His first attack. | capture |

### Leaving mid-fight

The flames (56264) on the arena's mouth: Pass asks "Flee the fight? Yama will count it as an escape." (Yes, flee. / No.), Quick Pass doesn't. Either walks the player through to the south side and ends the fight as an escape: Yama back on his throne, the glyphs out, the flames gone. Teleporting or logging out does the same. No source has what OSRS does here; it's ours.

### Phases 1 and 2

| What | How | Source |
| --- | --- | --- |
| Speed | An attack every 8 ticks. | capture, Wiki |
| Rotation | One standard attack in the opening element (fire or shadow, at random), then a special of the other element, after which his standard attacks take that element; then three standard attacks and a special, each special the other element from the last. | capture (79 kills), Wiki |
| Void flares | Stand in for one shadow special a phase: the 2nd or 3rd shadow one if the phase opened with a shadow special, the 1st or 2nd if with fire. The element stays. | Wiki, capture |
| Standard attacks | A swing at an adjacent player (12146, landing a tick later), else magic for fire (12144, spot 3246, 3247 on the player) or ranged for shadow (12144, spot 3243, 3244), landing 3 ticks later. 46 at most; Protect from Melee lets 6 through, the other prayers block it all. They can poison (from 20). | capture, Wiki; how often he poisons (1 in 4) is an estimate |
| Stance | After a melee hit he chases the player (magic defence -30); after magic or ranged he stands his ground (+60). | Wiki |
| Phase 1 specials | Fire: a flaming rock from above (12145, spot 3253, projectile 3254), landing 6 ticks later and setting the player alight (burn 10). Shadow: a shadow spike (12145, spot 3256, projectile 3257), 6 ticks, draining prayer. | capture; their 46 max and the prayer drain (a third of the damage) are estimates |
| Phase 2 specials | Meteor Strike (12148, spot 3270, the meteor marker 14182 two ticks in, the blast at six): death within a tile of its centre, 80 two tiles out, 40 three out, nothing further; burn 8. Shadow Stomp (12148, spot 3259, projectile 3260 two ticks in, the hit at five): up to 80, rooted 2 ticks, prayer drained. | capture; Wiki infobox and contract table (the strategy page still says 60) |
| Overheads | His lines with Meteor Strike and Shadow Stomp (and the phase 1 specials), from the transcript. | capture ("Colabi, infernus"), Wiki |
| Layout | Arena floor, glyphs, flare tiles: `plugins/bosses/data/yama.json`. | capture |

#### Glyphs

Five 3x3 floor glyphs light up two ticks after a phase starts (capture): the three by the throne and to the south in the element of the phase's first special, the two at the sides in the other (`floorkit_summoning03_full01` shadow, `full02` fire). A player on a glyph's centre absorbs it a tick later: "You absorb a Glyph of Fire.", the immunity spot animation (3280 / 3281), the glyph going out for the phase, and 10 ticks of immunity to its element ("The Glyph of Fire fades away." at the end). While immune, attacks and flares of that element do nothing ("The Glyph of Fire absorbs the damage from the attack."). A glyph of fire burns for 12, 9, 6 or 2 by how close Yama stands to it; a glyph of shadow drains as much prayer (Wiki). The glyphs go out at the phase change.

#### Hazards

Before every special but the phase's first, in turn (capture):

- **Shadow wave**, 10 ticks before: a diagonal wall sweeping the whole arena from the south-east or south-west, 2 tiles a tick (each tile's spot sent at once with its delay, 15 cycles a step: `vfx_shadow_wall_03` from the south-east, `_02` from the south-west, a step behind its mirror). On a tile as it passes: 16-20 and the protection prayers go off (Wiki: up to 20). Phase 2 sends both corners.
- **Fire streaks**, 9 ticks before: 8 rows (12 in phase 2) lit at their east or west edge for 3 ticks, then crossing at 2 tiles a tick. Walking through is safe; standing in one burns and binds (Wiki). Its 10 damage and 2-tick bind are estimates.

#### Void flares

A pair on one of two pairs of tiles (capture), one fire and one shadow, spawning with 12135, the charge bar (headbar 75) filling from 3 ticks in; 26 ticks after spawning a flare still standing explodes (12136, a red or blue spot), heals Yama and hits the player a tick later for 42-45 (Wiki), both scaled by the flare's remaining hitpoints. A glyph of the flare's element blocks it. 140 hitpoints (Wiki). The heal (36 at full) is an estimate from the captured heal splats. Magic and standard ranged weapons always land their max hit on a flare (Wiki), the spell's own max: two Dark Demonbanes from a purging staff under Mark of Darkness, not one Undead Grasp. Flares take 200% of demonbane's effect and Yama 120% (Wiki), for demonbane weapons and spells alike: the plugin sets `combat:demonbane-vulnerability` on them, which `Demonbane.EquipmentEffects.js` and `CombatSpells` read.

### The Judge of Yama

At his next attack after 66.6% (1,666) and then 33.3% (833):

| Tick | What happens | Source |
| --- | --- | --- |
| 0 | Yama says one of his lines and slams the ground (12147, spot 3276). Flares and hazards go. | capture |
| 2 | The player starts to fall (12149); the glyphs go out. | capture |
| 4 | The HUD goes, the screen fades out. | capture |
| 6 | The player lands face down by the stepping stones, (1479, 10077) (12152, spot 3275); varbit `yama_transition_phase` 1; the Judge (14180) at the corridor's far end, praying Melee and Missiles (head icon 7). | capture |

- **Stepping stones** (56246, Jump): from where the player stands to the next row 2 or 3 tiles ahead, one jump a tick (12196, exact move over 27 cycles, sound 2461). (capture) A click on a stone is handled between ticks, so the jump starts on the next tick: started at once, that tick's tasks would land the player before the client saw the slide.
- **Fire surges**: while the player crosses, the Judge casts (69) every 4 ticks and two fire surges (13507) start at its end of the corridor, walking a tile a tick (up to 30 on the player's tile, spot 1466). (capture; the Wiki says 5 ticks) A water spell always lands its max hit on one and puts it out (Wiki: Yama/Strategies); other attacks are refused. Its 100 hitpoints and the refusal message are estimates: the cache gives it none.
- **On the platform**: a fireball every 5 ticks at the player's tile (1446 marking it, projectile 2855, 2856 as it lands 4 ticks later): 18-22 there, 13-18 to the Judge if it lands under it; the cavern shakes on its 5th and 13th (5-7). (capture, Wiki)
- **Its prayers**: Missiles always, Melee until hit by magic, then Magic until hit by melee (head icon 6). Every other hit lands at its max. (Wiki)
- **Its death** (9042, sound 5023): five ticks later Yama is back in the centre, the player falls and lands in front of the throne, (1504, 10086), and the next phase starts three ticks after that. (capture)

### Phase 3

Yama stays in the centre and attacks every 7 ticks, alternating ranged and magic from the element of the glyphs that were more abundant in phase 2, or swinging at an adjacent player, which summons a void flare (Wiki). Protection prayers let 22 of a swing and 3 of a cast through (Wiki). His defence bonuses rise (Wiki infobox).

**Shadow Crash** (captured): three rocks in a line through the player (`vfx_player_yama_falling_rock_impact01`, the sides 3 tiles away; diagonal 2), cardinal, diagonal, cardinal, 3 ticks apart; 3 ticks after each, their shadows close in on the middle in a bowtie (7 wide 3 tiles out, then 5, 3, the centre), up to 20 on it (Wiki). A step to the side of the centre is safe.

When the crashes, the flares and the waves come is an estimate from the scim.gg Yama simulator (phase 3 only): his attacks are beats, 10 a cycle; Shadow Crash on beats 0, 3 and 7 when the player is out of melee reach, two flares (71 hitpoints, 23-25, Wiki) on beat 8. The waves are captured (rsprox 799, 3285): a pair, one from each corner, 9 ticks after the last crash, and two pairs 9 and 16 ticks after the flares, never closer than 7 ticks; a set's 2nd and 3rd pairs cross a column east or west at random (Wiki).

### The kill

| Tick | What happens | Source |
| --- | --- | --- |
| 0 | His death (12161, spot 3284); the flares go; the flames give way (the invisible loc 29733). | capture |
| 5 | "Your Yama success count is: N." (varp `total_yama_kills` 4701; Yama calls kills successes, Wiki), "Fight duration: m:ss (new personal best)" or ". Personal best: m:ss"; Yama back on his throne (12165, spot 3286); the victory jingle (76). | capture |
| 9 | His line: a perfect kill, a close one (a quarter of the player's hitpoints or less), or the usual. | capture ("Effective, if a bit cowardly."), transcript |
| 11 | The loot, in front of the throne at (1503, 10088). | capture, Wiki |

The loot is NpcDrops' roll of the Wiki table without its Contract section (what his contracts reward; `npc-drop-overrides.json` `removeSections`). The export models the Wiki's conditional unique chain as independent separate rolls (horn 2/600, each armour piece 1/600, dossier 1/12, lockbox 1/33, shards 1/17), so the effective rates match but more than one can land on a kill where OSRS stops at the first success.

### The Forgotten lockbox

The 1/33 Forgotten lockbox (`Open`) rolls one reward from the Wiki's 403 chances: dragon bolts (unf) 125 or dragon darts 125/80, oathplate shards 14/11, dragon platelegs or plateskirt, 233,333 coins, or an oathplate helm/chest/legs. The messages are the Wiki transcript's. There is no rsprox capture of an opening: the Yama submissions (3389, 3386, 3347, 3340, 3284, 800, 799, 788, 3285, 2644) have none, and the database has no `Forgotten lockbox` item search. Entrana's "You can't open that here" is not implemented.

## Death

The player wakes by the Voice of Yama (Wiki), at (1439, 10076) (capture). Yama says "The deal is done." on a first death (capture) and one of his transcript's lines after that ("Lacking.", captured). Deaths count as soul debt (Wiki).

OSRS keeps what drops in a gravestone by the Voice. tsps has no gravestones, so the Voice holds it, as Zul-Gwenwynig does for Zulrah, and Talk-to hands it back. The fee is the gravestone's (Wiki: Gravestone): nothing per item under 100k, 1,000 per item from 100k, 10,000 from 1m, 100,000 from 10m, at most 500,000, half for Ironmen; Yama takes 75% off until 10 successes (Wiki). An unsafe death anywhere else first loses what the Voice holds. The messages and the fee line are ours. The "holds what you dropped" message is sent by the domain's death handler, which handles the death, so later death handlers never run.

## The instance's scene

An instance scene is drawn from its REBUILD_REGION centre chunk less 6, not from the start of a 64-tile map square. The WebGL client placed graphics (spell casts, Yama's), map animations and ground items from the map square's start, so in an instance they could land up to a chunk off, and loot drawn there couldn't be clicked. They now take the map's render base, as players, NPCs and projectiles already did (`GfxRenderer`, `draw.ts` world graphics, `GfxManager.listWorldInstancesForDrawnMap`, `GroundItemMeshBuilder`; WebGPU already did, but for which world graphics a map draws).

## Estimates

- The way out through the portal: its message and the fade's timing are ours.
- The Voice's lines about held items and the fee.
- The phase 1 specials' max hit (46) and the shadow specials' prayer drain (a third of the damage).
- How often he poisons (1 in 4).
- The fire streaks' damage (10) and bind (2 ticks); the waves' 16-20.
- A void flare's heal (36 at full, 18 in phase 3).
- Phase 3's beats (when the crashes and flares come), from the scim.gg Yama simulator.
- The Judge's fire spells' 100 hitpoints and the message when attacked without a water spell.
- Meteor Strike doesn't disable run, and the phase change doesn't show the camera shake.
- Fleeing through the flames (Pass, Quick Pass) and the Voice's Join line.

## Not in yet

- Duo fights and contracts.
- Chat heads' expressions (the dialogue plays with the calm head).
- The hiscores interface from "Do you keep any record of our fights?".

## Testing

`node --test tests/yama.test.cjs tests/yama-lockbox-overflow.test.cjs`

Developer commands: `::yamahp <hitpoints>` (1666 or 833 reach a phase change at his next attack), `::yamakill` (a hit of his remaining hitpoints from the player, in phase 3), `::yamajudgehp <hitpoints>`, `::yamajudgekill`.

Developers take no damage and keep everything on death. `::mortal` turns both off for the session (and back on), to test deaths and the Voice holding the items.
