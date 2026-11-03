---
quest: Troll Stronghold
key: troll_stronghold
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Troll Stronghold

No native playthrough recorded; natural completion pending.

## Findings

Audit for issue [#1983](https://github.com/RSPSApp/tsps/issues/1983) against the Wiki and rsprox
captures 3, 738-742 and 1633 (no capture of Dad's arena exists).

- Fixed: the first rocks north of the Death Plateau (loc 3748) were the 44 Agility Trollheim
  shortcut; they need 15 Agility and worn climbing boots, as captured (capture 3).
- Fixed: Dad's challenge plays on walking into the arena; "I accept your challenge!" starts his
  attack; he surrenders ("Stop! You win.") instead of dying, which advances the quest; only
  "Prepare to die!" kills him and turns the spectators on the player; afterwards he can't be
  attacked or talked to.
- Fixed: the arena entrance and exit open (pass-through gates); Dad blocks the exit until beaten.
- Fixed: the Trollheim thrower path is multi-combat (Wiki multicombat map, capture 1633), and the
  throwers hold their tiles while throwing instead of chasing players down the mountain.
- Fixed: a Troll general dropped two prison keys (the drop table's and the quest's own).
- Fixed: the prison door opens and shuts behind the player (capture 740).
- Fixed: cell doors swing open and lock again per unlock, so every player frees their own
  prisoners; Godric and Eadgar answer Talk-to from their cells (captures 740, 741).
- Fixed: the prison's Exit and the Secret Door work; the Trollheim advanced rocks (loc 16523)
  follow capture 3 and no longer strand players on the ledge.
- Open: Berry (sleeping) is aggressive from the generated monster data (the Wiki infobox also
  says so, though its text says he only wakes on a failed pickpocket).
- Open: Dad's knock-back swing, the 16523 climbing animation and the Secret Door's refusal
  message have no capture.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q120); PRs: [#1184](https://github.com/RSPSApp/tsps/pull/1184).
