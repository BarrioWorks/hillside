#!/usr/bin/env sh
# Pairs docs/screenshots/before and after PNGs into captioned side-by-side JPEGs. Requires ImageMagick.
set -eu
cd "$(dirname "$0")/../docs/screenshots"
mkdir -p compare
pair() {
  montage -label "$3" "before/$1.png" -label "$4" "after/$2.png" -tile 2x1 -geometry '+12+12' \
    -pointsize 26 -background '#f2ead9' -resize 960x "compare/$2.png"
  convert "compare/$2.png" -quality 84 "compare/$2.jpg" && rm "compare/$2.png"
}
for shot in 01-single-house 02-six-buildings 03-dense-hillside 04-full-diorama 05-gameplay-ui 06-reverse-angle 07-low-angle 08-mobile; do
  pair "$shot" "$shot" 'Before (prototype)' 'After (redesign)'
done
pair 00-original-starter 00-starter 'Before: original starter' 'After: new starter'
montage -label 'Warm afternoon' after/03-dense-hillside.png -label 'Bright daylight' after/10-daylight.png \
  -label 'Soft evening' after/09-evening.png -tile 3x1 -geometry '+10+10' -pointsize 24 -background '#f2ead9' \
  -resize 720x compare/lighting-presets.png
convert compare/lighting-presets.png -quality 84 compare/lighting-presets.jpg && rm compare/lighting-presets.png
