# Gravestones, Death's Office and Death's Coffer

A PvM death's lost items go to a gravestone only the player sees. It lasts 15 minutes, and then
its items go to Death's Office. Death returns them for a fee, and Death's Coffer pays fees from
sacrificed items. The first death that loses items brings the player to Death for a tutorial.

| Plugin | Units | Contents |
|---|---|---|
| `server/plugins/world/Gravestones.plugin.js` | `gravestones/` | the grave, its interface and timer, fees, and the storage of grave, office and Coffer |
| `server/plugins/areas/DeathsOffice.plugin.js` | `deathsoffice/` | the entrances, the office instance, Death, item retrieval, the Coffer interface, the tutorial |

Gravestones keeps everything a player owns here. Death's Office reaches it through `gravestones:*`
custom events (listed in `gravestones/Events.Gravestones.js`). Core gives them two things: the
`onPlayerDeathDrops` hook, which fires once per death with everything about to be lost, and
`Player.lastInputCycle`, for the idle pause.

**Sources:**
- **rsprox captures:**
  - deaths and graves (recordings 426, 1084, 1085, 2508);
  - Death's Office entrances and exits from Lumbridge, Ferox Enclave and Civitas illa Fortis (4266, 1106);
  - Death's greetings and early collection (86, 89, 1751, 1764, 1851, 2509);
  - every retrieval button but 1/5/X/All (86, 89, 1751, 4266);
  - Coffer deposits (1106, 4266).
- **the OSRS Wiki:** Grave, Death, Death's Office, Death's Coffer, Items Kept on Death, and Death's dialogue transcript (also in `npc-dialogues.json`).
- **this cache:**
  - the gameval names of every var, inventory, interface component, NPC and loc used;
  - the All Settings structs for the three settings;
  - the `gravestone_<style>_<n>` multinpcs.

## Which deaths make a grave
- **PvM deaths** put every lost item in the grave, untradeables included. Before, untradeables outside the kept ones were always kept.
- **PvP deaths** drop as before. So do Ultimate Ironmen's deaths, bots' deaths, and every death in a world with `pluginConfig` `"Gravestones:enabled": false`.
- **Plugins that already handle death items** (minigames, Zulrah's, Nightmare's and Yama's retrieval, the looting bag) run first through `onPlayerDeathItemDrop`. A grave only gets what they leave.
- **Supply piles:** with "Food/Potions can form supply piles on death" on (setting 84, `gravestone_supplypiles_disabled` 0), lost food and potions drop where the player died: "Some supplies have been dropped where you died." Food and potions are items with an Eat or Drink option.
- **Wilderness PvM deaths:** food, potions and phoenix necklaces are deleted, and an existing grave moves to the new death.
- **Instances:** an instance plugin can say where its deaths' graves go by answering `gravestones:grave-location`. Otherwise a death in a private area puts the grave at the respawn point.

## The grave (captured)
- **The NPC:** a grave is the NPC `gravestone_default_<n>` (or `gravestone_angel_<n>`). It is the visible "Grave" (Check, Loot) only to a player whose `gravestone_visible` is n. Each live grave takes a free n from 1 to 255, and the NPC is also hidden server-side from everyone else.
- **Where:** on the death tile, or, if that tile is blocked, a random free tile in the nearest ring (up to 3 out).
- **On the death's last tick:** `gravestone_creation_death_coord`, `gravestone_duration` 1500 and `gravestone_visible` are set.
- **A tick later:** "Some of your dropped items are being held in a gravestone, near where you died."
- **Hint arrow:** within 20 tiles, every grave tick resets the arrow and points it at the grave again (`current_hint_arrow` 9 → 0 → 9).
- **Contents:** stacked like a bank (two of an unstackable in one slot), at most 120 stacks. The server orders and retains them by the per-item fee value, sending the least valuable excess to the Office. This overflow priority is a server policy; live selection at capacity is unverified.
- **Check** works from up to 7 tiles away. It sends, in order:
  1. the fee thresholds;
  2. the grave's inventory (inv 525);
  3. `gravestone_generic` (672) as an overlay in the floater;
  4. events on `freeitems` (op1, op10) and `payitems` (op1, op10, depth 2);
  5. `gravestone_transmit_data` (3478) with the fee and the Coffer's balance.
- **Loot** takes the free items.
- **The fee thresholds:** `gravestone_feethreshold_under100k` / `under1m` / `under10m` each hold one past the first slot worth less than that amount, or 0 if no slot is. The client draws the free and paid sections from them.
- **Taking:**
  - An item click takes it, and Examine is op 10.
  - The free button takes every free item.
  - The pay button pays the fee, or once the fee is paid (or there is none) takes the paid items.
  - The last take sends "You successfully retrieved everything from your gravestone." and clears `gravestone_duration` and `gravestone_visible` on the same tick.
- **"Auto-equip & sort items from gravestone"** (setting 371, `settings_gravestone_autoequip`): taken items go back to the inventory slots they held before the death, and worn items, kept ones included, go back on.
- **A second death** adds to the grave (`gravestone_has_merged`, "Some of your items have been added to your previous gravestone."). It prunes the grave first:
  - resources (unpowered orbs, pure essence, bones, ores, planks; `plugins/world/data/gravestone-resources.json`) go to Death's Office with "Some items have been moved to Death's Office from your gravestone.";
  - unstackables past 28 go to Death's Office;
  - food and potions drop under the grave.

## Fees
- **A grave:**
  - items worth under 100,000 are free;
  - the rest cost 1,000 (under 1m), 10,000 (under 10m) or 100,000 coins each;
  - 500,000 at most in all, and ironmen pay half.
  - The client works out the same bands.
- **Death's Office:** 5% of each item worth 100,000 or more, and ironmen pay half.
- **Paying:** from Death's Coffer, else the coins carried, else the bank. Each payment comes from one source that covers the whole fee.
- **Messages:** "Payment has been taken from your bank: 1,000 x Coins" from a grave, and "...: 5,227 coins" from the office.

## The timer (captured)
- `gravestone_duration` counts down by 3 every 3 ticks while the player is online.
- **It pauses:**
  - while the grave interface is open;
  - while the player is idle: 16 ticks without a click or key press (`Player.lastInputCycle`; mouse movement sends nothing);
  - through the first-death tutorial.
- **At 0:** "<col=ef1020>Your gravestone has expired.</col> Items held there can now be reclaimed at <col=ef1020>Death's Office</col>, accessed from near the respawn points." The items go to the office.
- **Clicking the HUD timer** (`toplevel*:gravestone`) prints where the items are, and "In 13 minutes, 55 seconds it will expire, …" (whole seconds of the ticks left).
- **Logging in** with a grave, or with items in the office, prints the retrieval warning, unless setting 278 (`gravestone_disable_warning`) is on. The grave and its timer come back.
- **`agent:advance-time`** moves the timer on.

## Death's Office (captured)
- **Entrances:** the eight Death's Domain locs. Each is listed in `plugins/areas/data/deaths-office.json` with its exit. The Lumbridge and Civitas exits are captured; Ferox Enclave's is from the Wiki; the others are the tile in front of the loc.
- **Enter:**
  - the kneel (`human_pickupfloor`, delay 20);
  - `overlay_portal` over the screen with its script (model 39504, colour 4128927) and sound 3952;
  - two ticks later, the teleport into a private copy of the office (x 3160–3191, y 5720–5735, planes 0–1) with Rest in Peace (midi 679) and the swirl's removal;
  - the overlay closes a tick after.
- **Arrival:** the player lands at (3171, 5726) facing Death and walks to his desk (3176, 5726), where he greets them. Talk-to and Collect reach across the desk.
- **The exit portal** plays the same effect without the kneel, and leads outside the entrance used.
- **Logging out inside** brings the player back to a new copy, at (3173, 5726).
- **Dropping an item** asks first, once per visit: "Are you sure you want to put that down here?<br>If you leave, it'll be lost.", with "Put it down." / "Don't put it down."
- **Death's dialogue** follows the Wiki transcript. The greetings (with and without a grave), early collection and "No, I want to talk about something else." have their captured chathead moods.
- **Early collection:** "I expect this fee to be about N coins for this reclaim." (or "I however expect it to be free for this reclaim."), quoting the office's fee for the whole grave. "Bring my items here now; I'll pay your fee." makes the grave expire and opens the office.
- **The angel grave:** 200,000 coins from the inventory or the Coffer, picked in `graphical_multi`. It changes a standing grave at once.
- **Item retrieval** (`death_office`, 669, inv 636):
  - Opening it: `if2` -1, the inventory, `toplevel_mainmodal_open`, the modal, and the item list's events.
  - An item worth under 100k is taken whole at once. A dearer one is selected (`if2` its slot, `if3` Death's fee for one).
  - Taking leaves the slot empty.
  - Take-All with nothing stored: "There's nothing here to take." With only free items it takes what fits.
  - Take-All with paid items closes the office and asks "Death will charge N coins." (every paid item) with "Pay Death's fee." / "Cancel". Paying takes what fits, charges for the paid items taken, plays Death's payment sound (2115, 10 cycles) and reopens the office.
- **Capacity:** the office holds 120 stacks; more is deleted.

## Death's Coffer (captured)
- **Sacrifice** opens `death_coffer` (670) with `death_coffer_side` (671) over the inventory (`interface_inv_init`, "Select"), the display blank.
- **Selecting** an item shows it and sets `if2` (slot), `if3` (count, 1) and `if4` (credit for one).
- **Confirm:**
  - credits the Coffer (`if1` is the balance) and clears the selection;
  - plays sound 1595, then Death's payment sound 10 cycles on;
  - shrinks the portal (`poh_portal_shrinkunshrinkloop`).
- **Credit:** 105% of the item's value, rounded down, capped at 2,100,000,000 per item and 2^31-1 in all.
- **Refused:** items worth under 10,000 each, untradeables and bonds. Ultimate Ironmen aren't invited.

## First-death tutorial (Wiki)
- **Trigger:** the first death that makes a grave, for a player who hasn't met Death. The respawn goes to Death's Office, and the grave's timer shows 1501 and holds.
- **The menu:** Death explains graves, then offers four topics, struck through once heard.
  - "I think I'm done here." and the exit portal wait until all four are heard ("I haven't finished talking to you yet, …").
  - Afterwards the portal leads to the respawn point.
- **Ending it:** leaving the office by the portal or a teleport starts the timer.
- **Resuming:** talking to Death again or relogging resumes the tutorial ("I believe I was explaining gravestones to you."). Once all four topics are heard, he greets as usual, so the grave can be collected early. The Wiki has him offer a reminder ("Would you like me to remind you about gravestones?") until the player leaves; we skip that so Collect and early collection work straight away.

## Not like live
- **Prices:** grave and Office fees use the existing Grand Exchange quote snapshot for tradeable items where available and the cache item value otherwise. The snapshot uses the higher available high/low quote as an approximation of live guide prices; unquoted item fallback remains unverified. Coffer credit still uses the cache value.
- **Death's Office order:** live seems to keep a collapsed grave's items in the order they were lost, while here they keep the grave's value order.
- **"How does that work?":** live turns the camera to the Coffer. The client has no camera-move packet yet.
- **"Can I change how I die?":** Death stops at "How would you like to... die?"; the death animation picker isn't built.
- **Items Kept on Death** (`ItemsKeptOnDeath.plugin.js`) still predicts untradeables as kept, and shows no grave fees.
- **Not built:**
  - the "Always empty … on death" settings, and the confirmation setting when paying at a grave;
  - grave items discarded into the Coffer;
  - the boss kill-count fee discounts;
  - the `busy` varbit;
  - the login warning's place after "Did you know?".
- **Guessed, tagged UNVERIFIED in the code:**
  - the chathead moods of uncaptured lines;
  - the uncaptured messages: no space, can't pay, pay first, the Coffer's refusals;
  - the angel picker's title;
  - which pays first for the angel;
  - the grave tile search;
  - the hint-arrow range;
  - the idle tick count;
  - five of the entrance exits.

## Checking it
`node --test tests/gravestones.test.cjs` (after `yarn build`) covers the fee bands, the threshold varbits, stacking, and which deaths fill a grave. In game, with the agent MCP:
- `::mortal` on a test account and an NPC kill make a grave;
- `npc_option` Check / Loot on the "Grave";
- `advance_time` collapses it;
- `object_option` Enter on a Death's Domain loc;
- the office and Coffer buttons through `send_packet` `widget_action`.
