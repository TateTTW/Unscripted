# Placeholder assets

These files were created during implementation because the real asset was not supplied.
They use the real file names and paths, so replacing a file needs no code change.
Remove an entry when its real asset replaces it.

| File | Notes |
|---|---|
| `sprites/icons.png` | 80x16, five 16x16 frames in order: `icon_paper`, `icon_bottle`, `icon_tool`, `icon_trinket`, `icon_hazard`. Simple programmer art. |
| `sprites/npcs.json` | Seven appearance descriptions written by looking at the down-facing idle frame of `npc1.png` through `npc7.png`. Replace with the owner's descriptions if preferred. |

`fonts/gridwright_5x7_regular.xml` is not a placeholder: it is the BMFont XML conversion of the supplied
`gridwright_5x7_regular.fnt` (kept as the source), generated once for Phaser's `load.bitmapFont`.
