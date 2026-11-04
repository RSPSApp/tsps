# Below Ice Mountain

Quest behavior comes from the [OSRS Wiki quest guide](https://oldschool.runescape.wiki/w/Below_Ice_Mountain), its [transcript](https://oldschool.runescape.wiki/w/Transcript:Below_Ice_Mountain), the [structural pillar page](https://oldschool.runescape.wiki/w/Structural_pillar), and RSProx recording **1636** linked by issue #600. IDs were checked against this repository's revision 241 cache. Raw recordings and account details are not included.

## Captured state

The existing save's story stages 0–5 stay compatible. The client receives OSRS's main varbit 12063 and separate recruitment varbits, preserving cache NPC and entrance morphs.

| Main varbit | Recorded milestone |
| --- | --- |
| 5 | Accept Willow's offer, cycle 222 |
| 7 | Ask about the falling out, 227 |
| 10 | Finish the crew instructions, 238 |
| 15 | Recruit the first crew member, 606 |
| 20 | Recruit all three, 961 |
| 25 | Willow asks whether the player is ready, 1391 |
| 30 | Marley clears the entrance, 2051 |
| 35 | Guardian awakens, 2160 |
| 40 | Guardian defeated, 2197 |
| 120 | Completion after Ramarno's first line, 2253 |

Recruitment uses 12064 (Marley), 12065 (Checkal), and 12066 (Burntof). Checkal progresses 0→5 referral→10 Atlas offer→15 workout→20 Flex prompt→40 recruited. Marley uses 5 sandwich errand→10 recipe learned→35 sandwich handed over→40 recruited. Burntof uses 5 drink request→10 drink received→15 rock-paper-scissors→40 recruited. All three become 45 inside and 50 after the Guardian awakens. Reward claimed is varbit12067; Flex is 12062; repeat workouts use 12131; Ramarno's workshop move is 12068.

The nameless NPC IDs 10638–10649 are valid cache morph bases, not missing NPCs. World spawns already supply both the original and entrance crew. The plugin no longer creates permanent duplicate NPCs or a second entrance.

## Interactions and scenes

The quest requires 16 Quest points. Checkal recruits the player only after an actual nearby Flex emote; recording 1636 clicks emote slot40 at cycle597 and resumes Checkal's conversation three cycles later.

The workout runs in a private template scene, using the recorded 206-cycle span from the initial teleport at 345 to the unlock at 551. Its sanitized timeline includes every captured camera cue, black/white fade, NPC appearance/removal and walk, Atlas's counts and boxing, the barbarian crowd, the dog, and the tomato throw at 393 (projectile 29, actor graphic 30 and delayed impact 31). Player movement uses key running segments, pushups and block animations. The free workout is excluded from the paid-session counter. Repeat sessions cost 25,000 coins and replay the workout. Completion is saved at the unlock, so logging out before continuing its message preserves it.

Burntof accepts regular beer, Asgarnian ale, dwarven stout and wizard's mind bomb. Using a drink directly on him works, as does the dialogue hand-in. His upstairs scene plays the hand animations, five-cycle round reveals, third-round cheat and Tina's arrival. The cheat beats the sign actually displayed in the third round. Each of the player's three choices leads to recruitment.

The sandwich recipe unlocks when the cook explains the bread/meat combination. Knife-on-bread opens the cache creation menu with breadcrumbs and steak sandwich; knife-on-meat can make the sandwich directly. It consumes one bread and one cooked meat, retains the knife, plays sequence8938 and works after completion. Using a sandwich on Marley starts the hand-in dialogue.

The entrance scene creates a private crew, explosion and rubble replacements, the Marley disguise/tripwires, indoor crew, earthquake and awakening. The combat Guardian and its four mineable pillars occupy a separate private instance. Pillars require a usable pickaxe and boosted Mining10, award10 MiningXP each and damage the40HP Guardian by10. A broken pillar cannot be mined repeatedly. The Guardian attacks after the cutscene and on re-entry. Its death starts the finishing dialogue automatically.

The Guardian's hit reaction no longer falls back to human block 424. Cache NPC 10654 uses model
42128 and guardian animation base 1955; human block 424 uses base 0 and deforms that model's
renderable geometry. Unknown NPC blocks default to no reaction, while human
idle families retain their existing fallback and the combat loader still applies resolved roles.
Both melee launch and projectile impact already skip an unknown block without resetting the
actor's correct attack pose. No replacement Guardian flinch sequence is inferred.

The finishing sequence shows Willow's bag and coins before opening the doors and meeting Ramarno. The ending resets the camera five ticks after the resumed "Bless my beard..." line, before completion at eight ticks. Completion follows that recorded transition, grants 2,000 coins and one Quest point once, uses a steak sandwich on the scroll and jingle 152, and automatically starts the Ramarno introduction when the scroll closes. Ramarno's departure updates the cache morph variable.

The workout retains all 54 captured camera packets (including its reset), with exact source tiles, heights, both movement-rate fields and cycle offsets. Rock-paper-scissors, the exterior escape/explosion, Marley's two trap pans, the entrance rise, Willow's room sweep, the earthquake/awakening, and the final bag/door shots also retain their captured targets and rates. Transition cameras change at the recorded fade boundaries; dialogue-driven shots start with the matching line or Continue, without replaying the recording player's reading delays.

Recorded transition spans are also applied to RPS entry (900 out, 904 in, 905 dialogue), RPS exit (976 departure, 979 out, 984 in/dialogue), the entrance gathering (1940 out, 1944 in, 1946 dialogue), Marley entering (2029 out, 2032 in, 2034 dialogue), the crew entering (2052 out, 2057 in, 2059 dialogue), and Guardian defeat (2197 death, 2198 out, 2204 in, 2206 dialogue).

The fuse uses the 1959/1967 fade pair, explosion aftermath 1988/1993, rubble clearing 2016/2023, and Ramarno's workshop departure 2283/2286. The crew's escape fades out at 2167 and shows the player's line at 2169. Continuing that line removes the crew immediately, resets the camera two cycles later and reveals the combat Guardian five cycles later (2171/2173/2176 in the recording).

## Verification and remaining fidelity limits

`node --test tests/below-ice-mountain-parity.test.cjs` (from `server/`) covers the captured states, legacy saves, interrupted conversations, actual Flex requirement, recipe/menu/postquest use, every RPS choice, workout timing and cleanup, all 54 workout camera packets and scene camera transitions, private crew/Guardian transition, distinct pillar mining and single reward.

The hit-reaction regression also uses the registered entrance, real quest-owned and ordinary
same-type NPCs, queued ranged damage, ordinary melee launch, World processing and PlayerSession
NPC sync. It preserves existing human fallbacks, authored/captured/cache-family blocks and explicit
no-block roles across hydration. A separate offline replay through the actual client decoder,
NPC movement/animation controller and cache geometry reproduces the bad human rig before the fix.
This is not a live GPU visual check or proof of every scene animation in issue #2134; its training,
dialogue and cutscene reports remain open.

Live agent MCP on this worktree's port49802 verified the16-point refusal, main35/sides50, cache entrance interaction, a private Guardian arena with one40HP Guardian, all four pillars and the mapped exit.

Recording 1636 uses combat rather than pillar mining. Recordings 332 and 333 (revision 230) only cover the crew's post-quest desert dialogue, which matches; no decoded recording mines a pillar. The eight-cycle mining delay is based on the Wiki speedrun description and needs a mining-route recording to confirm its timer interaction. Player running uses key segments rather than every captured step; actor facing microsteps, lighting/environment scripts and temporary HUD/sidebar suppression are not fully reproduced. Quest journal prose is the existing implementation because this recording does not open its journal. These limits prevent claiming full visual or packet-for-packet parity.

Known small differences kept on purpose: the recruit, main 35 and Ramarno move varbits change 2, 2 and 1 ticks before the recording (606/841, 2160, 2285), and returning from the workout has no 563 fade-out, because the scene and its save state resolve as the line is continued. The player's lines in 2059–2103 show "Click here to continue" at once, since only NPC boxes have a held form.

## Audit against recording 1636 (2026-11-01)

The scroll lists only 1 Quest Point, 2,000 Coins and "Access to the Ruins of / Camdozaal" (2253); the Wiki's Flex and steak sandwich rewards are not on it. The drink box shows the drink given (886) and the bag's box shows coin-pile obj 1003 (2228). Recruits leave behind a fade (Checkal 604/608/609, Marley 838/841/843). Marley eats three bites before speaking (826–832, seq 829, sound 2393). The flex plays six ticks before its statement (555/561). Rock-paper-scissors rounds carry both overhead calls (910, 927, 947) and the third-round cheat plays nothing (956).

At the entrance, Burntof plants the charge (1953–1955, seq 7205), the others move to cover and the fuse appears (1961), it hisses every three ticks from 1964, and the crew return for 1993. Checkal makes three rubble trips (2002–2016). The sounds at 1961, 1964, 1965, 1966, 1976 and 2230 follow their lines, and the player shouts "Aaah!" at 1977. Marley's trap uses seq 881, a one-tile tripwire step (seq 1236, 2043), three disarm beats with their sounds (2046–2050) and removes the tripwires at 2050. The main varbit reaches 30 as "That got it!" is continued (2051), and the music changes at 2055. Burntof's four asides speak as a box opens (2067, 2077, 2086, 2101) rather than pausing the conversation. At the bag, the player walks over, says "Hmm..." with seq 6840 (2224), and picks up with seq 827 before the coin box (2226/2228). Varbit 12068 reaches 2 when Ramarno explains the barronite errand (3169).
