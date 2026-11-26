---
quest: Daddy's Home
key: daddys_home
status: passed-with-issues
tested: 2026-11-22
tester: agent
model: claude-opus-5-5
commit: c74d18235
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Daddy's Home

A fresh account played the quest from Marlo's start to the opened crate over the agent MCP, with Quest Helper
agreeing at each check. The lecture was played in full, and its opening was also watched in a headless client. The
statuses, dialogue, rewards and XP match the rsprox capture DaddysHome (rev 242.1; see docs/daddys-home.md).

## Findings

- **open** In the web client, the first lecture room's roof hides the build. The server sends
  `option_hide_rooftops_override` = 2 as live does, but the web client has no rooftop hiding; the official client
  through the gateway would hide it.
- **fixed** A build interrupted on the tick after its last nail lost its planks without building the piece. Fixed in
  this change: the piece lands once its materials are taken.

## Runs

### 2026-11-22 · agent · claude-opus-5-5

- **Start:** fresh account with a house (`::maxhouse`), a hammer, a saw, 10 planks, 5 bolts of cloth and 60 steel
  nails, placed by Marlo with `::tele` (the only teleport).
- **Route:** Marlo (not joined: the Varrock branch welcome, favour, job, Yes on the start prompt), `travel_to` Yarlo,
  removal of all seven pieces, Yarlo (status 3, the Rimmington line), Listen (all 12 lines, three copies, back on the
  start tile), the briefing (4, 5), the help menu, the crate, six pieces, `travel_to` the Varrock sawmill (the waxwood
  line third, 6), back for the bed, Yarlo (10), `travel_to` Marlo (11, reward, 13), the crate (14).
- **Result:** status 14, 1 Quest Point, Construction XP 539 from the furniture plus 400, 1,000 coins, the crate's 25
  noted planks, 50 mithril nails, 5 noted steel bars, 10 noted oak planks, 8 noted bolts of cloth, 5 house tablets and
  a Falador tablet. Repeat Marlo after the quest, a relog (stage, QP and items kept) and a server restart mid-quest
  (furniture state kept).
- **Not checked:** the bug above cost 3 planks, given back with `::item` after the fix. The joined Mahogany Homes
  menus and the no-house reward were covered by the tests, not this run. The lecture after the quest was covered by
  the test and the capture, not this run. Only the lecture's opening was watched on screen.
