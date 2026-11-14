# Amulet of blood fury

## Inventory creation and recharging

The [Blood shard transcript](https://oldschool.runescape.wiki/w/Transcript:Blood_shard)
sets the dialogue and consumption rules for using a blood shard on an amulet:

- Creation shows two item-box warnings (irreversible shard consumption and the
  untradeable result), then offers Yes/No. Accepting consumes one shard and turns
  the existing fury into a blood fury with 10,000 charges. Declining preserves both.
- Recharging asks whether to use the shard. Accepting consumes **one** shard and
  adds up to 10,000 charges, even when more shards are carried.
- Above 20,000 charges, accepting first shows an item-box warning about the
  30,000 cap and a separate “Recharge anyway?” choice. Declining either choice
  preserves the shard and amulet. Accepting the second choice consumes one shard
  and fills the remaining capacity, wasting the excess.
- At 30,000 charges the action reports that the amulet is already at maximum
  capacity and consumes nothing. Successful creation/recharging uses an item box;
  recharging reports the actual charges added and the resulting total.

The [amulet page](https://oldschool.runescape.wiki/w/Amulet_of_blood_fury)
also specifies the 10,000 starting charges and 30,000 cap. These pages were checked
on 27 October 2026. No indexed rsprox recordings were available for blood-shard or
blood-fury inventory actions, so these changes rely on the Wiki transcript rather
than captured packet timing, animation, sound or varbit evidence.

The previous handler consumed multiple shards immediately and refused top-ups
with less than 10,000 free capacity. The handler now follows the choices above and
rechecks the actual amulet identity, ownership, charge count and available shard
before consumption. Changed ingredients invalidate the pending choice.

## Melee charge use and healing

The amulet page specifies a 20% chance to heal 30% of damage dealt by melee,
one charge per successful melee hit (including separate hits in a multi-hit
attack), and reversion to a normal fury when exhausted.

The effect listens to `combat:hit-queued`, which `CombatFactory.addPendingHit` emits for a
player's hit on the attack's tick, after protection prayers and damage caps and before the
target's hit delay (an NPC's hitsplat comes a cycle later). For a melee hit with the amulet
worn it spends one charge on each damaging hit, sends the 500-hit countdown, and rolls the
20% proc. A proc shows its graphic once per attack and heals when that hitsplat lands
(`HitDamage.onApplied`) by 30% of the HP actually removed, rounded down, so damage queued
earlier in the same cycle and overkill never heal. A hit queued on a target that dies before
it lands still spends its charge. At 0 charges it reverts to an amulet of fury.

## Check, countdown and proc graphic (rsprox captures)

- **Check** (worn, `wornitems:slot2` op 2): the next tick sends
  `Your Amulet of blood fury will work for <n> more hits.` with the count
  comma-grouped (rsprox.net recs 1166 tick 419: 12,847; 1637 tick 476: 8,181).
- **Countdown:** each time the charges reach a multiple of 500, live sends
  `Your Amulet of blood fury can perform <n> more hits.` on the attack's tick
  (rec 481, rev 233, tick 690: 7,000; the Leagues recs 1148, 1195-1247 show the
  same line every 500 from 28,000 down to 17,500). At 0 the shard breaks instead.
- **Proc graphic:** a proc shows spotanim 1542 (`sanguinesti_staff_heal`), height 92,
  delay 0, on the **target**, the tick of the attack animation; the hitsplat comes
  the tick after (rec 481 ticks 273/274, 279/280, 327/328, 508/509, elder maul).
  It plays at full HP too (the player was at 99/99 throughout), with no sound of
  its own. 14 of the recording's 90 attacks proc, in line with the Wiki's 20% of
  successful hits.

The inventory Check uses the same handler; only the worn op is captured. The
"run out of charges" line when the shard breaks is ours: no capture reaches 0.

## Validation

Regression coverage invokes the registered inventory handlers and real dialogue
entries: creation acceptance/decline, one-shard recharging, 20,000/20,001/25,000/
29,999/30,000 boundaries, both cancellation branches, changed ingredients, reversed
item order, Check/Revert, ordinary melee event dispatch, multiple damaging hits,
exhaustion and the exclusion of magic/ranged hits and inventory-only amulets.

In-game verification covered creation warnings and cancellation, creation at 10,000,
recharge cancellation, separate top-ups to 20,000 and 30,000, refusal at full
capacity, and the waste-warning path after ordinary melee combat spent charges.
Both declining and accepting the final waste warning were checked, including the
remaining shard count and Check's resulting 30,000 charges.

## Scope and evidence gaps

Bank Configure-Charges/automatic withdrawal charging is a separate bank interaction,
documented by the [Configure-Charges page](https://oldschool.runescape.wiki/w/Configure-Charges),
and is not implemented here. PvP death conversion belongs to the death system and
was not changed or verified by this change.

The amulet page lists a four-tick creation recipe, but the transcript does not
establish a post-confirmation delay. Without a recording establishing that timing,
this change makes no claim about matching creation packet timing. Revert's feedback is not captured and
not claimed to match live packets. Healing probability is checked deterministically
in regression coverage; in-game melee verification checks actual charge loss.
