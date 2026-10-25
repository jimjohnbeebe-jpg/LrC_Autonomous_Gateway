# Spike S14: tone curve, grading wheels, HSL bands, B&W mixer, calibration

Phase 10 row 1 (vault `PHASE10_PLAN.md`); report `docs\reports\phase10\S14.md`. The harness is `npm run s14:check` (`engine\src\devtools\s14-*.ts`); `s14-config.ts` has the plan.

What it does, in about 3 minutes [inference: about 80 writes and 62 exports at 0.5 s each, docs\reports\phase8\S10.md "Exports"]:

1. It reads the "fixtures" collection and takes `20260907-_OZ80093.NEF` (raw) and `DSC_0031.JPG` (rendered).
2. It makes two test charts, a grey wedge and a hue chart, in `%TEMP%\LrC-AVG\S14\charts\`. It imports them in place and puts them in a new collection, **LrC-AVG S14 charts**. A second run finds them there and imports nothing. For the run they are also added to "fixtures", because Lightroom selects only photos in the open collection; they are taken out of "fixtures" at the end.
3. Each of the four photos is selected, gets a snapshot "AVG S14 before …", and is put back from that snapshot at the end (**PUT BACK YES/NO**). Every History step is named `AVG S14 …`.
   - The NEF gets the tone curve writes, the Calibration keys, then Adobe Monochrome and the B&W mixer keys.
   - The JPEG gets the Calibration keys, then Monochrome and the B&W mixer keys.
   - The wedge gets the tone curve writes, then each Color Grading wheel turned through 12 hues.
   - The hue chart gets each HSL band's Saturation at -100, one at a time.
4. Two questions in the PowerShell window, about what Develop shows on the wedge.

## Steps for Jim

1. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > **Quit**.
2. In Lightroom, open the **fixtures** collection (Library > Collections panel > fixtures), then press **D** (Develop).
3. In PowerShell in VS Code, in `D:\Developer\LrC_Autonomous_Gateway`, run:

   ```powershell
   npm run s14:check
   ```

   The Filmstrip selection jumps between the four photos. The two charts appear in the Filmstrip while they are worked on.
4. When the window asks **"In the Tone Curve panel, is the curve bent (not a straight diagonal line)?"**, look at the Tone Curve panel on the right in Develop, type `y` or `n`, then press Enter. If no curve write worked, this question is skipped.
5. When the window asks about the **Color Grading** panel, open that panel on the right in Develop. In the row of small circles at the top of the panel, click the dark one (Shadows). Read its Hue and Saturation values, type `y` or `n`, then press Enter.
6. The window ends with **Spike S14: WORKED** or **FAILED**, one **PUT BACK YES/NO** line per photo, and your two answers.
7. Tell Claude Code "S14 done".

The two charts stay in your catalog in **LrC-AVG S14 charts**, because row 4 measures against them. They are removed at the end of Phase 10: Library > the collection > select both > right-click > **Remove from Catalog**.

## If something goes wrong

- If the window says "another LrC-AVG engine is using the Lightroom bridge", do step 1 again, then step 3.
- If it says the collection "fixtures" lacks `20260907-_OZ80093.NEF` or `DSC_0031.JPG`, run `npm run s10:check -- --fixtures`, then step 3 again.
- If you cannot find what a question asks about, type `n` and tell Claude Code what you saw instead.
- If a line says **PUT BACK NO**, tell Claude Code. The photo's snapshot "AVG S14 before …" is in its Snapshots panel.
