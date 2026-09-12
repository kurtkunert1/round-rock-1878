# Round Rock 1878 — Live World v0.2.1

This is the v0.1 GPT-Live proof with the Contentstream world engine restored behind the live conversation.

What changed:
- persistent shared-observation state (creek, bridge, Old Town, Stagecoach, reported construction hazard)
- relationship state and negotiation memory
- explicit safety preemption
- deterministic gravity / sufficient-reason diagnostics
- an independent historical event clock
- main-story pressure that enters because the world changes, not because Jeb remembers to tell a story
- partial/uncertain Ranger information first; Sam Bass can enter later as rumor, with uncertainty preserved
- hidden Contentstream state updates injected into the live session without turning the UI into a control panel

Deployment: replace the existing v0.1 repo contents with these files and redeploy the same Render Web Service. No new environment variables are required. Keep OPENAI_API_KEY.

Test trace: expand “Contentstream X-ray” in the page if you want to inspect state, event, gravity, and sufficient-reason transitions. The normal visitor does not need to open it.


## v0.2.1 fix
Responses delegation is now explicitly started with `response.create` after each completed visitor turn. OpenAI's GPT-Live docs state that configuring Responses delegation does not itself force the live model to delegate. The UI logs `CONTENTSTREAM backend requested`, `delegation created`, and backend completion so the handoff is visible in the X-ray/log.
