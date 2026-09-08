# Race header asset manifest

This file tracks the generated decorative assets for draft PR #51.

## Rules

- Runtime text, values, icons and controls remain live DOM/React.
- Generated art is decorative only and must not intercept pointer events.
- Final runtime files must be local repository assets; do not hotlink temporary generation URLs.
- Final raster assets must be PNG with real alpha transparency.
- Do not merge automatically.

## Intended runtime layout

```text
assets/source/faction-header-v2/
  aegis/
    planet_frame.png
    planet_selector.png
    resource_cell.png
    campaign_utility.png
    navigation_active.png
  synod/
    planet_frame.png
    navigation_rail.png
    planet_selector.png
    campaign_utility.png
  veyra/
    planet_frame.png
    navigation_rail.png
    planet_selector.png
    campaign_utility.png
```

The first integration pass intentionally reuses CSS geometry, separators and inactive-button treatment. Separate raster files are only required where they add visible faction identity. This avoids generating redundant art and keeps live controls readable.

## Aegis / Астеры

| Role | Generation task | Alpha-cutout task | Status |
| --- | --- | --- | --- |
| current planet selector | `6eb90695-e7a2-4a46-83f7-1d62fd52638a` | `1feb8860-7fd7-46ad-b432-6b266f57365b` | alpha generated |
| campaign + utility module | `72562992-23d1-49b7-b44a-b20fac00999d` | `9938cab5-7620-47a3-a027-ecdd008e6e83` | cutout submitted |
| resource cell | `db4ec53c-b1f7-48a3-affe-fad35aff4b4b` | `d2978563-a115-40d1-bbb3-4145157dc4ea` | cutout submitted |
| active navigation overlay | `88403d3b-f8e6-4031-9262-89ea88ea7896` | `15d33278-7ade-4fbc-97dd-c85c600ed078` | cutout submitted |

## Synod / Илары

| Role | Generation task | Alpha-cutout task | Status |
| --- | --- | --- | --- |
| planet frame | `882d22a1-47bc-4407-8bc4-bdc9e1e95ce0` | `8ca35eed-f5a1-4ac2-aa87-fda283343586` | cutout submitted |
| navigation rail | `d93fd3a5-f54e-4352-9773-d3fc743e5d7a` | `19c1e3c1-2451-4edd-a0b1-a3e74468f08e` | cutout submitted |
| current planet selector | `56339fa6-4d6f-4031-a8b3-f0f362ee55f1` | `cc9f91fd-d834-4416-bcba-97308e974b0e` | alpha generated |
| campaign + utility module | `3ed70adb-7fd8-4a12-9661-31bbbff8382b` | `ba534dee-7dfa-482d-ad65-395a94c0b132` | cutout submitted |

## Veyra / Рой

| Role | Generation task | Alpha-cutout task | Status |
| --- | --- | --- | --- |
| planet frame | `958569f6-52c9-465c-9cd4-ebb3d73f8ee3` | `83bea2b6-5115-4e3c-869a-5a6d54622730` | alpha generated |
| navigation rail | `efb6e777-8508-40bf-915f-6b4d024e2a1b` | `02791cc8-6645-45b9-88e4-72bcdcc98833` | cutout submitted |
| current planet selector | `f0b0416d-753c-46f2-9cb6-4519eb03ee00` | `cced6630-d84e-4a0f-80fb-f0b380cced01` | cutout submitted |
| campaign + utility module | `213558fa-c788-42f6-9270-36237449d23a` | `dee4bd81-6173-4fc5-b502-1d0c8f46b8b7` | cutout submitted |

## Integration gate

Do not wire temporary generation URLs into CSS. A generated candidate becomes runtime-ready only after all of the following are true:

1. alpha cutout is complete;
2. no baked-in text, numbers, icons or planet art remain;
3. edges are clean at the intended runtime size;
4. the file is copied into `assets/source/faction-header-v2/<faction>/`;
5. `asterion-header-faction-skins.css` references the local asset;
6. 1920x1080 QA confirms the decorative layer does not cover live DOM content;
7. tooltip / hover / focus / active-state QA still passes.

## Current blocker

The connected GitHub contents API can write UTF-8 files but cannot ingest the generated binary PNG bytes directly from the remote generation workspace. Therefore the branch contains the complete skin/token integration and this deterministic asset manifest, while final PNG copy-in remains a separate binary transfer step. Temporary signed generation URLs must not be committed as runtime dependencies.
