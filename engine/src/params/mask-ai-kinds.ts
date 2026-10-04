// The AI mask kinds as data (GitHub issue #59, PR C step 2b): each kind's MaskSubType and
// MaskSubCategoryID, its label, LrDevelopController's subtype when that route made it, and whether it
// needs a point on the photo. mask-table.ts turns them into fields (rule 03: field names live there).
// The numbers are Lightroom's own data (its adaptive presets live in C:\Program Files\Adobe\Adobe
// Lightroom Classic\Resources\Settings\Premium\, "..." below; read 2026-10-03):
//   - subject 1, sky 2, background 0 + 22: Jim's captures 1 and 2 [handle: docs\reports\phase6\
//     masks-capture\3_dump-1.json entries 2-3; capture2-templates.json `background`]; Adobe's presets
//     agree for subject and sky [handle: Lightroom's own presets ...\Adaptive - Subject\Pop.xmp,
//     ...\Adaptive - Sky\Blue Drama.xmp]. Only these three have LrDevelopController's subtype
//     (capture 2's createNewMask made no people or landscape mask [handle: capture2-transcript.txt]);
//   - landscape, one correction per category, MaskSubType 0 + 50001-50008 (Architecture, Mountains,
//     Artificial Ground, Natural Ground, Vegetation, Sky, Water, Snow) [handle: Lightroom's own preset
//     ...\Adaptive - Landscape\Winter01.xmp, which holds all eight]; vegetation and sky also in
//     capture 3 [handle: capture3-templates.json `landscape_1`, `landscape_2`];
//   - people, all the people in the photo, MaskSubType 3 + part: Facial Skin 2, Iris and Pupil 3,
//     Body Skin 4, Hair 5, Lips 6, Facial Hair 7, Eye Sclera 8, Eyebrows 9, Teeth 12 [handle:
//     Lightroom's own preset ...\Adaptive - Portrait\Polished Portrait.xmp], Clothes 11 [handle:
//     ...\Adaptive - Portrait\Enhance Clothes.xmp];
//   - one person, by a point on them, MaskSubType 0 and InstanceIDs (mask-person.ts): Entire Person
//     20036 on two photos and both people of one [handle: capture3-templates.json `people_entire`;
//     capture4-row6_people_by_hand.json], Facial Skin 2 [handle: capture3-templates.json `people_part`];
//     the other parts as every person's part numbers with MaskSubType 0 [inference] [unverified until
//     capture 5].
// Every preset entry carries ReferencePoint "0.500000 0.500000" and ErrorReason "0" [handle: the
// presets above]; the engine writes them so (mask-ops.ts newComponent). Adobe-form vegetation computed
// and every person's face skin and hair computed [handle: docs\reports\phase6\masks-capture\
// capture4-check.json steps `row2_vegetation`, `row5_people_face_skin`, `row5_people_hair`]; a kind
// the photo lacks came back with ErrorReason 1 (steps `row4_snow`, `row4_water`), and the engine then
// takes the mask out (session\ai-update.ts). The other kinds are [unverified] on a photo that has them.

export type AiKindSpec = { subType: number; subCategory: number | null; label: string; dc: string | null; point: boolean };
const kind = (subType: number, subCategory: number | null, label: string, dc: string | null = null, point = false): AiKindSpec => ({ subType, subCategory, label, dc, point });

export const AI_KIND_DATA = {
  subject: kind(1, null, "Subject", "subject"),
  sky: kind(2, null, "Sky", "sky"),
  background: kind(0, 22, "Background", "background"),
  landscape_architecture: kind(0, 50001, "Architecture"),
  landscape_mountains: kind(0, 50002, "Mountains"),
  landscape_artificial_ground: kind(0, 50003, "Artificial Ground"),
  landscape_natural_ground: kind(0, 50004, "Natural Ground"),
  landscape_vegetation: kind(0, 50005, "Vegetation"),
  landscape_sky: kind(0, 50006, "Landscape Sky"),
  landscape_water: kind(0, 50007, "Water"),
  landscape_snow: kind(0, 50008, "Snow"),
  people_face_skin: kind(3, 2, "People - Face Skin"),
  people_iris_pupil: kind(3, 3, "People - Iris and Pupil"),
  people_body_skin: kind(3, 4, "People - Body Skin"),
  people_hair: kind(3, 5, "People - Hair"),
  people_lips: kind(3, 6, "People - Lips"),
  people_facial_hair: kind(3, 7, "People - Facial Hair"),
  people_eye_sclera: kind(3, 8, "People - Eye Sclera"),
  people_eyebrows: kind(3, 9, "People - Eyebrows"),
  people_clothes: kind(3, 11, "People - Clothes"),
  people_teeth: kind(3, 12, "People - Teeth"),
  person_entire: kind(0, 20036, "Person", null, true),
  person_face_skin: kind(0, 2, "Person - Facial Skin", null, true),
  person_iris_pupil: kind(0, 3, "Person - Iris and Pupil", null, true),
  person_body_skin: kind(0, 4, "Person - Body Skin", null, true),
  person_hair: kind(0, 5, "Person - Hair", null, true),
  person_lips: kind(0, 6, "Person - Lips", null, true),
  person_facial_hair: kind(0, 7, "Person - Facial Hair", null, true),
  person_eye_sclera: kind(0, 8, "Person - Eye Sclera", null, true),
  person_eyebrows: kind(0, 9, "Person - Eyebrows", null, true),
  person_clothes: kind(0, 11, "Person - Clothes", null, true),
  person_teeth: kind(0, 12, "Person - Teeth", null, true),
} as const satisfies Record<string, AiKindSpec>;

export type AiKind = keyof typeof AI_KIND_DATA;
