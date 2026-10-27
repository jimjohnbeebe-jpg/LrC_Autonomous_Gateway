---
name: lrc-avg
description: Edit the photo selected in Lightroom Classic with the LrC-AVG tools (lr_begin_session, lr_step, lr_end_session and the rest). Use when the user asks to edit, grade, fix or retouch a photo in Lightroom.
---

# LrC-AVG: edit the selected Lightroom photo

LrC-AVG is an MCP server (`lrc-avg`) plus a Lightroom Classic plug-in. The server measures rendered previews of the photo selected in Lightroom and applies native Develop settings through the plug-in, one pass at a time. Every change shows on the Develop sliders and is undoable in Lightroom's History panel and Snapshots.

## Before you start

- Lightroom Classic must be open with the LrC-AVG plug-in loaded (File > Plug-in Manager > Add), and a photo selected.
- Call `lr_help` once. It explains sessions, passes, previews, metrics, masks, logs and errors; the same text is also the MCP prompt `lrc-avg-help`.

## Request template

The user's words come first. Intents and suggestions are starting points, not rules.

1. `lr_get_active_photo_context` to see the selected photo.
2. `lr_begin_session` with the user's request kept in `notes`.
3. `lr_step` for each pass: look at the preview image and the metrics it returns, then refine.
4. `lr_end_session` to accept, revert or abandon.
5. Tell the user what changed and why.

The same template is the MCP prompt `lrc-avg-edit` (argument `request`).
