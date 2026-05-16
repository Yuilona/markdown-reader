# Bundled fonts

## `sarasa-ui-sc-subset.woff2`

**Status (PR-6)**: ZERO-BYTE PLACEHOLDER — replace before release.

The real font is **Sarasa UI SC** (a Source Han Sans + Iosevka hybrid),
subsetted to the common-CJK glyph range so we ship ~1.5 MB instead of
the full ~20 MB family. Per PRD §R9.5 it's the canonical body font;
fallback chain is `Segoe UI Variable / Microsoft YaHei / PingFang SC`.

The browser will silently 404 on the empty placeholder and fall through
to the next font in `--font-stack-body` (defined in
`src/styles/fonts.css`). No visual regression — Win11 ships with Segoe
UI Variable + Microsoft YaHei, which together cover virtually every
character a Chinese-language reader will encounter.

## Replacing the placeholder

1. Download **Sarasa Gothic** from
   <https://github.com/be5invis/Sarasa-Gothic/releases>.
   Pick the **TTF** variant of `sarasa-ui-sc-regular.ttf` (and `bold`
   if you want both weights — `font-weight: 100 900` in the @font-face
   accepts a variable font OR multiple separate faces; for v0.1 the
   regular weight is sufficient).

2. Subset to the common CJK character set with
   [`pyftsubset`](https://fonttools.readthedocs.io/) (part of fontTools):

   ```bash
   pip install fonttools brotli
   pyftsubset sarasa-ui-sc-regular.ttf \
     --unicodes="U+0020-007E,U+00A0-00FF,U+2000-206F,U+3000-303F,U+3040-309F,U+30A0-30FF,U+4E00-9FFF,U+FF00-FFEF" \
     --layout-features='*' \
     --flavor=woff2 \
     --output-file=sarasa-ui-sc-subset.woff2
   ```

   The `--unicodes` range covers Basic Latin, Latin-1 Supplement,
   General Punctuation, CJK Symbols & Punctuation, Hiragana, Katakana,
   CJK Unified Ideographs (the main GB2312/GBK block), and Halfwidth /
   Fullwidth Forms — together about 21,000 glyphs.

   Expected output size: ~1.4–1.6 MB woff2.

3. Drop the resulting `sarasa-ui-sc-subset.woff2` into this directory
   (overwriting the placeholder). Vite picks it up on next build.

## Why a placeholder ships in PR-6

Bundling a multi-megabyte binary in the same PR as the theme system
risks blowing the diff size and slowing down code review. The font is
a release-time asset (PR-9 or manual) — PR-6's job is to wire up the
`@font-face` rule and the family chain so the asset slot is ready.
