# Self-Hosted Fonts

Both `apps/web/public/fonts/` and `apps/marketing/public/fonts/` contain
identical copies of the following woff2 files. Each app serves its own fonts —
no cross-app font fetching.

## Files

| File | Family | Weight | Style |
|---|---|---|---|
| `Inter-Regular.woff2` | Inter | 400 | normal |
| `Inter-Medium.woff2` | Inter | 500 | normal |
| `Inter-SemiBold.woff2` | Inter | 600 | normal |
| `InstrumentSerif-Regular.woff2` | Instrument Serif | 400 | normal |
| `InstrumentSerif-Italic.woff2` | Instrument Serif | 400 | italic |

## Sources

Files were downloaded from [Fontsource](https://fontsource.org/) CDN
(Latin subset, woff2 format) which mirrors the official Google Fonts distribution.

- Inter: https://fonts.google.com/specimen/Inter (designed by Rasmus Andersson)
- Instrument Serif: https://fonts.google.com/specimen/Instrument+Serif (designed by Rodrigo Fuenzalida)

## Licenses

Both fonts are licensed under the **SIL Open Font License 1.1 (OFL-1.1)**.

Full license text: https://scripts.sil.org/OFL

## Rationale

No third-party CDN requests — PRD constraint. Every app serves its own fonts
from its `public/fonts/` directory so there is no runtime dependency on
fonts.googleapis.com or fonts.gstatic.com.
