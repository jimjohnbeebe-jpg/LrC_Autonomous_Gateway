// The Deck's words (Phase 7 row 4c; spec docs\hud\lrc-avg-hud-spec-v2.md section 10, Option C
// docs\hud\option-c\NOTES.md section 6). The HudText strings are used verbatim from
// plugin\LrC-AVG.lrplugin\HudText.lua (spec 10.1); the rest are the spec's and Option C's new strings
// (10.2, NOTES section 6). The words "session", "engine", "stage", "seq" and "payload" never appear
// (spec 10; hud\ui\view.test.ts scans every string here).

export const HEADLINE = {
  not_running: "LrC-AVG is not running: reload it in File > Plug-in Manager.",
  not_connected: "Claude is not connected. Your edit so far stays.",
  gone: "This edit is no longer open in Claude. Your edit so far stays.",
  working: "Claude is working. Nothing needed from you.",
  awaiting_pick: "Your turn: pick a copy, or tell Claude which one.",
  converged: "Your turn: Claude thinks the edit is done.",
  target_changed: "Your turn: select the edit's photo again.",
  accepted: "Done: the edit is kept.",
  aborted: "Done: the photo is back as it was.",
  ended: "The edit has ended.",
} as const;
export const approveHeadline = (pass: number): string => `Your turn: approve pass ${pass} so Claude can go on.`;
/** The cap read as the user's turn (Q6; NOTES section 6). */
export const capHeadline = (passes: number): string => `Your turn: all ${passes} passes are used.`;
export const NO_EDIT = "Not connected to Claude.";

export const STEP: Record<string, string> = {
  begin: "Starting", pass0: "Setting profile, lens corrections and baseline", applying: "Applying pass",
  acquiring_preview: "Rendering a preview", metrics: "Measuring the preview", awaiting_claude: "Claude is looking at the result",
  awaiting_pick: "Waiting for your pick", awaiting_approval: "Waiting for your approval", converged: "Claude thinks the edit is done",
  target_changed: "Another photo is selected", accepted: "Accepted", aborted: "Aborted", ended: "Ended",
};

export const UNDO = "To undo it: Develop > Snapshots > ";
export const UNDO_NO_SNAPSHOT = "the newest AVG pre-session snapshot";
/** Where the plugin's own Put back is while Claude is away (spec D5, "Put back"; menu item plugin\LrC-AVG.lrplugin\Info.lua:30). */
export const PUT_BACK_PATH = "To put the photo back: File > Plug-in Extras > LrC-AVG - Show Vision Gateway HUD, then Put back";
export const CLIPPING_OK = "Clipping: within limits.";
export const clickSent = (label: string): string => `${label} sent; waiting for Claude.`;
export const clickNoAnswer = (label: string, s: number): string => `${label}: no answer from Claude within ${s} s; the buttons are on again.`;

/** HudState.targetChangedLine (plugin\LrC-AVG.lrplugin\HudState.lua:251-259), the Deck's to build (row 3 decision 3). */
export function targetChanged(selected: string | null, variants: boolean, target: string): string {
  const what = selected === null ? "No photo is selected" : `${selected} is selected`;
  const again = variants ? "Claude's next call selects the edit's photo again" : `Select ${target} again`;
  return `Target changed: ${what}. ${again}; the edit is still open.`;
}

// Buttons and their consequence lines (spec 6, 10.2; NOTES section 6).
export const LABEL = { accept: "Accept", abort: "Abort", armed: "Press again to abort", showCopies: "Show the copies" } as const;
export const approveLabel = (pass: number): string => `Approve pass ${pass}`;
export const continueLabel = (letter: string): string => `Continue on copy ${letter}`;
export const pickLabel = (letter: string): string => `Pick ${letter}`;
export const LINE = {
  approve: (pass: number) => `Lets Claude write pass ${pass + 1}.`,
  accept: "Ends the edit; the sliders stay as they are.",
  acceptCopy: (letter: string) => `Keeps copy ${letter}; the other copies stay.`,
  acceptWorking: "Ends the edit after Claude's current step.",
  acceptNow: "Accept keeps the edit as it is now.",
  abort: "Puts the pre-session snapshot back.",
  abortCopies: "Leaves the master as it was; the copies stay in the catalog.",
  continue: (letter: string) => `Claude continues on copy ${letter} at its next call.`,
  armed: "Ctrl+Backspace again; Esc or 3 s cancels.",
  offAnswer: "Off until Claude answers.",
  offConnected: "Off until Claude is connected.",
  offPick: "Comes back after a pick.",
} as const;

export const PICK = {
  choose: "Choose a copy to continue on",
  click: "Click a card.",
  keys: "Click a card, or press 1, 2 or 3.",
  picked: "Picked",
} as const;
export const copiesLine = (first: string, last: string): string => `Copies: “${first}–${last}”`;
export const passOf = (pass: number, max: number): string => `pass ${pass} of ${max}`;
export const passCopies = (pass: number, n: number): string => `pass ${pass} · ${n} copies`;
export const copyPass = (letter: string, pass: number): string => `copy ${letter} · pass ${pass}`;
export const blockHeader = (pass: number, undone: boolean): string => `Pass ${pass}${undone ? " · undone" : ""}`;
export const NOT_KEPT = "not kept";
export const moreRows = (n: number): string => `+${n} more`;
export const PHASE_WORD = { working: "Working", turn: "Your turn", done: "Done" } as const;
export const HIDE = "Hide the Deck";
export const OPEN_DECK = "Open the Deck";
export const CLOSE_DECK = "Close the Deck";
