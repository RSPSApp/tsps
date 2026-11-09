# Hardcore Worlds

[Hardcore Worlds](https://oldschool.runescape.wiki/w/Hardcore_Worlds) (OSRS, 4 November 2026):
worlds where every character is Hardcore and has one life. A death that counts is announced to
the whole world, and the character then chooses to **Reset** (start again as a brand-new
character) or **Transfer** (leave Hardcore and play on as before, on the other worlds).

Plugin: `server/plugins/modes/HardcoreWorld.plugin.js`, units in
`server/plugins/modes/hardcoreworld/`. Data: `server/plugins/modes/data/hardcore-world.json`.

## Sources

- **Captured:** live rsprox sessions of revision 242.1, 2026-11-04 and 05:
  - 66 sessions on Hardcore worlds 634-670 (world flags 2049);
  - a Hardcore character at Death's Office on world 335 before the worlds opened (20261104T112753);
  - its first login on a Hardcore world (20261104T120418);
  - the death broadcasts of every session.
- **The cache** (`osrs-242_2026-11-03`): the `hc_*` varbits, the death choice `hc_death_choice`
  (982) and its texts (scripts 10240-10249).
- **Not captured:** a Hardcore character's own death and its choice, the summary `hc_summary`
  (981) and Death's mirror. Lines marked *ours* below, and the data's `ours`, stand in for them.

## Turning it on

A Hardcore world is a server of its own. In `world.local.json`:

```json
{ "pluginConfig": { "HardcoreWorld:enabled": true } }
```

Without it the plugin loads nothing.

On a Hardcore world:
- **Saves:** every login is the account's Hardcore character, a save of its own (the `hardcore`
  profile, `persistence/PlayerProfile.ts`, beside `main` and `league`):
  - JSON saves: `data/saves/characters/hardcore/<name>.json`;
  - SQLite and IndexedDB: `hardcore:<name>`.
- **Credentials and names:** as for a league character (`server/docs/leagues.md`), the account's
  password is its main character's, or another character's while it has no main one.
- **What the client is told:**
  - script 876 says `HARDCORE WORLD` (`REGULAR` elsewhere), as live;
  - the gateway's world list gives flags `0x800` plus members, and the activity "Hardcore World";
  - `/api/world-info` gives the web client the same type bits (`flags`), and its login screen draws
    the cache's Hardcore Worlds logo, `logo_hcmain` (sprite 8921, named in osrs-dumps), in place of
    `logo`;
  - the chatbox greets with "Welcome to Hardcore Old School RuneScape." (captured), built from the
    world's name.
- **No Ironmen:** live has no Ironmen on Hardcore worlds. Hardcore Worlds keep their own economy,
  and Hardcore players trade freely (Death, captured). So:
  - the Ironman setup never opens: neither a new account's first-login offer nor the tutors'
    screens (`ironman:can-open-setup` is refused);
  - no mode change is allowed (`ironman:change-mode`); a setup the player asks for says "There are
    no Ironmen on Hardcore worlds." *(ours)*;
  - trading, the Grand Exchange and shops work as usual. The server is its own economy.
- **No presets:** this server's PvP loadouts hand out items, so a Hardcore character can't use
  them, and they don't open by themselves after a death (`presets:can-use`; "Presets are not
  available on Hardcore worlds." *(ours)*).
- **No PvP bots:** the bots plugin asks `bots:pvp-allowed` as PvP bots come and go, and a Hardcore
  world refuses. The other bots are unchanged.
- **The respawn point is Death's Office:** every respawn no other plugin takes (a quest's, a
  minigame's) is into the office (`player:respawn`). As at the start, the office is a private copy
  for each player, so this isn't the world's spawn tile in `world.json`.

## A new character (captured)

1. **Start:** the character is put in Death's Office (`deaths-office:enter`) with
   `hc_first_time_leaving_tutorial_island` = 1:
   - after Tutorial Island, where the world runs it;
   - otherwise at its first login. A new account designs its character there (679), and Death
     holds his greeting until the designer closes;
   - a relog before then still starts it.
2. **Arrival:** Death: "Greetings, mortal. I've been expecting you.", then the Lumbridge Guide's
   box, with the tutor icon.
3. **Talking to Death:**
   - First "Greetings, mortal…", then "You have?" and "Indeed... A new soul to partake in my
     challenge.".
   - Then his questions:
     - "I would like to play Hardcore Mode. How do I continue?"
     - "I no longer want to play Hardcore Mode. How do I leave?"
     - "Who are you?"
     - "Where am I?"
     - "Could you tell me more about Hardcore Mode?"
   - The last one is captured, and leaves the menu once heard. The other answers are *ours*; the
     captured ones were given before the worlds opened ("Hardcore worlds open on November 4th.").
4. **Leaving:** the exit portal leads to Lumbridge Castle's courtyard (3221, 3219), and the varbit
   goes to 0. Two ticks after landing comes
   "<img=56><col=ef1020>You have been given a complimentary Escape crystal from Death.</col>",
   with the crystal (22517) and the "Welcome to Lumbridge!" box.
5. **Death's other options:**
   - While the character is new, Collect answers "You cannot reclaim anything from me." (captured).
   - Shop opens "Death (shop)": Escape crystals for 10,000 coins, the crystal's 242 cache value
     (stock 9,500). It comes from the Wiki through osrsreboxed-db (`import-osrs-shops.mjs`), bound
     to Death's op4.
   - Live titles it "Death": like every Wiki shop with " (shop)" in its name, ours keeps the
     suffix.
6. **Afterwards:** Death speaks as usual.

## The Escape crystal

The crystal itself is the EscapeCrystal plugin's (`server/plugins/items/EscapeCrystal.plugin.js`).
- **Elsewhere,** it works where the Wiki says: ToB, ToA, the Chambers of Xeric, the Inferno,
  TzHaar-Ket-Rak's Challenges, Pest Control, Barbarian Assault, and the Wilderness up to level 30.
- **On a Hardcore world** it also works anywhere a teleport is allowed, taking the player to their
  respawn point, which is Death's Office. It clears poison, venom and burn as it saves them. Both
  are from Hardcore guides, UNVERIFIED (`escape-crystal:anywhere`, `escape-crystal:escaped`).
- **Every save** says "Your escape crystal saves you and is destroyed in the process." (live,
  recorded by the user).
- **Auto-afk:** the inactivity timer (2-300 seconds, 30 by default) fires the crystal on a hit
  (zero hits, poison and hazards too) once the player has been idle that long, or on the first hit
  just after logging in. It never fires while moving, nor on a hit that kills.

**Not like live (known gaps, left for now):**
- **Mouse and camera:** live counts moving the mouse and turning or zooming the camera as
  activity. Here only packets the server receives reset the timer (`lastInputCycle`: clicks,
  buttons, chat, item use). The web client sends no mouse or camera packets, and the gateway drops
  the official client's. So an idle player who only moves the mouse can be saved sooner than on
  live.
- **Timer running out mid-walk:** live fires as soon as the player stops; here it waits for the
  next hit after they've stopped.
- **The Theatre of Blood's own crystal** still fires on a killing hit. The Tombs of Amascut's and
  the shared plugin's don't.

## Death

- **Which deaths count:** a death that loses items. Every safe minigame keeps them, as for
  Hardcore Ironmen (`onShouldDropItemsOnDeath`).
- **How it's heard:** on `player:died`, which every death reaches whichever plugin takes the
  respawn.
- **The broadcast (captured):** sent to every player as a game message.
  - With an NPC killer: `@mes_hl_ora@TzHaar-Ket killed Died Quick(33) with a 10 damage hit in Karamja.</col>`
  - Without one: `@mes_hl_ora@Fast Plank(33) was killed by a 1 damage hit in Misthalin.</col>`
  - The name is the display name and combat level, and the hit is the killing blow.
  - The area is the cache's region (`league:area-at` with `base`). Where a square has no region,
    " in …" is left out.
- **The highlight's colour:** resolved per reader by the chatbox's transparency
  (`resolveChatHighlights`). Orange is the classic `ff9040`, UNVERIFIED.
- **After the death:**
  - `hc_died_date` is set to the day, counted from 27 February 2002, and the save is written.
  - The player respawns in Death's Office, where Death says nothing while the choice waits.
  - *ours:* the tick after the respawn, `hc_death_choice` (982) opens. Until the player has
    chosen:
    - it opens again whenever it's closed, and at every login;
    - the world waits: walking and clicks on the world do nothing (`player:world-input`).

### The choice

- **Drawn by the client:** the client draws everything from `hc_death_option` (0 none, 1 Reset,
  2 Transfer) and `hc_reset_count`. "Select" on an option highlights it and shows its text.
- **Confirming** *(ours)*: a chatbox Yes, or choose again.
- **Either choice:** the grave and Death's Office's items are destroyed (Wiki: "items that would
  normally go to a gravestone are permanently deleted"; `gravestones:forfeit`).
- **Reset:**
  - The life ends: nothing of it is saved again, and the player is logged out.
  - The Hardcore save is *unmade* (`PlayerSave.unmake`), not deleted. It keeps only the account:
    the name, the password and the remembered logins. Its items, levels and attributes go, and the
    next login treats it as a new character. A Hardcore World is often a new account's only save,
    so deleting it would leave the name free for anyone to claim with any password.
  - The next login is a brand-new character: Tutorial Island where the world runs it, then
    Death's Office.
  - The reset count outlives every reset, in `data/saves/hardcore-world.json` (`HARDCORE_WORLD_FILE`
    overrides the path). Back it up with the saves.
- **Transfer:**
  - The character, as the death left it (kept items, bank and all progress), becomes the
    account's main character (`PlayerPersistence.copyProfile`, reason `hardcore-transfer`), and
    the Hardcore save is unmade, as for Reset.
  - The next login here is a new Hardcore character. The transferred one plays on a world without
    the config that shares the saves.
  - *ours:* an account that already has a main character can't transfer ("You already have a
    character on the Non-Hardcore worlds, so this one cannot be transferred.").

## Not yet

- **Reset's Stronghold of Security cooldown:** live starts a 3-day wait before a reset character
  can claim the Stronghold's coins again (Wiki: Hardcore Worlds).
- **The summary:** `hc_summary` (981), Death's mirror (`deaths_mirror` 50781) and the
  `hc_tracking_*` previous-life stats.
- **Firsts:** the "first person to …" world firsts (`@hcm_wf@`).
- **The Hardcore economy's price list:** the `hc_stockmarket_*` varps.
- **The world-hop rule:** "Hardcore players may only enter Non-Hardcore worlds within Death's
  office." tsps has no world hopping.
- **The web client's server list** doesn't show the world type: relay worlds carry no flags.
