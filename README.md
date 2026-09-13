# Round Rock 1878 — Historical Slice v0.5.0

## What this build tests

This is the first **Script the history / Simulate the people** slice.

It deliberately preserves the live conversation plumbing from v0.4.1, because that was the version that actually conversed. The new work is a deterministic Contentstream world engine underneath it.

### Slice

1. Jeb meets the possible new hand near Brushy Creek.
2. The historical world independently introduces Ranger pressure after 60 seconds (compressed test clock).
3. Ranger pressure rises without inventing new facts; what changes is Jeb's priority.
4. Test checkpoints let the field tester mark: bridge in sight → bridge crossed → Old Town reached.
5. A bounded Miller / Murphy beat can then enter the world.

The visitor can still talk about anything. The engine owns what has happened and what is currently true; GPT-Live owns Jeb's performance.

## Core architecture

`deterministic historical state -> current world update -> Jeb's knowledge/priorities -> live performance`

The plot is **not** delegated to the language model.

## Important honesty / current limitation

Turn-ending remains the known weakness from v0.4.1. This build does not attempt another speculative fix to VAD/turn detection. If the session fails to recognize the end of a spoken turn, use the same workaround that worked in testing. The purpose of v0.5.0 is to test world pressure and route motivation without destabilizing the live loop again.

## Contentstream x-ray

Open **Contentstream x-ray · v0.5.0** to see current state and manually advance field checkpoints. The test buttons are scaffolding, not intended final experience UI.

- **Bridge in sight** — makes the bridge a known physical option and Jeb's natural route to Miller.
- **Bridge crossed** — marks movement toward Old Town; silence remains valid during walking.
- **Old Town reached** — changes scene and makes finding Miller the immediate obligation.
- **Miller / Murphy beat** — adds a bounded fragment; Murphy's future significance remains unknown to Jeb.
- **Inject Ranger word now** — bypasses the 60-second timer for bench testing.
- **Increase pressure now** — raises urgency without inventing new information.

## Test question

Does the same Jeb who begins by sizing up the new hand become increasingly motivated to cross toward Old Town **because the world changed**, rather than because a script told him to give directions?

If yes, the slice has proved the separation we need.

## Deploy

Same Render service and same `OPENAI_API_KEY` as the working v0.4.1 build.

Health endpoint should return service:

`round-rock-1878-historical-slice`
