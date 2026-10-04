# LrC-AVG HUD redesign: deliverables

Design work for the LrC-AVG Lightroom Classic plugin's HUD, done on 2026-10-04 in a backgrounded cloud run. Nothing here is built. The gateway clone (`jimjohnbeebe-jpg/lrc_autonomous_gateway`, `main` at 75369b7) was only read. Every mockup is drawn over a mockup stage of Lightroom's Develop module (`stage/stage.js`), not over Lightroom itself, so all geometry is [stage].

The three layout options, with names fixed across every file:

- **Option A "Island"**: one row in Lightroom's black top band, between the identity plate and the module picker.
- **Option B "Rail"**: a Lightroom-style panel stack over the left panel column (Navigator, Presets, Snapshots, History).
- **Option C "Deck"**: a wide, low bar over the filmstrip band at the bottom.

Decided by Jim on 2026-10-04: all three layouts, chosen on the plugin settings page, with C "Deck" as the default (spec D4).

## Read in this order

### 1. The critique of the Grok draft

[`lrc-avg-hud-critique.md`](lrc-avg-hud-critique.md) explains why the Grok spec was not kept. Its main point is that the draft assumes per-pass Keep and Revert, variant toggles and a Put back command. The gateway has none of these: every pass is already written to the photo, Pick is a one-time choice between virtual copies, and the HUD's only way back is Abort. It lists the draft's factual errors, design problems, omissions and conflicts with PRODUCT.md, and ends with three questions only Jim can answer.

### 2. The spec

[`lrc-avg-hud-spec-v2.md`](lrc-avg-hud-spec-v2.md) is the replacement spec. Section 2 holds the decisions, now taken:

| Decision | Decided (2026-10-04, spec section 2) |
|---|---|
| D1. Out-of-process HUD | Yes. The classic LrView HUD stays as a fallback and as the "Classic window" layout. |
| D2. Runtime | Tauri v2, pinned to 2.12.x. S9 validates it; Electron was dropped after re-evaluation. |
| D3. Data path | The engine hosts the HUD channel. |
| D4. Layout | All three (Deck, Island, Rail) plus Classic, chosen on the settings page; Deck is the default. |
| D5. Engine additions | Deferred, except the v1 minimum that D3 and Deck need (Q15, agreed). Put back: keep both Abort and Put back, with existing functionality (Q14). Nothing starts until Jim says go. |

Section 2.6 gives the build order. Sections 3-12 cover architecture, window behaviour, the state table, actions, the Changes view, the visual system, budgets, copy and acceptance criteria. Section 13 lists the open questions and every [unverified] item.

### 3. The overview

[`mockups/overview.png`](mockups/overview.png) (2400 x 2761) shows the three options side by side, each with its in-context frame, 1:1 close-ups, best case and main trade-off. Its source is [`mockups/overview.html`](mockups/overview.html). Re-render it from this folder with `node render.cjs mockups/overview.html mockups/overview.png --w=2400 --scale=1 --selector=#sheet`.

### 4. Option A "Island"

| File | What it shows |
|---|---|
| [`mockups/option-a-context.png`](mockups/option-a-context.png) | Scene C at rest, in context, 1920 x 1080 |
| [`mockups/option-a-context-open.png`](mockups/option-a-context-open.png) | Scene P with the details open (This pass), 1920 x 1080 |
| [`mockups/option-a-states.png`](mockups/option-a-states.png) | The states sheet, 19 rows, scale 2, 2400 x 5614 |
| [`mockups/option-a-details.png`](mockups/option-a-details.png) | The details sheet: W after pass 2, W after pass 0, P on Whole edit, and a fit check of the longest strings. Scale 2, 2400 x 5674 |
| [`mockups/option-a-widths.png`](mockups/option-a-widths.png) | Narrow windows: P, V, D, C and Problem at 1536 and 1366 px. Scale 1.5, 2424 x 2802 |
| [`option-a/NOTES.md`](option-a/NOTES.md) | Placement, states, keyboard, motion, fields, copy, checks, trade-offs (§9), the host window (§10) and open questions (§11) |
| [`option-a/option-a.html`](option-a/option-a.html) | The source of every A frame |

### 5. Option B "Rail"

| File | What it shows |
|---|---|
| [`mockups/option-b-context.png`](mockups/option-b-context.png) | Scene P as the full rail, opened by the photographer, 1920 x 1080 |
| [`mockups/option-b-context-variants.png`](mockups/option-b-context-variants.png) | Scene V as it first appears: docked, with no copy chosen, 1920 x 1080 |
| [`mockups/option-b-context-collapsed.png`](mockups/option-b-context-collapsed.png) | Scene P docked, the default form. Lightroom's Snapshots and History stay visible. 1920 x 1080 |
| [`mockups/option-b-states.png`](mockups/option-b-states.png) | Full rail: W (pinned), P focused, V focused with B chosen, D. Scale 2, 2768 x 1832 |
| [`mockups/option-b-states-more.png`](mockups/option-b-states-more.png) | C, W with Abort armed, Done, and W docked. Scale 2, 2768 x 1832 |
| [`mockups/option-b-states-extra.png`](mockups/option-b-states-extra.png) | Abort failed, all passes used, P while a preview renders, V in a short window, and P as today's engine sends it. Scale 2, 3448 x 1832 |
| [`mockups/option-b-rows.png`](mockups/option-b-rows.png) | Changes rows and Pick a Copy close-ups. Scale 2, 2668 x 1336 |
| [`option-b/NOTES.md`](option-b/NOTES.md) | Placement, forms and pin, states, keyboard, fields, proposed engine additions, copy, tokens, build cost, trade-offs and open questions |
| [`option-b/option-b.html`](option-b/option-b.html) | The source of every B frame. `option-b/checks/` holds its layout checks. |

### 6. Option C "Deck"

| File | What it shows |
|---|---|
| [`mockups/option-c-context.png`](mockups/option-c-context.png) | Scene V, opened by the photographer, with copy B chosen. 1920 x 1080 |
| [`mockups/option-c-context-working.png`](mockups/option-c-context-working.png) | Scene W, the 44 px bar at rest. 1920 x 1080 |
| [`mockups/option-c-states.png`](mockups/option-c-states.png) | States sheet 1 of 2, crops 0-7. Scale 2, 3968 x 4024 |
| [`mockups/option-c-states-more.png`](mockups/option-c-states-more.png) | States sheet 2 of 2, crops 8-16. Scale 2, 3968 x 4488 |
| [`option-c/NOTES.md`](option-c/NOTES.md) | Placement, states, keyboard, motion, fields, copy, design-system refinements, trade-offs (§8), open questions (§9) and the round-3 changes (§10) |
| [`option-c/option-c.html`](option-c/option-c.html) | The source of every C frame |

## Supporting files

- [`render.cjs`](render.cjs) renders any HTML frame to PNG with headless Chromium. Usage is in its header.
- [`stage/`](stage/) is the shared Lightroom mockup stage that all three options draw over: `stage.js`, `stage.css` and `photo.svg`. The photo is a generated landscape (`tools/gen-photo.cjs`), not a real photograph.
- [`tools/`](tools/) holds the contrast calculator (`contrast.cjs`, section 8 of the spec), the colour samplers used on Jim's screenshot (`sample.cjs`, `sample2.cjs`), and the photo generator. The screenshot itself is not in the repo, because it shows family photos.
- [`research/SOURCES.md`](research/SOURCES.md) maps every fetched external source (Microsoft docs, Node, Tauri/tao, Electron, koffi) to its upstream URL. The local copies cited as `research/<file>` are not in the repo; the URL gives the same file.
- [`spec-checks/`](spec-checks/) holds the spec's own checks: glyph coverage, the scan of PR heads for Put back (run at 75369b7, before Put back reached `main`), and zod.
- [`fonts/`](fonts/) holds Inter (`inter.woff2`, from `@fontsource-variable/inter` 5.3.0) and its licence (`fonts/LICENSE`, SIL Open Font License 1.1).
- [`source/grok-draft-2026-10-04.md`](source/grok-draft-2026-10-04.md) is the draft the critique reviews, as Jim supplied it.

**Re-running the checks.** The `.cjs` scripts load Playwright from `$env:PLAYWRIGHT_MODULE` if it is set, else from the `playwright` package. Playwright is not a dependency of this repo; install it outside the repo to re-render.

## History

- **2026-10-04.** The spec, critique and mockups were drafted. The spec's handles and prose were then reconciled with the option notes after the mockups' last review round. Jim decided D1-D4 and deferred D5, then answered Q14-Q16 (spec section 2 and 13.1). Section 1.6 of the spec records what changed on `main` up to c2752bc while this was written.
- **Implementation has not started.** It waits for Jim's "go" [stated: Jim, 2026-10-04].
