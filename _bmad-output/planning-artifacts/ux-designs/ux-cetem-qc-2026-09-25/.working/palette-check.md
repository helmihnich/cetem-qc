# Palette contrast check

Computed 2026-09-25 from the existing UX guide hex colors using sRGB relative luminance and `(lighter + 0.05) / (darker + 0.05)`. Ratios rounded to two decimals. These checks cover the listed combinations only, not rendered UI or whole-product accessibility.

| Foreground | White #FFFFFF | App #F7F8FA |
|---|---:|---:|
| Main text #1F2933 | 14.76 | 13.89 |
| Secondary #667085 | 4.97 | 4.68 |
| Primary #2563EB | 5.17 | 4.86 |
| Success #15803D | 5.02 | 4.72 |
| Warning #B45309 | 5.02 | 4.73 |
| Error #B42318 | 6.57 | 6.19 |
| Information #0369A1 | 5.93 | 5.58 |
| Border #E4E7EC | 1.24 | 1.17 |

Retained text/accent pairings exceed 4.5:1 on both specified surfaces. Light borders do not reach 3:1 and cannot serve alone where identification of an interactive boundary or state requires that contrast. Pale badge fills are not assigned precise source tokens; check each actual pairing before implementation acceptance.

DESIGN.md shape was checked against the [Google Labs format reference](https://github.com/google-labs-code/design.md), accessed 2026-09-25; BMAD canonical heading aliases remain valid. This is a formatting source, not authority for product decisions.
