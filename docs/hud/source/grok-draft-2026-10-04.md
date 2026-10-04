The current dialog covers the photo and reads like an SDK form. I’ll check what Lightroom Classic’s Lua UI can actually do, then rewrite the spec around a companion HUD that stays out of the image.

The current window is doing the right jobs with the wrong surface. It is a review instrument parked on top of the photograph, styled like a debug dialog. A reskin of that dialog will still fail. The HUD should become a small companion that speaks Develop, and the Lua gateway should stay the only thing that touches the catalog.

## What the screenshot is actually showing

The gateway already has a clear workflow. The window just refuses to present it.

| Job the gateway is doing | How the window presents it |
|---|---|
| Bridge and Claude connection | One broken line at the bottom: "Yet connected to Claude." |
| Session phase | A paragraph of instructions in the idle state |
| Variant adjudication (Pick A / B / C) | Four equal text buttons, no pictures |
| Commit, revert, stop | Three more equal buttons, with no stated consequence |
| Parameter diff | An empty four-column table that occupies most of the window |
| Next-session policy (passes, decay, clip limits) | Debug text on the face of the HUD |

Two failures dominate everything else.

The dialog is light gray, centered, and large enough to cover the faces you are supposed to be judging. Lightroom around it is a dark charcoal tool. A modern HUD that still opens in the middle of the image has not been modernized.

`LrView` cannot fix this. Plugin dialogs are a fixed set of OS-ish controls: limited fonts, weak color binding, no custom drawing, no real type ramp. `LrWebViewFactory` is only for the Web publishing module. `presentFloatingDialog` can float and remember a frame, and it still cannot look like a photo tool. Treat the Lua dialog as a prototype to retire, not a layout to restyle. Keep Lua as the authority. Replace only the window.

## What this HUD is

A photographer-facing review surface for an agent that already runs in Claude Desktop. It is not a second chat, not a Develop panel clone, and not a workspace.

It has five questions to answer, in this order, at all times:

1. Is the bridge up, and is Claude connected? Those are different.
2. Which catalog photo is the agent on, and is that the photo selected in Lightroom?
3. What phase is this? Idle, running, needs a decision, or applying on its own.
4. What changed, in Develop language, and which variant is on the photo right now?
5. What will Keep, Revert, and Stop do to the catalog?

If a control does not answer one of those, it does not belong on the default surface.

## Window and lifecycle

Keep the process model in your spec. Correct the window model.

The HUD is a separate Tauri process, launched by the plugin, talking only to the existing gateway. Close hides it. The menu command shows and focuses the same instance. Lightroom quitting quits the HUD. Hiding must not leave a zombie after Lightroom exits, and a state tick must not spawn a second window.

Three sizes, not one resizable workspace:

- **Compact.** About 360×52. Idle, running, and "hidden but warm." This is the default.
- **Review.** About 380×420. Opens when a pass needs a human, or when the user expands. Variant cards, one primary action, a collapsed diff.
- **Inspector.** Review, grown vertically to show the full diff and pass history. Cap the width near 420. This is a column, not a canvas.

Default position is the top-right of the screen, with a margin, on the display where Lightroom is. Never center. Remember display and frame. First launch must not cover the image the way the current dialog covers `DSC0090.NEF`.

Pin is a toggle, off by default. Unpinned, the window does not float over a second app the user just switched to. Pinned, it stays above Lightroom only.

Do not steal focus on every gateway message. Bring the window forward once, when a phase first becomes "needs a decision," and only if "Surface when a pass is ready" is on. That preference defaults on. If it is off, fire a single `LrDialogs.showBezel` ("Pass 2 ready") instead of a modal.

Clicking the HUD must not block Lightroom. That is the actual reason to leave `LrDialogs`. The external window is non-modal by being another process. Do not reintroduce modality with a confirm on every Keep.

Custom title bar, same color as the panel. The Windows chrome reading "LRC-MCP - Vision Gateway" is part of the clash. Photographer-facing title: **Review**. Keep LRC-MCP as the process and protocol name.

## Information architecture

### Compact

```
●  DSC0090.NEF                  Pass 2/6
   Claude connected · running          ▾  ▣
```

The dot is the only animation: dim when the plugin is up but Claude is not, slow amber while a pass is running, solid amber when a decision is waiting, quiet green after a keep, red only when the bridge is down. No spinners, no progress theater.

Second line is phase, not advice. "Ask Claude to edit a photo" is onboarding. Show it once, the first time the bridge is up and Claude has never connected, then retire it.

### Review

```
DSC0090.NEF · 50mm · f/4.2 · ISO 200
Pass 2 of 6                          not auto

┌─────────┐ ┌─────────┐ ┌─────────┐
│  thumb  │ │  thumb  │ │  thumb  │
│    A    │ │  B · LR │ │    C    │
│ −0.3 exp│ │ warmer  │ │ +clarity│
└─────────┘ └─────────┘ └─────────┘
 1            2            3

[ Keep this pass                    ]
  becomes the baseline for pass 3

  Revert preview          Stop
  back to last keep       end session

▸ 5 adjustments
```

Variant cards are the whole point of Pick A / B / C. A text button cannot adjudicate a photograph. Each card is a proxy, a one-line Develop summary, and a key hint. The card currently applied in Lightroom gets a 1px amber ring and the label "In Lightroom." Clicking a card sends the existing pick command. Judging happens in Lightroom, at full size. The HUD is for scanning.

Do not crossfade thumbnails. A dissolve makes the user unsure which variant they are seeing.

### Diff

Replace the four-column table. "Before / After / Change" repeats one fact three times.

```
BASIC
Exposure                         −0.35
├────────●────────┤
+0.10 → −0.25

Highlights                         −20
├──────●──────────┤
−12 → −32

COLOR
Temp                              +180
├────────────●────┤
5400 → 5580 K
```

Group in Lightroom order: Basic, Tone Curve, Color, Detail, Effects, Calibration, Optics. Hide unchanged groups. Map SDK keys to panel labels (`Exposure2012` is Exposure, not a raw string). Units are photographer units: EV, K, tint points, or a bare signed integer where Lightroom shows one.

Bar length is visual weight, not raw magnitude. Temperature moving 100 K must not look larger than Exposure moving half a stop. Normalize per parameter, roughly:

| Parameter | Full bar means about |
|---|---|
| Exposure | 0.50 EV |
| Contrast, Highlights, Shadows, Whites, Blacks | 40 |
| Texture, Clarity, Dehaze, Vibrance, Saturation | 25 |
| Temp | 800 K from the before value |
| Tint | 20 |
| Sharpness, noise reduction | 40 |

Cap the bar at 1. Show the signed number either way. Sort within a group by this weight, not alphabetically.

Sign and the number carry the direction. Do not use red and green for up and down.

### Autonomous

If the gateway can apply passes without a stop, the compact bar grows a persistent banner: "Applying without review." Keep and the variant row disappear. Revert stays, and it must work on the last applied pass, not only at session end. A HUD that watches the photo change and offers no put-back is not a control surface.

### Settings

The decay array, clip limits, preview size, and max passes are next-session policy. They do not belong under the action buttons.

A sheet, opened from the compact bar, labeled "Applies to the next session" if that is truly when the gateway reads them. Plain labels:

- Stop after — 6 passes
- Variants per pass — 3
- Preview long edge — 1000 px
- Highlight clip — 0.5%
- Shadow clip — 1%
- Later passes move less — the decay schedule, as a sentence, not `1, 0.8, 0.4, 0.25`

Do not make mid-session edits look live if the gateway will ignore them until the next session. If the HUD cannot write settings through the existing gateway, the sheet is read-only. Do not build a second preferences file.

### States worth designing, because the current window has none

- **Bridge down.** "Lightroom plugin isn't connected." No stack trace. Actions disabled.
- **Claude not connected.** Dot dim, one line, window stays compact. Do not take over the photo.
- **Selection mismatch.** Agent is on `DSC0090.NEF`, Library selection is something else. Banner, not a silent apply. Identity always names the agent photo, not the mere selection.
- **Running.** Compact bar only. Do not stream every intermediate slider tick into the diff. Publish the diff at pass boundaries. Live numbers, if you show them, update at 4 Hz at most.
- **Error from the gateway.** One line of the gateway's human message, plus Revert if a preview is applied.

## Action semantics

The current verbs are the hazard. Seven buttons of equal weight, and Put back does not say whether it restores the start of the session or the previous pass.

Keep the gateway command names. Change only the labels, and put the catalog consequence on the button. Proposed mapping, to confirm against the gateway rather than reinvent:

| Gateway command | Label | Subtitle | Emphasis |
|---|---|---|---|
| Pick A / B / C | the variant card | "Shows in Lightroom" | the applied card is marked, not a separate button |
| Approve pass | Keep this pass | "Becomes the baseline for the next pass" | primary |
| Accept | Done | "End session and keep this" | primary, only when a pass is kept or review is the last step |
| Put back | Revert preview | "Restores the last keep" or "Restores session start" — pick one and write it | quiet |
| Abort | Stop | "End session and revert to session start" | quiet, danger color, confirm only if an unkept preview is applied |

If Put back and Abort differ by less than that, merge them in the UI. Two revert verbs with no subtitle is how a develop stack gets ruined.

Hold-to-compare is the one interaction worth adding if the gateway can already put settings back and reapply them. Hold Space: show pre-session or last keep. Release: restore the preview. If the gateway cannot do a momentary swap, do not fake it with a thumbnail crossfade. Say so, and leave compare to Lightroom's own backslash key by not stealing that key when the HUD is unfocused.

## Visual system

Fit the tool in the screenshot, not Linear. Lightroom's panels are charcoal, warm-neutral type, no brand color on every control. Capture One, DxO, and current Photoshop are the same family. An OLED black window with violet accents will look like a developer utility dropped on a darkroom.

Sit slightly darker than Lightroom's panels so the HUD reads as an instrument beside the right-hand panel, not as a broken one.

| Token | Value | Use |
|---|---|---|
| bg | `#1C1C1C` | window |
| raised | `#242424` | cards, sheet |
| inset | `#141414` | thumbnail well, slider track |
| border | `#2E2E2E` | 1px, only where two surfaces meet |
| text | `#E8E6E3` | primary. Warm, not `#FFFFFF` |
| text-dim | `#9A958E` | secondary. Must clear 4.5:1 on bg |
| text-faint | `#8A847C` | key hints only |
| review | `#E8A54B` | waiting dot, applied ring, primary button fill |
| review-text | `#1A140C` | label on the amber button |
| keep | `#8FBF9F` | kept state, used sparingly |
| danger | `#E07A5F` | Stop label only, never a filled red button |

No purple. It signals "AI product" and fights the photograph. No gradients, no blur, no vibrancy, no window transparency. Transparency over a picture looks cheap and destroys type. One shadow, on the window only: `0 8px 24px rgba(0,0,0,0.45)`.

Type: bundle Inter or Geist. Do not depend on SF Pro, or the Windows build will not match. 13px for identity and actions, 12px for diff rows, tabular figures for every value. 12px is the floor for anything the user must read while looking at a photo. Dense is not tiny.

Radius 6px on cards, 4px on buttons. 8px grid, 12px outer padding, 4px between diff rows. Icons only for pin, close, expand, and the status dot. 16px, 1.5px stroke.

Primary button is amber fill and near-black type. Everything else is text plus a hairline. The current row of identical gray buttons is the hierarchy bug.

Motion: 150ms for expand and collapse, ease-out, no bounce. Variant selection is instant. Numbers do not tween. A value animating from 0 to −0.35 hides the value.

## Engineering, kept and tightened

Your stack is the right one. Tauri v2, system webview, Tailwind, unstyled primitives, a small motion library. Do not add a chart library for the diff tracks. Those are a div and a scale. Stay under the 15MB budget. Idle resident memory should stay under about 80MB, and a warm show should be under 400ms.

Lua remains the only catalog writer. The HUD sends intents. It does not call the SDK, and it does not open its own channel to Claude. If the gateway already has verbs for pick, approve, accept, abort, and put back, the HUD emits those. Do not fork a second control path.

`LrSocket` is a pair of unidirectional sockets, and it drops. The HUD process listens on `127.0.0.1` only. Lua reconnects. Bind with a per-launch token written into the plugin's temp area, mode `0600`, so a random local process cannot apply Develop settings. Do not stream pixels on the socket. Reuse the gateway's existing 1000px preview export. Write JPEGs in binary. sRGB. Long edge capped. Cache key is photo UUID, variant id, and settings hash. Delete the directory when the session ends.

Avoid `requestJpegThumbnail` as the HUD path. In Develop it can return a full-resolution JPEG and stall the plugin. If a thumbnail call remains anywhere, hold the request object until the callback, ignore repeat callbacks, and write with binary mode.

Message contract, adapted to whatever the gateway already speaks:

```json
{
  "type": "state",
  "bridge": "up",
  "claude": "connected",
  "session": {
    "phase": "awaiting_review",
    "autonomous": false,
    "photo": {
      "uuid": "…",
      "filename": "DSC0090.NEF",
      "meta": "50mm · f/4.2 · ISO 200"
    },
    "selectionMatches": true,
    "pass": { "index": 2, "max": 6 },
    "variants": [
      {
        "id": "B",
        "thumb": "…/B.jpg",
        "summary": "−0.35 exp, warmer",
        "appliedInLr": true,
        "changes": []
      }
    ],
    "changes": [
      {
        "key": "Exposure2012",
        "label": "Exposure",
        "group": "Basic",
        "before": 0.10,
        "after": -0.25,
        "display": "−0.35",
        "impact": 0.70
      }
    ]
  }
}
```

Commands back: `pick`, `approve_pass`, `accept`, `put_back`, `abort`, and `set_setting` only if the gateway already persists it for the next session. Send a full state snapshot on change, not a stream of partials. Heartbeat every few seconds so a dead plugin becomes a red dot without a restart.

Keyboard, when the review window is focused: `1` `2` `3` pick, Enter keeps, `R` reverts, Esc stops (confirm only if an unkept preview is applied). When the window is not focused, do not bind anything. Lightroom's own shortcuts must survive.

## What not to build

- A chat transcript or a prompt box. That interface is Claude Desktop.
- A histogram, a curve editor, or a full before/after canvas. Lightroom already has them. Duplicate them and the HUD becomes a worse Develop module.
- A theme switcher, a light mode, or a glass title bar.
- A second Lua dialog that mirrors the HUD "just in case." One bezel string is the only in-process UI worth keeping.
- Live intermediate diffs while the agent is still moving sliders.

## Done when

- Idle, the window is a single dark strip at the edge of the screen, not a centered panel, and it does not cover the photograph.
- Connection, filename, phase, and the one next action are readable at a glance. Settings constants are not on that surface.
- A pass with three variants can be judged from thumbnails, then confirmed in Lightroom, without reading "Pick B."
- Every destructive control states its catalog consequence in the control itself.
- An autonomous pass cannot proceed without a visible banner and a working revert.
- Closing the window leaves the gateway running. Quitting Lightroom does not.
- Body text clears 4.5:1 on `#1C1C1C`. The window is the same color and the same type on Windows and macOS, with no default white title bar.
- A state update never steals focus except the single transition into "needs a decision."