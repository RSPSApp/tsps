---
quest: Heroes' Quest
key: heroes_quest
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Heroes' Quest

No native playthrough recorded.

## Deviations

- **Solo gang route (decision approved 2026-11-15).** Live OSRS needs a second player from the
  other gang (OSRS Wiki, Heroes' Quest: "This quest requires another player to complete"). The
  Black Arm member gets the miscellaneous key from Grip as Hartigen and trades it to the Phoenix
  member, who kills Grip through the arrowslit; the Black Arm member opens the treasure room with
  Grip's keyring and hands one of the two candlesticks to the Phoenix member. Here one player
  finishes their own Shield of Arrav gang's route alone: Grip's kill gives that player his keyring,
  the chest gives them a candlestick, and there is no misc. key or candlestick hand-over. Reason: a
  partner from the other gang is often not online on a low-population server, so requiring one
  would block the quest. See the header of `server/plugins/quests/quests/HeroesQuest.Quest.js`.

## Findings

- **open** The solo route above is a documented deviation from live, not a defect to fix. #4305

## Runs
