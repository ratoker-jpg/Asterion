# Messages V2 screenshot notes

Captures use the current Test Mode build at 1920×1080 and 1280×720. The System spy dossier uses a synthetic `Станция Керн` snapshot strictly to show the full dossier layout. The remaining screenshots use the app's existing Test Mode state and the QA harness fixtures.

The profile now has no watermark behind the score cards. Score medals render at 96×96 with 30px values and 11px labels; rows are compact, the alliance uses a circular group icon, and recent events use the current report feed. The test harness assertion sizes match the approved mockup values.

The profile mockup says `[HLN] · 12 участников`; the current Command fixture contains 8 members, so the UI displays the live count instead of a fixed mockup number. Profile ranking, wins, achievement totals, and identity metadata are also kept to fields present in the current model.

`08-command-empty.png` keeps the empty explanation in the dossier preview and exposes a screen-reader status in the otherwise empty message list. Battle-side colors and the System dossier section headings now match the reference palette and treatment.
