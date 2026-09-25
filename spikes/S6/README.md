# AVG-S6 — virtual copies

**Question (PHASES.md):** does `catalog:createVirtualCopies` on the selected fixture work from **Loupe** and from **Grid**, and are three copies created and addressable by `localIdentifier`?
**Why it matters:** Variants mode (AVG-008) creates copies A/B/C. The SDK call is undocumented and acts on the *selected* photos; an old bug limited it to Grid view, reported fixed in LR6 (LR_SDK_NOTES "LrCatalog" [community]).

## What the harness does (`plugin\spikes\S6.lrplugin\S6Run.lua`)

Each run asks Lightroom for three virtual copies of the selected photo ("AVG S6 A", "B", "C"), re-selecting the original before each one. It records what Lightroom returned, checks that each copy can be found again, and saves everything automatically to `%TEMP%\LrC-AVG\S6\`; Claude Code collects it. At the end it tries to **leave exactly the new copies selected**, reads the selection back, and says in its window whether that worked, so you know whether Remove Photos is safe. There is nothing to count, copy, paste or screenshot.

That is what the harness is written to do. Whether Lightroom creates the copies and accepts the selection is [unverified] until this run, which records what actually happened (`plugin\spikes\S6.lrplugin\S6Run.lua`).

## Steps for Jim

1. Add the plugin folder `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S6.lrplugin` (see "Adding a spike plugin" in `spikes\README.md`).

**Loupe run**

2. In **Library**, click `20260907-_OZ80093.NEF` and press **E** (Loupe: the photo fills the middle).
3. **File > Plug-in Extras > AVG S6 - Create 3 virtual copies (I am in LOUPE view).**
4. A window says how many copies were created and whether they are now selected. Click **OK**.
5. If the window said the new copies "are now selected": **Photo > Remove Photos…** and click **Remove**. This removes only those copies from the catalog; the NEF file is not touched. If it said "COULD NOT SELECT", follow "If something goes wrong" below.

**Grid run**

6. Press **G** (Grid) and click the original `20260907-_OZ80093.NEF`, the one **without** a folded-corner badge at its bottom-left.
7. **File > Plug-in Extras > AVG S6 - Create 3 virtual copies (I am in GRID view).**
8. Click **OK** in the result window.
9. Remove the copies exactly as in step 5.
10. Tell Claude Code: **"S6 done."**

## If something goes wrong

- **The result window says "PROBLEM: created N of 3"**: that is a result, not a failure of the run. Carry on with the next step.
- **The result window says "COULD NOT SELECT the new copies"**: don't remove anything, and don't select copies by hand (the folded-corner badge doesn't tell this run's copies apart from any other virtual copies). The copies are harmless. Carry on with the next step, and mention it when you tell Claude Code.
- **A Lightroom error window appears instead**: tell Claude Code its text.
