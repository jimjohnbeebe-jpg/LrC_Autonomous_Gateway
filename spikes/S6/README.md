# AVG-S6 — virtual copies

**Question (PHASES.md):** does `catalog:createVirtualCopies` on the selected fixture work from **Loupe** and from **Grid**, and are three copies created and addressable by `localIdentifier`?
**Why it matters:** Variants mode (AVG-008) creates copies A/B/C. The SDK call is undocumented and acts on the *selected* photos; an old bug limited it to Grid view, reported fixed in LR6 (LR_SDK_NOTES "LrCatalog" [community]).

## What the harness does (`plugin\spikes\S6.lrplugin\S6Run.lua`)

Each run makes three virtual copies of the selected photo ("AVG S6 A", "B", "C"), re-selecting the original before each one. It records what Lightroom returned, checks that each copy can be found again, and saves everything automatically to `%TEMP%\LrC-AVG\S6\`; Claude Code collects it. At the end it **leaves exactly the new copies selected**, so removing them is one menu command. There is nothing to count, copy, paste or screenshot.

## Steps for Jim

1. Add the plugin folder `D:\Developer\LrC_Autonomous_Gateway\plugin\spikes\S6.lrplugin` (see "Adding a spike plugin" in `spikes\README.md`).

**Loupe run**

2. In **Library**, click `20260907-_OZ80093.NEF` and press **E** (Loupe: the photo fills the middle).
3. **File > Plug-in Extras > AVG S6 - Create 3 virtual copies (I am in LOUPE view).**
4. A window says "Created 3 of 3 virtual copies" (or a problem). Click **OK**.
5. **Photo > Remove Photos…** and click **Remove**. This removes the three copies, which are already selected, from the catalog; the NEF file is not touched.

**Grid run**

6. Press **G** (Grid) and click `20260907-_OZ80093.NEF`.
7. **File > Plug-in Extras > AVG S6 - Create 3 virtual copies (I am in GRID view).**
8. Click **OK** in the result window.
9. **Photo > Remove Photos…** and click **Remove**.
10. Tell Claude Code: **"S6 done."**

## If something goes wrong

- **The result window says "PROBLEM: created N of 3"**: that is a result, not a failure of the run. Carry on with the next step.
- **The result window says "Select the new copies yourself"**: in Grid, Ctrl+click each photo with the folded-corner badge at the bottom-left (not the original), then do the Remove step.
- **A Lightroom error window appears instead**: tell Claude Code its text.
