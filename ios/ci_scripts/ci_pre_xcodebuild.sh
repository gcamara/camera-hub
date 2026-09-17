#!/bin/sh
# Runs after prebuild/pod install and before xcodebuild. The prebuild writes
# CFBundleVersion = "1"; TestFlight rejects a build number that is not higher than
# every build already uploaded for the same version. EAS uploaded builds 1–7 with
# its remote counter, so Xcode Cloud's $CI_BUILD_NUMBER is offset by 100 to stay
# above them and to keep the two pipelines from ever colliding.
set -e
BUILD_NUMBER=$((CI_BUILD_NUMBER + 100))
echo "▶ ci_pre_xcodebuild: CFBundleVersion = ${BUILD_NUMBER}"

cd "$CI_PRIMARY_REPOSITORY_PATH/ios"

find . -name "Info.plist" -not -path "*/Pods/*" -not -path "*/build/*" | while read -r plist; do
  if /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${BUILD_NUMBER}" "$plist" >/dev/null 2>&1; then
    echo "  ✔ CFBundleVersion=${BUILD_NUMBER} → $plist"
  fi
done

echo "✔ ci_pre_xcodebuild done"
