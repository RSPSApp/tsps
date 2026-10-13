# Rune pouch

`server/plugins/items/RunePouch.plugin.js`, with its parts in `server/plugins/items/runepouch/`:

| Unit | Contents |
|---|---|
| `Common` | the slots, the client vars, inventory and bank helpers, login |
| `Inventory` | using a rune on the pouch, Empty, spell costs |
| `Interface` | the Open interface (rune_pouch, 190) |
| `Bank` | the pouch in the bank: View, Empty, rune ops, Bank all, Dismiss |
| `Loadouts` | the ten bank loadouts and their names |

Covers the Rune pouch, Divine rune pouch and their `(l)` versions.

**Sources:**
- **rsprox captures:** the archive's `bh_rune_pouch` and `rune_pouch:*` recordings (revs 224–239), and two rev 241 recordings made for this. Between them they show every interface op, the bank view, loadouts and a Fire Blast paid from the pouch;
- **the OSRS Wiki:** "Rune pouch", "Divine rune pouch";
- **this cache:** enum 982 (pouch type → rune), enums 5864/5865 (loadout names), the gameval names of every var and component, and scripts 4876/7871/7876 for how the client lays out the pouch and the name list.

## Storage (captured)
The runes are kept on the player, not on the item. Slot N is two varbits:

| Varbit | Meaning |
|---|---|
| `rune_pouch_type_N` | the rune, as a key of enum 982 (1 air, 2 water, 3 earth, 4 fire … 23 aether) |
| `rune_pouch_quantity_N` | up to 16,000 |

- **Slots:** three, or four in the divine pouch. A player can own only one pouch (Wiki); **ours:** if more are carried (spawned), the one with the most slots counts.
- **Where a rune goes:** onto its own slot if it has one, otherwise into the first empty slot. Slots don't shift when one empties.
- **Sending:** only changed varbits are sent, and all of them again at login. The spellbook, the pouch interface and the bank view all draw from these varbits.
- **On the server:** the slots are saved as the `rune-pouch:runes` attribute.
- **Old saves:** they kept the runes in the pouch item's meta. Login moves those onto the player. Anything that doesn't fit goes to the bank, which only happens with a second old pouch.

**Ours:** the runes only work while a pouch is carried. Losing or destroying the pouch keeps them on the player.

## Using a rune on the pouch (captured)
- **No prompt:** the whole stack goes in on the same tick, up to 16,000.
- **A full slot or a 4th type:** "The pouch can't hold that."
- **Noted runes:** runes have no noted form, so there's nothing to check.

## Empty (captured)
- **Normally:** every slot goes back to the inventory.
- **With the bank open, or with no room:** "It was not possible to empty the pouch." Runes with no room stay in the pouch.
- **An empty pouch:** "Your pouch is empty."

## Open: the rune_pouch interface (190, captured)
**Opening it,** in order:
1. sets `if1` (varp 261) to the slot count (3 or 4);
2. sets busy (varbit 12393);
3. mounts `invoverlay_noops` (907) on the inventory tab;
4. runs `toplevel_mainmodal_open` (2524) [-1, -1];
5. opens 190 as the main modal;
6. sets events on `rune_pouch:pouch` (slots 0–5: OP1–6, OP10, DEPTH3, DRAGTARGET) and `rune_pouch:inventory` (slots 0–27, the same with DEPTH2).

**Closing it** puts the inventory (149) back on the tab and runs `toplevel_sidebutton_switch` [3].

**Quantity buttons** set `rune_pouch_selectedquantity`: 1 → 0, 5 → 1, All → 2, X → 3. X's op2 ("Set custom quantity") asks "Enter amount: (1 - 16,000)". The answer goes into `rune_pouch_customquantity` and selects X.

**Ops on a rune,** on either side (the pouch withdraws, the inventory deposits):

| Op | Moves |
|---|---|
| 1 | the selected quantity |
| 2 | 1 |
| 3 | 5 |
| 4 | the custom quantity |
| 5 | asks "Enter amount:" |
| 6 | all |

- **Captured on rev 241:** op1 on both sides, op2–4 on the inventory side, op2 on the pouch side. The older captures show op5 and op6 on the pouch side.
- **Pouch-side op3:** it only ever moved stacks of 4 or fewer, so whether it's 5 or All isn't settled. We use 5, the same as the inventory side.
- **Ours:**
  - op5's amount also becomes the custom quantity;
  - withdrawing with no room says "You don't have enough inventory space."

## The pouch in the bank (captured)
In the bank's inventory panel, the pouch's op1 shows it in place of the inventory:
- `bank_viewcontainer` (varbit 9727) is set to 3, or 4 for the divine pouch (captured on a Leagues world; the cache's script 4881 lays out 3 slots at 3 and 4 otherwise), and `bank_viewcontainer_obj` (varp 4385) to the pouch's id;
- events are set on `bankside:runepouch_top` (slots 1–3: OP1–7, OP10, DEPTH1, DRAGTARGET), `runepouch_name_select_list` (112–223: OP1, DRAGTARGET) and `runepouch_loadout_a`–`j` (slots 1–3: OP1).

The pouch's other ops:
- **op9** empties it into the bank ("Your pouch is empty." when there's nothing in it);
- **op2–6** deposit the pouch itself, as for any item.

These reach the plugin through the `bank:inventory-op` custom event, which `Bank.ts` sends before it deposits.

**In the view, a rune's ops** bank it:

| Op | Banks |
|---|---|
| 1 | the bank's own quantity button |
| 2 | 1 |
| 3 | 5 |
| 4 | 10 |
| 5 | the bank's X |
| 6 | asks "Enter amount:", which becomes the bank's X |
| 7 | all |

**Bank all** banks every slot. **Dismiss** sets both vars back to 0 / -1, and so does opening the bank again.

## Loadouts (captured)
Ten loadouts, a–j, each a rune and a limit per pouch slot. They're saved as the `rune-pouch:loadouts` attribute and sent at login.

**Setting a slot:**
1. Clicking a loadout slot opens the client's own rune search. Its answer arrives as a resume. The search's first entry, "Empty slot", answers with `pattern_lime_dummy` (11526) and clears the slot, with no limit asked (scripts 4876/4877).
2. The slot's limit is cleared and the rune set.
3. The server asks "<Rune>: Set a quantity limit? (1 - 15,999, or 0 for no limit)".

**The varbits:**
- `rune_pouch_loadout_<letter>_rune<N>` holds the rune, as an enum 982 key, and `rune_pouch_loadout_<letter>_cap<N>` the limit.
- Some of these are split by the cache into `_bitsa`/`_bitsb`/`_bitsc` parts. The low bits go in the first part (captured for `a_rune1`/`a_rune2`). The split caps follow the same order.

**Loading:**
1. The pouch's runes go to the bank.
2. Each slot fills up to its limit, or 16,000 with none, from the inventory first and then the bank.
3. The message:
   - short of a limit: "Your pouch could not find sufficient runes.";
   - otherwise: "Loading pouch load-out N...".

**Ours:**
- With no limit, only finding none of the rune counts as short.
- The "Loading..." message is a filtered (spam) message in OSRS; this server has no filtered type, so it's an ordinary game message.

**Names:**
- `runepouch_name_<letter>` sets `rune_pouch_loadout_name_selected` (1–10).
- A pick from `runepouch_name_select_list` stores a key of enum 5865 in `rune_pouch_loadout_name_<letter>`.
- The client draws the list as one background per row (subs 0–111), then one name per row (subs 112–223). Row i is named by enum 5864[i], so a pick's sub, less 112, indexes enum 5864. This was checked against three captured picks: rows 132, 130 and 135 are The Fight Caves, Duke Sucellus and Giant Mole.

## Spells (captured)
A Fire Blast paid from the pouch lowered the quantity varbits on the cast tick. The inventory pays first, and the pouch only covers the shortfall, through `registerSpellRuneSource`.
