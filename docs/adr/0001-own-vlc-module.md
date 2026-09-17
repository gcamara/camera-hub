# 1. Own Expo module around libVLC instead of an npm binding

Date: 2026-09-17

## Status

Accepted

## Context

iOS cannot play RTSP with AVPlayer, so the app needs libVLC. Two npm bindings exist.
`react-native-vlc-media-player` is a legacy view manager whose maintainers closed New
Architecture support as "not planned" (issue #253); React Native 0.82+ has no legacy
architecture. `extended-vlc-player` advertises Fabric support, ships types and a config plugin,
and does not compile: its umbrella header drags React's C++ into the Swift module, its Fabric
view mixes legacy view-manager macros with a `RCTViewComponentView`, returns an Objective-C
object where a C++ `ComponentDescriptorProvider` is required, casts a non-`@objc` Swift class
from Objective-C++, and registers no view under the name its JavaScript asks for. EAS build
`4882d534` proved it.

## Decision

Write the player as a local Expo module (`modules/vlc-player`): Swift on MobileVLCKit for iOS,
Kotlin on libvlc-all for Android, both through Expo's `View` API with the same props and events,
consumed by a single adapter (`src/components/CameraPlayer.tsx`). libVLC draws straight into a
native view; only state events cross to JavaScript.

Two libVLC facts are encoded in both twins and must survive any refactor: `stop()` blocks until
the network input winds down, and every control call made after `play()` (crop, scale, volume,
mute) blocks on the input thread — on iOS, from the main thread, that deadlocks the video output.
Controls are applied before `play()`; later changes and teardown run on a background queue.

## Consequences

- Nothing to upgrade or wait for upstream; ~200 lines per platform to own.
- Picture-in-Picture and background audio are not provided; adding them is our work.
- Native changes can only be compiled in EAS (iOS) or a local Gradle build (Android); the JS
  adapter is the seam to swap in a maintained binding if one appears.
