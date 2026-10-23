# Stronghold of Security

The Stronghold of Security lives in `server/plugins/areas/strongholdofsecurity/`. Its data is `server/plugins/areas/data/stronghold-of-security.json`: the floors, their objects, rewards and destinations, the 33 security questions, and the boots.

## Sources

- **An rsprox capture of a full run:**
  - the entrance;
  - floor 1's portal and chest;
  - floor 2's doors and questions (one answered wrongly) and its ladder warning;
  - floor 3's chest;
  - floor 4's doors, Solztun and the Cradle of Life;
  - the bone chain back up.
- **The Wiki:** the questions table, the reward coins, and the portals' combat levels.
- **The cache's map:** the positions the run didn't visit, such as where each up-ladder leads.

Where the capture showed a question or response, its wording replaces the Wiki's, fixing typos such as "muse make sure" and "authentiation".

## The doors

The doors are Gate of War, Rickety door, Oozing barrier and Portal of Death. They come in pairs with a gap between them; a pair's two doors lie along the passage, on the same axis, and may be mirrored.

| Moving | Question? |
| --- | --- |
| Into the gap | No |
| Out of the gap | Yes, unless the door is the one you last answered |
| Anywhere, once all four rewards are claimed (Wiki) | No |

**Any answer passes.** The door gives that answer's response, and on its continue, opens. The capture shows this for a wrong answer.

**The dialogue:** the door speaks as its floor's door NPC: the head (Gate of War 2494, Ricketty door 2495, Oozing barrier 2496, Portal of Death 2497) playing `door_chathead` (4281), under the name "Rickety Door" or "Portal of Death", as captured. Floors 1 and 3 use their NPC's name, not captured. The lines are "To pass you must answer me this: …", then the options, then the response.

**Passing a door:**

| Tick | What happens |
| --- | --- |
| The click | `busy` = 1, animation 4282 and sound 2858 |
| +1 | The player moves through the wall to the next tile |
| +2 | `busy` = 0 and animation 4283 |

After a question, the move comes on the response's continue.

## Getting around

- **The entrance** (20790, Barbarian Village): a move to 1859,5243, then "You squeeze through the hole and find a ladder a few feet down leading into the Stronghold of Security."
- **Down** (Ladder 20785, Ladder 19004, Dripping vine 23706):
  1. the warning (579, "Are you sure you want to climb down?"); `cws_warning_4` (varbit 3854) counts up each time it's shown;
  2. on "Yes": animation 828;
  3. a tick later: "You climb down the ladder to the next level." and the next floor (2042,5245; 2123,5252; 2358,5215).

  "Don't ask me this again" skips the warning from then on. Going down to floor 2 completes the Varrock easy diary task "Enter the second level of the Stronghold of Security".
- **Up:** the ladders and vine climb as any ladder does (`ladders:climbUp`). Floor 1's go to the surface; the others, floor 4's Boney ladder (23921) included, land beside the ladder down on the floor above. Floor 4's Bone Chain says "You shin up the rope, squeeze through a passage then climb a ladder." and "You climb up the ladder which seems to twist and wind in all directions.", then puts you at 3081,3421.
- **The portals** ("You enter the portal to be whisked through to the treasure room.") work once the floor's reward is claimed. On floors 1–3 they also work from combat level 26, 51 and 76 (Wiki). Otherwise: "You must have completed this level to take this shortcut."

## Rewards

| Floor | Object | Coins (Wiki) | Emote (varbit) | Jingle |
| --- | --- | --- | --- | --- |
| 1 Vault of War | Gift of Peace | 2,000 | Flap (2309) | 157 |
| 2 Catacomb of Famine | Grain of Plenty | 3,000 | Slap Head (2310) | 179 |
| 3 Pit of Pestilence | Box of Health | 5,000, plus every stat restored ("You feel refreshed and renewed.") | Idea (2311) | 177 |
| 4 Sepulchre of Death | Cradle of Life | — | Stamp Foot (2312) | 158 |

**A chest:**
1. sound 1247 and its opening line ("The box hinges creak…" / "The grain shifts in the sack…");
2. on continue: the emote varbit, the coins and the jingle;
3. "...congratulations adventurer, you have been deemed worthy of this reward. You have also unlocked the X emote!".

Opened again: "You have already claimed your reward from this level." A claimed reward is also what counts as the floor being done. The emote tab's cache scripts read the varbits, which are restored on login.

**The Cradle of Life:**
1. sound 1246 and two message boxes;
2. two double item boxes (interface 11) showing the boots;
3. the skill-multi choice "Select the boots you want.": Fancy boots (9005), Fighting boots (9006) or Fancier boots (28672);
4. then the item box "You claim your prize: …<br>You have unlocked the 'Stamp Foot' emote.".

It can be searched again for more boots. OSRS gates the boots on 2FA and a Jagex Account; neither exists here, so all three are offered.

## The skull sceptre

`Sceptre.StrongholdOfSecurity.js`, with its data under `sceptre` in the JSON.

**Sources:**
- rsprox captures (recordings 1768, 1844, 3121, 3211): the three combines and Invoke, with an unimbued and an imbued sceptre.
- The Wiki (Skull sceptre, Bone fragments): charges, recharging and the Wilderness limit.
- Solztun's Wiki transcript: the imbue.

**Combining** removes both items and shows the result in an item box (interface 193):

| Used together | Makes | Box text (captured) |
| --- | --- | --- |
| Right + Left skull half | Strange skull | "The two halves of the skull fit perfectly, they appear to have a fixing point, perhaps they are to be mounted on something?" |
| Top + Bottom of sceptre | Runed sceptre | "The two halves of the sceptre fit perfectly. It appears to be designed to have something on top." |
| Strange skull + Runed sceptre | Skull sceptre | "The skull fits perfectly atop the sceptre. You feel there is great magical power at work here, and that the sceptre has N charges." |

A new sceptre starts with the most charges the player can hold (Wiki).

**Invoke**, from the inventory or worn, teleports to 3081,3421. The capture shows the standard spellbook teleport (`human_castteleport`, `teleport_casting`, sound 200, landing on tick 3), so it uses the shared `TeleportType.NORMAL`. It works up to level 20 Wilderness (Wiki). On landing it spends a charge and says "<col=7f00ff>Your Skull Sceptre has N charges left.</col>" (captured). It also completes the Varrock hard diary task "Teleport to Barbarian Village with a skull sceptre" (one capture, on a Leagues world). **Divine** gives the same message.

**Charges (Wiki):**
- The maximum is 10, plus 4 for each Varrock diary tier done (up to 26).
- Every unimbued sceptre shares one pool. The one that spends the last charge crumbles, and the pool is full again.
- The server keeps the charges spent, not the charges left, so a sceptre never used is full and a new diary tier adds its charges straight away.

**Solztun** imbues "any Skull sceptres the player has": the ones carried, worn and banked all become Skull sceptre (i). He also sets `sos_sceptre_imbued` (varbit 5638), which is restored on login, and every sceptre made afterwards is imbued.
- His transcript runs as usual. The plugin answers its conditions: he needs a sceptre plus Fancy, Fighting or Fancier boots in the inventory.
- The server has no Authenticator, so the account always counts as safe, as it does for the Cradle's boots.
- Using a sceptre on him plays his "using a skull sceptre on him" variant.

**An imbued sceptre** never crumbles and can be recharged, up to its maximum (Wiki):
- a piece: Right skull half, Top of sceptre and Bottom of sceptre give 3 charges each and the Left skull half 5, all +1 per diary tier;
- bone fragments: one charge each, and only the fragments needed are used.

**A chisel** breaks an unimbued piece, combined piece or whole sceptre into the bone fragments its pieces are worth (Wiki: 14 for a sceptre without diary tiers).

**Not captured:**
- "Your Skull Sceptre crumbles to dust."
- "Your Skull Sceptre has no charges left." (an empty imbued sceptre)
- "Your Skull Sceptre is already fully charged."
- "You chisel the … into N bone fragments."
- The charges message with 1 charge left. It is sent as "1 charges", as written in the captured template.

## Not modelled

- **Solztun's `sos_brother_found` varbit (5639)** and the dead explorer's notes. His transcript dialogue plays as for any NPC.
- **Monster aggression** inside the Stronghold.
- **The ladder warning's exact varbit meaning:** the capture shows it counting up. The "don't ask" choice is kept server-side.
- **Messages not captured:** the Cradle when you have no inventory space, and the line when reclaiming boots (written without the emote part).
