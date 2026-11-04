# Toxic blowpipe

The toxic blowpipe keeps its scales and darts in item metadata. This page records what the
inventory options are called, what each one returns, and the evidence behind the fix for
issue #2096 (unload did nothing).

## Inventory options

The charged blowpipe (12926) has cache inventory actions
`[null, Wield, Check, Unload, Uncharge]`; the empty one (12924) has `Dismantle`/`Drop`. The
cache client script 7779 copies **action slot** `n` onto widget op `enum 4303[n]`, so the
click a client sends is not the slot number:

| Slot | Action | Widget op | Server option index |
| --- | --- | --- | --- |
| 1 | (empty) | 2 | 1 |
| 2 | Wield | 3 | 2 |
| 3 | Check | 4 | 3 |
| 4 | Unload | 6 | 4 |
| 5 | Uncharge | 7 | 5 |

`ItemActionPacketListener.resolveInventoryWidgetAction` already inverts that enum, so the
plugin's `event.clickType` is the table's last column. The old handler assumed `2 = Unload`
and `3 = Check`, which are actually **Wield** and **Check**: right-click Wield unloaded the
whole pipe and Unload fell through the `clickType === 4` equipment-only branch and did
nothing. The plugin now hooks the actions by option name (`api.onItemAction("Toxic blowpipe",
{ Check, Unload, Uncharge })`) like the other charged items, so the slot layout cannot shift
it. The empty pipe has no options that need handling; the worn `Check` comes from item param
451 and resolves the same way.

Evidence for the mapping: rsprox 1637 (rev 226) has
`If3Button(interfaceId=149, componentId=0, sub=0, obj=12926, op=4)` answered with the Check
line, and rsprox 1858 (rev 227) equips a drygore blowpipe from `op=3`; op 7 drops an item
whose fifth slot is `Drop` (1637, manta ray).

## Check

The captured line (rsprox 1637 and 4121, both toxic blowpipes) is:

```
Darts: <col=007f00>Iron dart x 1,687</col>. Scales: <col=007f00>794 (4.8%)</col>.
```

Counts use thousands separators and the scale percentage is one decimal of 16,383. Only the
parts the pipe holds are printed (rsprox 1858, a drygore: `Darts: <col=007f00>Dragon dart x
207</col>.`). The scales-only wording is not captured; the same two parts imply
`Scales: <col=007f00>N (x.x%)</col>.` on its own.

## Unload and Uncharge

- **Unload** returns the loaded darts to the inventory and leaves the scales in the pipe, so
  the item stays the charged 12926 (the issue report: "unload should take all darts out").
- **Uncharge** returns the scales and the darts, and the pipe becomes 12924. The Wiki's
  Toxic blowpipe page: "Uncharging the blowpipe will return all remaining darts and scales."

Both ask first. rsprox 1862 and 550 (a drygore blowpipe's Unload) show the native
`confirmdestroy` chatbox (interface 584, setup script 814) with
`Are you sure you want to uncharge it?` / `If you uncharge the blowpipe, all darts will fall
out.`; confirming returns the darts and empties the pipe (here the drygore holds no scales).
The Uncharge warning is not captured and uses the toxic blowpipe's own destroy text from the
Wiki instead: `If you uncharge the blowpipe, all scales and darts will fall out.` Confirming
re-checks the slot still holds the same item. The destroy confirmation and the pipe's share
interface 584, so whichever opens second owns the prompt: Destroy's `destroy-item:prompt`
clears a pending blowpipe prompt, and the pipe closes any open prompt
(`sendInterfaceRemoval`, which also resets `destroy-item:pending`) before installing its own.
Without the latter, an unanswered Destroy prompt on another item stayed pending, DestroyItem
(registered first) consumed the pipe's Yes, and the other item was destroyed while the pipe
kept its darts.

A full inventory refuses before the prompt with the live message
`You don't have enough free inventory space to do that.` (rsprox 1637, same wording). The
return is checked again when Yes is answered, against the inventory as it stands then: the
inventory can fill up while the prompt is open (unequipping into the last free slot is a
widget action that leaves the chatbox mounted), and `Inventory.add` would silently drop the
stack while the pipe's metadata was cleared. If the darts (or scales) no longer fit, including
the existing stack's headroom, the same message is sent and the pipe keeps what it holds.

Space is counted the way `Inventory.add` merges stacks: same item id **and** same metadata.
An existing stack of the returned id only saves a slot when it carries no extras; a custom
preset's darts (`preset`, `untradeable`, `unbankable` metadata) share the id but not the
metadata, so the ordinary darts Uncharge returns still need a slot of their own. Counting by
id alone let the scales take the only free slot and the 120 returned darts then vanish while
the pipe's metadata was cleared.

## Validation

`server/tests/toxic-blowpipe.test.cjs` drives the registered handlers: the captured Check
line, Unload returning darts and keeping 5,000 scales on a charged pipe, Uncharge returning
both stacks and switching to the empty id, the no-space refusal (no prompt), and that the
hooked actions are exactly the pipe's cache options so Wield cannot unload it. With
DestroyItem and ToxicBlowpipe both registered in the manager's order and its stop-at-first
handler dispatch, opening Destroy on another item and then choosing Unload or Uncharge leaves
that item in the inventory and answers only the pipe's prompt. A second pair fills the
inventory between opening the pipe's prompt and answering Yes (unequipped gear into the last
slot): the refusal message is shown and the pipe keeps its scales and darts. A preset dart
stack is covered in both positions: already in the inventory with one free slot when Uncharge
is chosen, and arriving in the last free slot while the prompt is open. Both refuse and leave
the pipe, the preset stack and the held scales untouched.
