# Stronghold of Security

The Stronghold of Security lives in `server/plugins/areas/strongholdofsecurity/`. Its data is `server/data/definitions/stronghold-of-security.json`: the floors, their objects, rewards and destinations, the 33 security questions, and the boots.

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
- **Up:** the ladders and vine climb as any ladder does (`ladders:climbUp`). Floor 1's go to the surface; the others land beside the ladder down on the floor above. Floor 4's Bone Chain says "You shin up the rope, squeeze through a passage then climb a ladder." and "You climb up the ladder which seems to twist and wind in all directions.", then puts you at 3081,3421.
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

## Not modelled

- **The skull sceptre:** combining its parts, its teleport and charges, and Solztun's imbue. Its parts drop as usual.
- **Solztun's `sos_brother_found` varbit (5639)** and the dead explorer's notes. His transcript dialogue plays as for any NPC.
- **Monster aggression** inside the Stronghold.
- **The ladder warning's exact varbit meaning:** the capture shows it counting up. The "don't ask" choice is kept server-side.
- **Messages not captured:** the Cradle when you have no inventory space, and the line when reclaiming boots (written without the emote part).
