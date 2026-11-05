# Kickoff prompt

Paste this as the first message of the cloud coding session (repo containing this kit):

---

We're building **Terrain Prompter**, a browser-based, GPU-accelerated terrain generator for my Shadowdark westmarches campaign. I shape a region of about 20×16 six-mile hexes with natural-language prompts and brushes, and get realistic eroded terrain I can view over the whole region and fly down into a single hex.

1. Read `CLAUDE.md` and all of `BRIEF.md`, and look at every image in `reference/`. Image 01 is what I *don't* want (continental scale, abstract colours). Images 02–04 are the look I'm after at different altitudes.
2. Create `PROGRESS.md` with your plan for the milestones in BRIEF §10 and any questions or risks you see. Make reasonable calls rather than waiting on me, and note them.
3. Then build M1 through M4 (skeleton → op stack → GPU erosion → the realistic look), with screenshots and progress notes after each one. Spend real iteration on M4: comparing screenshots against the references is the most important feedback loop.
4. If you still have room after M4, continue with M5 (the prompter) and M6 (brushes).

Commit and push as you go.

---

## Follow-up prompts for later sessions

- "Continue from `PROGRESS.md`. Next milestone is M5 (the prompter). The mock provider must work without an API key."
- "Do a look pass: run the shots, compare to `reference/02–04`, list the five biggest visual gaps, and fix them in order."
- "Performance pass against BRIEF §3 targets. Add an fps/timing overlay and report numbers."
