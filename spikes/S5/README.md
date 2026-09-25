# AVG-S5 — develop settings, camera profiles, and whether they can be written

**Question (PHASES.md):** what develop settings does Lightroom 15.5.1 report for a Z8 NEF and the DxO DNG? What are the camera-profile names? Can the profile and the lens-correction switches be changed by the plugin?

## Part 1: done (2026-09-23)

The settings list is captured (178 settings, saved as `engine\src\params\sdk-keys.lrc15.json`), along with the Nikon (Camera Matching) profile names. Two gaps remain, found in part 1's results (`docs\reports\phase0\S5.md`, "Part 1 analysis"):

- **Adobe profiles** (Adobe Color, Adobe Landscape, …) are all reported as `Adobe Standard`; the actual profile is stored in a separate `Look` setting that part 1 did not record (source 1).
- The write tests did not prove anything (source 1).

## Part 2: what the plugin now does for you

- **Profile recorder:** while it runs, it notes every profile you click, including the Adobe ones, and saves them by itself; Claude Code collects the results. A small message in the middle of the screen confirms every click: **"Recorded …"** for a new profile, **"Already recorded …"** for one it has already seen.
- **Write tests (automatic):** one menu item. First it takes a Develop snapshot; if that fails, it stops without changing anything. Then it changes the photo's profile to a Nikon profile and to an Adobe profile, switches each lens correction off and on, and checks every change. Finally it puts the photo back from the snapshot and checks that every setting matches the start. It shows WORKED / PARTIAL / FAILED for each test and saves the results by itself; Claude Code collects them. Whether each of these steps works in Lightroom is exactly what the run finds out (source 2).

There is nothing to type, copy, or paste.

## Part 2 — steps for Jim

Start only after Claude Code has told you that PR `phase-0/s5-part2` is merged.

1. In Lightroom: **File > Exit**. Wait until Lightroom has closed, then start it again. This loads the new version of the S5 plugin.
2. In **Library**, click `20260907-_OZ80093.NEF` and press **D** (Develop).
3. **File > Plug-in Extras > AVG S5 - 1. Start profile recorder.** A message "profile recorder started" appears, then "Recorded 1: …" for the photo's current profile.
4. In the **Basic** panel, open the Profile Browser (the four-squares icon at the right end of the **Profile** row).
5. In the **Adobe Raw** group, click each profile once. After each click, wait for the message in the middle of the screen (**"Recorded …"** or **"Already recorded …"**) before clicking the next one.
6. Click **Adobe Color** last (the message says "Already recorded …"), so the photo ends as it started. Close the Profile Browser.
7. Press **G** (Grid), click `20260110-_Z8A0138-DxO_DeepPRIME XD3.dng`, and press **D**.
8. Repeat steps 4–6 for this photo.
9. **File > Plug-in Extras > AVG S5 - 2. Stop profile recorder.** A window lists everything recorded. Click **OK**.
10. Press **G**, click `20260907-_OZ80093.NEF`, and press **D**.
11. **File > Plug-in Extras > AVG S5 - 3. Run write tests (automatic).** After a few seconds, a window shows WORKED / FAILED for each test and whether the photo was put back. Click **OK**.
12. Tell Claude Code: **"S5 part 2 done."**

## If something goes wrong

- **The last line of the step 11 window says "Photo put back to how it was: NO"**: don't change the photo. The window names a snapshot it kept for recovery. Tell Claude Code first.
- **Step 11 shows "STOPPED - Nothing was changed"**: the safety snapshot could not be made. Tell Claude Code.
- **A step 5 click shows no message within about 2 seconds**: click a different profile, then click the one you wanted again.
- **Step 11 says "SKIPPED - no Adobe profile was recorded"**: Lightroom was restarted between step 9 and step 11. Repeat steps 3–6 on the NEF, then step 9, then step 11.
- **A Lightroom error window appears**: take a screenshot (**Win+Shift+S**), save it as `D:\Developer\LrC_Autonomous_Gateway\docs\reports\phase0\S5-part2-error.png`, click OK, and tell Claude Code.

## Sources

1. Part 1 results: `docs\reports\phase0\S5.md` "Part 1 analysis", with evidence in `docs\reports\phase0\S5\` (the DNG dump's `Look` entry: `Name "Adobe Color"` over `CameraProfile "Adobe Standard"`) and `docs\reports\phase0\S5\part1\` (profile log, write-test results).
2. Part 2 behaviour is what the harness is written to do (`plugin\spikes\S5.lrplugin\S5Recorder.lua`, `S5WriteTests.lua`). Whether Lightroom does each step (snapshot create/apply/delete, writing a `Look`, flipping the lens switches) is [unverified] until part 2 runs; the harness records the outcome of each.
