# Sparkfield UX Decision Record — Say / Do affordances

**Status:** Accepted design direction; not yet implemented
**Recorded:** 2026-10-19
**Origin:** Thomas's first-play feedback from Round Rock 1878, followed by clarification in conversation
**Scope:** Engine-facing interaction contract and player interface; not an audio-specific feature

## Context and observation
Thomas, a UX director, played an improvised Round Rock 1878 session and immediately recognized the interaction as “Zork meets Dungeons & Dragons.” His suggestion for **Say** and **Do** was primarily about **discoverability and the rules of engagement**. A first-time player should not have to guess how to address someone versus take an action in the world.

## Decision
Provide visible **Say** and **Do** affordances for free-form player input.

- **Say** expresses an utterance by the player character (e.g. “Jeb, I'm Rusty Willie.”).
- **Do** expresses an attempted action in the environment (e.g. “I climb onto the horse.”).
- Both accept unrestricted natural-language text. These are **intent signals, not command menus**.
- The same two affordances must work with typed input. Speech recognition and voice output are optional interface adapters, not governing architecture.
- Avoid making success implicit: **Do** describes an attempt, not a guaranteed state transition; NPCs and the environment may refuse, resist, or constrain it.
- Avoid making truth implicit: **Say** establishes that an utterance occurred, not that its propositions are true.
- Observation, waiting, inspection, and silence remain valid player behaviors; the interface must not force every input into dialogue or successful action.

## Proposed engine contract (implementation target, not a claim about current code)
Capture user input as a typed ObjectExchange before resolution:

```json
{
  "kind": "player_input",
  "intent": "say",
  "raw_text": "Jeb, I'm Rusty Willie.",
  "actor": "Player",
  "recipient": "Jeb",
  "status": "registered"
}
```

For Do, `intent` becomes `"do"`; the target may be an object or environment. Preserve the raw input and provenance in both cases. The resolver decides what is supported, possible, unknown, or contested; the world applies only justified state changes; expression follows if warranted.

**Pipeline:** input intent → ObjectExchange → observation/authority checks → resolution → justified state changes → optional expression.

## UX implications
1. Display the Say/Do choice adjacent to the free-form input, with concise examples or helper labels. Users should understand it without opening a tutorial.
2. Preserve the selected mode visibly when composing and reviewing a turn.
3. Keep characters' responses and consequential world events distinguishable in the transcript; voice is not necessary.
4. Test whether a first-time user understands how to talk to Jeb, act on an object, and intentionally wait or observe, without explanation.
5. If a sentence contains both speech and action, do not silently reinterpret it; support explicit segmentation or clarification when that distinction affects consequences.

## Acceptance tests to add
- “I draw my revolver” submitted via **Do** is treated as an attempted physical action, not dialogue.
- The identical string submitted via **Say** is registered as something said, not automatically acted.
- “I saw Rangers by the creek” via **Say** updates what Jeb heard, not established Ranger location.
- Impossible or disputed actions remain attempts and do not silently become historical world facts.
- Typed-only play is fully functional with audio disabled.
- A new participant identifies when to use Say versus Do without a walkthrough.

## Evidence and limits
Thomas enjoyed the free-form roleplay and recommended interaction affordances and a bounded first product. That observation supports the value of clarifying player engagement; it does not by itself validate the independent engine's effect on enjoyment. The Say/Do choice is a design decision awaiting implementation and user testing.

## Design principle
**Affordances make the rules of engagement legible without putting a ceiling on imagination.**
