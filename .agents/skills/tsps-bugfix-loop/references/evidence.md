# Evidence and source fixes

Follow [server source rules](../../../../server/docs/agents/sources.md).
Plausible bugs stay open: evidence is optional for obvious defects; ask precisely
when expected mechanics remain unknown. No bulk closures for missing evidence.
A missing ordinary gameplay handler is implementation work, not automatically a capture blocker.

## Search once, retain what was learned

- Check cited captures, cache and canonical Wiki/transcripts before guessing.
  Cache IDs, animation lengths, repeated sightings or static placement do not
  establish reward triggers, rates or timers. Archived official Knowledge Base
  pages can fill gaps, but date them and disclose uncertain modern applicability.
- Query exact loc/NPC/item/message IDs. Keep inspected, unexamined and excluded
  captures distinct, with hashes/revision/ticks and missing transitions.
  Check new evidence against that manifest; don't repeat exhausted broad searches.
  A modified-mode capture may still prove a positive interaction, not normal-world timing.
- Inspect real binary-cache widget/enum/varbit writers and consumers for UI bugs.
  Historical pretty dumps can differ. Canonical dialogue wording beats invented messages.
  Nearby unattributed sound/animation is not crossing proof.
- Exclude generated/minified data from broad text scans; parse the needed fields.
  Resolve QuestHelper paths from its pinned repository tree rather than guessing packages.

## rsprox lookup

Verified API shape (recheck if it changes):

```json
{"conditions":[{"type":2,"query":"27433"}],"page":0,"limit":100}
```

POST to `https://rsprox.net/api/search`; sort omitted or `NEWEST`, not lowercase.
Types: NPC 0, item 1, loc 2, message 4, varp 5, varbit 6, text 14.
Archive ID is `submission.id`; empty conditions fail. Recording date is not upload date.

Download `https://rsprox.net/download/<id>` (gzip binary). Use a compatible rsprox
transcriber and Java runtime available in your environment; locate its classpath
rather than assuming an installation directory. Quote classpath globs. For Java
state isolation, `-Duser.home=<owned scratch>` works; changing HOME alone does not.
Bound decoding; retain binary hashes and revision/tick references. Share only
sanitized evidence, keeping private captures and account data outside Git.

## Generated data / parser repairs

- Never edit generated osrsreboxed JSON, even conflict fixes or repaired-output
  overrides. Fix original source/parser/export in `../osrsreboxed-db`, add regression
  coverage, regenerate twice identically, then import and disclose all remaining differences.
- Start the dumper branch from freshly verified upstream SHA, not a stale sibling
  checkout. Preserve newer canonical inputs and publish source/game dependencies explicitly.
- Read enclosing Wiki headings, version selectors, comments and quest ownership:
  ItemSpawnLine also describes scenery, and normalized data can omit unobtainable caveats.
  Infobox respawn ticks do not establish units in free-text coordinate overrides.
- Preserve duplicate source arguments and invalid version candidates; mixed valid/unknown
  inputs must not be silently reported resolved. Test parser boundaries, not repaired output.
