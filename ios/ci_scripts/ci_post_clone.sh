#!/bin/sh
# Xcode Cloud runs this right after cloning, before dependencies and the build.
# This is an Expo CNG project: ios/ is gitignored except for these scripts, so every
# build is a clean clone with no native project. `expo prebuild` generates it here,
# including the local VlcPlayer module under modules/, and `pod install` pulls
# MobileVLCKit. Mirrors health-tracker's setup.
set -e

echo "▶ ci_post_clone: toolchain + expo prebuild"
cd "$CI_PRIMARY_REPOSITORY_PATH"

brew install node@24 cocoapods
brew link --overwrite --force node@24
echo "node $(node --version) / npm $(npm --version) / pod $(pod --version)"

npm ci

export CI=true
echo "▶ expo prebuild…"
npx expo prebuild --platform ios --no-install

echo "▶ pod install…"
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
pod install

echo "✔ ci_post_clone done"
