# Daddy’s Home construction demonstration

After removing Yarlo’s furniture, **Listen to Yarlo** plays the existing lecture in a private copy of the Construction parlour, then returns the player to Yarlo’s Varrock house and the building briefing. The demonstration uses the canonical `PARLOUR` chunk from Construction’s room data. It copies one chunk on each plane, so the surrounding Varrock house is absent from the instance palette. The builder, camera and demonstration furniture use translated source tiles. Normal completion and interrupted area exits release controls and discard the copy; the persisted lecture exit lets login recover an in-copy save.

The implementation is an **approximation**: recording **3218, revision 232.1**, shows a different village-style room, **which is not reproduced here**. The [maintainer’s decoded-capture review](https://github.com/RSPSApp/tsps/pull/4656#pullrequestreview-5871279823) identifies source chunks at (1800,5696,0), (1800,5704,0) and (1800,5704,1), with filler from (1848,5696,0), rather than the Construction parlour. In that review’s decoded `rsprox_transcripts/232/03218.txt` serialization, the rebuild is at lines 11255–11256, the builder at line 11421 and the first lecture message at line 11430. Line numbers are specific to that decoded version; they are not universal recording offsets.

This fix retains the parlour as a deliberately different demonstration room to remove the real-house overlay. Its chair, bookcase and fireplace, builder/camera tiles and timing do not reproduce the recorded room. Cache 242/OpenRS2 2757 has this approximation’s parlour at chunk 232,887; its chair hotspot 4517 is at 1860,7099 (shape 10, face 2), west bookcase hotspot 4521 at 1856,7097 (shape 10, face 0), and fireplace hotspot 4523 at 1859,7103 (shape 10, face 1). Those are current-cache placement checks, not evidence that the recording contains this furniture.

After building the server and supplying its configured cache, run:

```sh
cd server
node --test --test-concurrency=1 tests/quest-scene-return-state.test.cjs
node --test --test-concurrency=1 tests/daddys-home.test.cjs
```

The scene fixture uses real players, sessions, client input dispatch, tasks and cache maps, seeded after furniture removal. It checks the ordinary Talk-to/Listen choice, encoded instance rebuild, room composition, translated actors/camera, owner/bystander separation, return state, supplies/XP and interrupted exits. It forces boundary crossing and death because the cinematic normally blocks movement and targeting. Its restart-recovery case supplies saved attributes to a fresh player and invokes login; it does not restart a running server or reload a save from disk. The existing Daddy’s Home suite covers removal, building materials/XP, skip dialogue and one-shot rewards. Native packet/state checks do not prove rendered client output, audio, natural quest traversal or full World processing.
