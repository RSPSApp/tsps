# Ironman modes

Ironman, Ultimate Ironman and Hardcore Ironman as **account types**: per player, on a normal world, as in OSRS.
- **Plugin:** `server/plugins/modes/Ironman.plugin.js`, with one unit per area in `server/plugins/modes/ironman/`.
- **Data:** `server/plugins/modes/data/ironman.json`.

Group Ironman comes later.

## Setting a mode

**In game**, as captured on Tutorial Island (`server/plugins/modes/ironman/Setup.Ironman.js`):
- **The Ironman tutor (Paul)** on Tutorial Island: "I'd like to change my Ironman mode." opens the setup interface (`ironman_setup` 890, after varps 263=0, 264=1, 266=1). The mode buttons are None 21, IM 22, UIM 23, HCIM 24 and the group modes 25-27, in the order its script 519 lays them out (modes 0-6). The group modes say they aren't available yet. None asks "Would you like to stop being a <mode>?" instead (ours).
- **Confirming:** a mode button opens the confirmation (`popupoverlay` 289 in `890:29`, script 4212). The answer comes back as the count dialog: 1 Proceed, 0 Cancel. Proceed sets the mode and `ironman_downgradepermitted` (1776) = 1, then shows "Your Ironman mode has been updated."
- **The bank PIN:** OSRS also asks for a new bank PIN at this point ("…and your new PIN is now in effect."). This server has no bank PIN, so the confirmation leaves it out. The captured popup text is kept in `ironman.json`.
- **Already chosen:** "Your mode is already Hardcore Ironman." (captured). Group Ironman answers "Group Ironman isn't available yet." *(ours)*.
- **Adam in Lumbridge** (311): his transcript's setup only allows downgrades, as the tutor explains (Hardcore or Ultimate to Ironman, Ironman to none). His "Armour" option hands out the mode's helm, platebody and platelegs: "There you go. Wear it with pride." (captured), or "You're not an Ironman. This armour is only for them." (captured).
- **Other plugins** ask a player's mode with the custom event `ironman:mode` `{ player }`, which fills in `mode` and `label`. They open the setup with `ironman:open-setup` `{ player, upgrades }`, set a mode with `ironman:set-mode` `{ player, mode }` (a league character is always an Ironman, `server/docs/leagues.md`), and may refuse a setup choice: it asks `ironman:change-mode` `{ player, from, to, allowed, reason }` first, and `allowed: false` stops it with the reason.

**Admin command** (administrator and up):

```
::ironman                                          show your mode
::ironman <none|ironman|ultimate|hardcore>        set yours
::ironman <none|ironman|ultimate|hardcore> <name> set an online player's
```

Setting a mode updates the client at once: the `ironman` varbit and the chat icon. It's saved as the attribute `ironman:mode`.

## What the client is told

- **The `ironman` varbit (1777):** 0 none, 1 Ironman, 2 Ultimate Ironman, 3 Hardcore Ironman. The cache's enum 859 names these values (4–6 are the group modes), and the account summary shows "Your mode:" from it. It's sent on login and whenever the mode changes.
- **A fallen Hardcore Ironman:** `ironman_hardcore_dead` (5403) = 1, `ironman_downgradepermitted` (1776) = 1, and `ironman_hardcore_downgradedate` (5405) = the day of the death, counted from 27 February 2002. All three as in the rsprox captures, where the varbits appear together.
- **The chat icon:** Ironman 2, Ultimate 3, Hardcore 10 (mod icons).
  - StaffCrowns sets it: a staff crown first, otherwise the account's icon, which content answers through the custom event `account:chat-icon`.
  - `account:refresh-chat-icons` recomputes it.
  - The game sends these numbers with the chat line, so they're not in a cache table. Check them in game.

## The rules

Each rule comes from the rsprox capture database (https://rsprox.net/database) or the OSRS Wiki. A message marked *ours* hasn't been recorded or documented, and is meant to be replaced when someone records it.

| Rule | Modes | Message |
| --- | --- | --- |
| No trading with players, either way | all | "You are an Ironman. You stand alone." (captured); to someone asking an Ironman: "*name* is an Ironman. He/She stands alone." (captured) |
| No picking up items other players own (their drops and kills, also once public; unowned spawns are fine). Stacks from different owners never merge, so a public stack cannot absorb someone else's drop | all | "You're an Ironman, so you can't take items that other players have dropped." (captured) |
| No items from the Falador Party Room balloons (Wiki: Party chest, Party balloon): a pop takes nothing from the chest, and a drop another player popped is theirs (owned), so the pickup rule above applies. Ironmen cannot donate to the chest either (ours) | all | "As an Ironman, you stand alone." (donating, ours) |
| No drop from a kill another player damaged in the last 60 seconds (the same damage record that decides the killer; 0-damage hits aren't recorded). Eligible personal Nex rewards are an exception (Wiki: Nex) | all | "As an Ironman, you don't get loot if other players helped you kill the monster." (captured) |
| A warning when attacking an npc another player damaged (once per npc) | all | "As an Ironman, you might not receive kill-credit for this monster." (captured) |
| Loot from a player an Ironman kills is the fallen player's (Wiki: Ironmen can't take PvP loot) | all | none |
| No combat experience from fighting players (Wiki) | all | none |
| No entering another player's house (Wiki); own house remains available | all | Existing house-unavailable message *(ours)* |
| Shops sell only their own stock, never what players sold to them (Wiki) | all | "As an Ironman, you can only buy the shop's own stock." *(ours)* |
| Grand Exchange: only single-bond buy offers (Wiki); no sales or other purchases | all | "Ironmen can only buy one bond per Grand Exchange offer." *(ours)* |
| No presets: this server's PvP loadouts hand out items. Covers `::presets`, the interface, and the automatic opening after a death, which is skipped quietly | all | "As an Ironman, you cannot use presets." *(ours)* |
| No staking in the Duel Arena; a free duel is still allowed (Wiki: Ironmen can't stake) | all | "As an Ironman, you cannot take part in a staked duel." *(ours)* |
| No bank (the Ironman tutor, captured) | Ultimate | "As an Ultimate Ironman, you cannot use the bank." *(ours)* |
| No Seed Vault access ([Jagex update](https://oldschool.runescape.wiki/w/Update%3AThe_Seed_Vault)) | Ultimate | no Vault-specific line |
| All items dropped on death, none kept (the Ironman tutor, captured) | Ultimate | none |
| One life: a dangerous death makes them a standard Ironman; a safe death (a minigame) doesn't | Hardcore | "You have fallen as a Hardcore Ironman. You are now a standard Ironman." *(ours)* |

**Item-on-player:** the only hand-off that actually moves an item into the target's inventory
is a bond (`Bonds.plugin.js`), and the Wiki lets Ironmen give and receive bonds; Shield of
Arrav's half certificates are the other hand-off the Wiki exempts. Both are left alone, and no
other item-on-player route transfers an item (Castle Wars bandages and Hunter butterflies aid,
they don't give one), so there is nothing else to refuse.

## How it hooks in

Existing hooks:
- `onTradeRequest` (the trade request) and `onCanTrade` (the trade window itself, so a mode
  set mid-trade or a trade started directly still closes)
- `onGroundItemPickup`
- `onCanAttack`
- `onPlayerDeathItemDrop`
- `onCanGainExperience`
- `onCanBank`
- `onShouldKeepItemOnDeath`
- `onPlayerDeath`

Generic additions for these rules:
- **The npc death event** carries `damagers`: every player who damaged the npc, recorded before the killer is chosen. NpcDrops passes them into `npc-drops:roll`.
- **The player death event** carries `itemsLost`: whether the death was dangerous.
- **Presets** ask `presets:can-use` `{ player, allow, message }` before opening or applying one.
- **`ShopManager`** asks `shop:buy-limit` `{ player, shopId, itemId, available, original, limit, message }` before a purchase.
- **The Grand Exchange** emits `ge:offer-confirmed` `{ player, itemId, sell, quantity, accepted }` before escrow; Ironman restrictions can veto the offer. Collecting to a bank checks `onCanBank` first, including locked PIN, duel and Nightmare Zone restrictions. The collection box does not open a PIN keypad; enter the PIN elsewhere before banking a collection.
- **The Duel Arena** asks `duelarena:can-stake` `{ player, session, allow, message }` before an
  item is offered and, whenever a staked duel is accepted, for both players, so a mode change
  between the two final confirmations still refuses it.

## Not done yet

- **Group Ironman** (and Hardcore and Unranked Group Ironman).
- **A bank PIN** when choosing a mode, as OSRS asks for one.
- **Bonds:** Ironmen can buy a single bond per offer through the existing Grand Exchange screen; the OSRS Ironman-specific presentation is not yet implemented.
- **Other limits:**
  - Nightmare Zone group dreams;
  - other group-boss loot exceptions (raids, Wintertodt…);
  - other Ultimate storage limits (looting bag on PvP worlds, the POH costume room…).
