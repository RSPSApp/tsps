# Chompy hunt lifecycle implementation plan

> For agentic workers: implement sequentially with the executing-plans workflow; independent review follows implementation. Select focused checks under the project testing policy.

**Goal:** Replace guaranteed instant Chompy spawns with OSRS's documented per-bait timing and probabilities, without regressing native Drop, quest progression, or pet acquisition.

**Architecture:** A quest-local `Hunt.BigChompyBirdHunting.js` owns placed bait, concurrent birds, carcass expiry and its own tick task. The existing quest owns stages, Rantz's demonstration, equipment gates, rewards and plucking. Use actual task, NPC, map collision/line-of-sight, inventory, diary and damage services through `api.core`.

**Tech stack:** source-loaded CommonJS plugins, TypeScript server core, Node focused tests, revision 241 cache, isolated worktree slot 5.

## Evidence and limits

- Wiki `Bloated_toad`: rolls at ages 25/50/75/100 ticks, probability 1/5 per attempt, no further attempt after success, burst after one minute. Toads are independent; player distance does not affect their roll. Landing is an empty tile 3–10 tiles away with line of sight. One bait per tile; more than three can be placed.
- Wiki `Chompy_bird` / `Achievement Diary/Rewards`: easy/medium/elite Western diary rewards give 25%/50%/100% double birds; live birds expire after one minute, unplucked carcasses after two minutes.
- Cache names establish bait/bird/carcass actors and landing/leaving/burst animations. Local captures 226/01694 and 235/00948 show the actors coexisting and birds moving; their bystander observations cannot establish the owner's action-to-roll timings.
- Exact Rantz demonstration shot/camera timing, precise hunting-area/turf boundaries, and consume-animation sequencing are not established by those observations. Do not invent an OSRS parity claim for them or change unrelated rewards/combat.

## Global constraints

- Own worktree only; no live server or generated JSON edits. Separate follow-up branch from reviewed PR #2929.
- Real input → dispatcher → plugin → real state owners in integration checks. Controlled RNG and fixture checkpoint setup must be disclosed.
- Timers follow game ticks, not wall-clock sleeps. Walking and distance must not cancel a placed bait's rolls; logout/shutdown must remove owned transient actors/tasks safely.
- Spawn failure must preserve the item. A duplicate tile must preserve the item. One successful bait must not roll again or remove another bait's bird.
- Builder-check rulings: placement failure preserves inventory; later failed landing/spawn consumes a roll without minting inventory. Explicitly assign each actor the captured private area (spawnNpc does not inherit it). On age 100, perform the fourth roll before bursting. Remove bird tracking at death before registering its separate carcass. First-hunt callbacks accept an already spawned actor and must not restart the demonstration for a second bait.
- Keep original issue comments/closures gated on verified #2929 merge; read issue state first to avoid duplicate close operations.

## Task 1: Tick-driven bait and bird lifecycle

**Files:** new `server/plugins/quests/quests/Hunt.BigChompyBirdHunting.js`; modify `BigChompyBirdHunting.Quest.js`; new `server/tests/chompy-hunt-lifecycle.test.cjs`.

**Interfaces:** factory consumes `api` and quest callbacks for a spawned bird / exhausted first-hunt bait. Produces `place`, `ownsBird`, `removeBird`, `trackCarcass`, `forgetCarcass`, `cleanup`, `shutdown`.

- [x] Add failing real-object cases for no instant spawn, exact roll boundaries, four failures, threshold 1/5, success stopping rolls, duplicate tile and independent bait.
- [x] Implement one task visiting only owned live actors; snapshot placement tile/private area; use registered cache NPCs.
- [x] Select random valid empty landing tiles at Chebyshev range 3–10 with real clipping/LoS. Resolve animation IDs by cache name. Stop rolls only after a real bird was created.
- [x] Query existing claimed Western diary reward service for the second-bird chance, never a synthetic completion attribute.
- [x] Keep concurrent birds instead of replacing an earlier one; apply documented bird/carcass lifetimes and owned bait explosion damage.
- [x] Test real logout/shutdown cleanup, owner/plane separation, no distance gating, full inventory, late rolls, and normal successful paths. Keep exact unrecorded animation offsets identified.

## Task 2: Quest and native-input integration

**Files:** existing quest, `chompy-bait-actions.test.cjs`, `qh728-q006.test.cjs`, `chompy-pet-acquisition.test.cjs`.

- [x] Native Drop creates bait at the player's tile, consumes only on successful placement, then waits for a roll. Rantz's demonstration begins when a bird arrives, not on Drop.
- [x] Failed first bait remains retryable. Multiple bait successes do not restart the same Rantz demonstration. Existing first-hunt timing remains explicitly unverified; a missed bird remains available within its natural lifetime.
- [x] Generalize kill/pluck ownership to every spawned bird/carcass; keep once-only quest progression and existing pet eligibility/roll services.
- [x] Update existing tests to advance real hunting ticks under disclosed controlled RNG, rather than expecting instant birds. Preserve useful lifecycle/capacity assertions.
- [x] Run only the affected lifecycle/native/quest/pet checks. Build only if compiled code changes; otherwise verify matching existing dist freshness.

## Task 3: Review, rendered verification and delivery

- [x] Independent reviewer traces actual tasks, map LoS, diary reward query, removal/respawn semantics and adversarial ownership/timer transitions on the exact source/build.
- [x] On owned slot 5, inspect placed bait and delayed bird arrival with a rendering client. Exercise native Drop / duplicate refusal and actual quest continuation. Disclose seeded checkpoints/RNG and any unverified visible timing.
- [x] Gracefully save/stop own QA server, close own client/tab, verify assigned ports clear.
- [x] Publish a separate follow-up PR with sources, production path, focused test results and exact limits; release claim.
- [x] Once #2929 is merged, comment on #2918 and #2920 and close any still-open issue, then verify states and record handoff on the local board.
