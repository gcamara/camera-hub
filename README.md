# Camera Hub

One iOS app for every IP camera on your network, whatever the brand. It plays each camera's
RTSP stream directly over Wi‑Fi (no vendor cloud, no relay server), finds cameras with ONVIF,
and keeps passwords in the iOS keychain.

- **Grid** of live sub‑stream previews; tap for full screen (rotates to landscape), long‑press to edit.
- **Add manually** with presets for Hikvision / Annke / HiLook, Dahua / Amcrest / Lorex / Imou, Reolink,
  TP‑Link Tapo, Wyze (RTSP firmware), Ubiquiti UniFi (standalone), Axis, Foscam, Uniview, Eufy — or paste
  any `rtsp://` URL. **Detect** asks the camera who made it (unauthenticated ONVIF, then the web login
  page's fingerprint) and fills the brand, ports and paths without touching anything you typed. A
  **Test stream** button plays the feed before you save.
- **Find cameras** scans your subnet for ONVIF devices and for web logins that look like a known camera
  brand, names the brand it recognised, signs in, lists media profiles and reads the real stream
  addresses from the camera. Cameras without ONVIF get an **Add manually** shortcut with host and brand
  filled in.
- **Camera hub** (optional): point the app at a hub on your network and it lists the hub's cameras
  beside your own, playing the streams the hub restreams through go2rtc. The hub's cameras are
  read‑only here and their own passwords never reach the phone.
- **Live preview per camera**: a camera that tolerates a single RTSP session can be left out of the
  grid, so the full‑screen viewer always gets the session.
- Full‑screen viewer: main/sub stream switch, mute, auto‑reconnect with back‑off.

Cloud‑only cameras (Ring, Nest, Arlo, Blink, Eufy without RTSP) have no local stream and cannot be added.

## Stack

Expo SDK 57 · React Native 0.86 (New Architecture) · expo‑router · a local Expo module wrapping
MobileVLCKit (`modules/vlc-player`, ~120 lines of Swift) · zustand · fast-xml-parser.

Why a local module: the two npm VLC bindings were both dead ends — `react-native-vlc-media-player`
has no New-Architecture support (issue #253), and `extended-vlc-player` 0.1.5 does not compile
(legacy view-manager macros inside a Fabric view, a non-`@objc` Swift class cast from Obj-C++, no view
registered under the name its JS asks for). Expo's `View` API needs none of that: libVLC draws straight
into the `ExpoView`, and only state events cross to JS.

## Building for your iPhone

The VLC engine is native code, so **Expo Go cannot run this app** — you need a development build.
From Windows the practical route is EAS Build (free tier is enough):

```bash
npm install -g eas-cli
eas login
eas build --profile development --platform ios
```

EAS will ask to register your device the first time (`eas device:create`). Install the build from the
link it prints, then start the bundler:

```bash
npm start
```

On a Mac with Xcode you can instead run `npx expo run:ios --device`.

Later builds only need to be rebuilt when native dependencies change; JS edits load over the dev client.

### TestFlight

Signing and submission authenticate with an App Store Connect API key, never an Apple ID session,
so the whole pipeline runs from a terminal with no prompts. Set the key once per shell:

```powershell
$env:EXPO_ASC_API_KEY_PATH = 'C:\path\to\AuthKey_XXXXXXXXXX.p8'
$env:EXPO_ASC_KEY_ID = 'XXXXXXXXXX'
$env:EXPO_ASC_ISSUER_ID = '<issuer id>'
```

First time only, `.\scripts\eas-ios-credentials.ps1` creates the distribution certificate and profile.
Then:

```bash
eas build --profile production --platform ios
eas submit --profile production --platform ios --latest
```

The `.p8` file must stay out of the repo (`*.p8` is gitignored); the key ID and issuer ID are read
from the environment rather than committed.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # jest (pure logic: RTSP URL building, ONVIF SOAP/XML, subnet scanning)
```

Layout:

```
app/                       expo-router screens
  index.tsx                camera grid / empty state
  camera/[id]/index.tsx    full-screen viewer
  camera/[id]/edit.tsx     edit + delete
  add/{index,manual,discover}.tsx
  settings.tsx
  hub.tsx                  connect to / manage the camera hub
modules/vlc-player/        local Expo module: VlcPlayerView (Swift + MobileVLCKit), iOS only
src/components/            CameraPlayer (adapter over VlcPlayerView), CameraTile, CameraForm, ui primitives
src/hooks/                 useReconnect (back-off), useVisibility (focus + AppState gating),
                           usePlayable (local + hub cameras), useHubRefresh (retry on foreground)
src/lib/brands.ts          RTSP path presets per brand
src/lib/hub.ts             hub API client: bearer auth, ETag, defensive payload parsing
src/lib/playable.ts        one view model for local and hub cameras; grid preview gating
src/lib/secrets.ts         keychain wrapper shared by camera passwords and the hub token
src/lib/fingerprint.ts     brand detection: ONVIF manufacturer, web-page fingerprints, brand-only ports
src/lib/rtsp.ts            URL build/parse/redact
src/lib/onvif/             SOAP + WS-Security digest, XML parsing, device client, subnet discovery
src/store/cameraStore.ts   zustand store; AsyncStorage for cameras, SecureStore for passwords
src/store/hubStore.ts      hub address + cached list/ETag in AsyncStorage, token in SecureStore
```

### The hub API

```
GET {hubBaseUrl}/api/cameras          Authorization: Bearer <token>
200 + ETag  { "hub": { "name", "version" },
              "cameras": [ { "id", "name", "brand", "livePreview",
                             "streams": { "main": { "url" }, "sub": { "url" } },
                             "capabilities": { "ptz" } } ] }
If-None-Match: <etag>  →  304        bad or missing token  →  401 { "error" }
```

An unknown `brand` falls back to the generic preset, a missing `livePreview` reads as on, and an entry
without an id or an `rtsp://` main stream is dropped rather than shown as a tile that never connects.

## Notes and limits

- Discovery probes ONVIF on ports 80, 8080, 2020 and 8000 and fetches the web page on port 80 across the
  /24 (about 40 s). WS‑Discovery multicast would be faster but needs a UDP native module; not included yet.
- Detection never uses HTTPS (cameras ship self-signed certificates that fetch rejects), so a camera whose
  only web login is on 443 is recognised solely through ONVIF. Wyze's RTSP firmware has no web page or
  ONVIF at all, so it cannot be detected; pick the preset by hand.
- Streams are requested over RTSP‑interleaved TCP (`--rtsp-tcp`) with a 1 s network cache; TCP survives
  Wi‑Fi packet loss far better than RTP over UDP.
- Tapo cameras: sign in with the *Camera Account* created in the Tapo app, not your TP‑Link login.
- Away from home, reach your LAN through a VPN (Tailscale, WireGuard); the app has no relay.
- When the hub cannot be reached, its cameras stay on the grid from cache and say so. They cannot be
  played in that state: the phone holds go2rtc's credentials, not the cameras', so there is no direct
  route to fall back to. The list is asked for again whenever the app returns to the foreground.
- Bundle size grows by roughly 25–35 MB (thinned) because of MobileVLCKit.

### Xcode Cloud (alternative to EAS)

The repo is also wired for Xcode Cloud the way `health-tracker` is: `ios/ci_scripts/ci_post_clone.sh`
installs Node and CocoaPods and runs `expo prebuild` on Apple's clean clone (so `ios/` stays out of
git), `ci_pre_xcodebuild.sh` sets `CFBundleVersion` from `CI_BUILD_NUMBER + 100` (EAS already used
1–7), and a push to **`release`** is the build trigger — `main` never builds:

```bash
git checkout release && git merge --ff-only main && git push origin release && git checkout main
```

Apple's API cannot create the Xcode Cloud *product* (it answers `ciProducts does not allow CREATE`),
so the first workflow is a one-time job on a Mac: `npx expo prebuild --platform ios`, open
`ios/CameraHub.xcworkspace` in Xcode, Integrate → Create Workflow, pick the "Camera Hub" app, grant the
Xcode Cloud GitHub App access to `gcamara/camera-hub`, start condition = branch `release`, action =
Archive iOS → TestFlight (Internal). From then on `scripts/xcode-cloud-build.mjs --list | --status |
--branch release [--wait]` follows and re-runs builds through the API, with the same
`EXPO_ASC_*` variables as the submit script.

Quota: Xcode Cloud's free 25 h/month is per Apple team and shared with Health Tracker (which budgets
80 % of it); a Camera Hub build is ~10–15 min. EAS's free 30 builds/month are separate, so EAS
remains the cheaper place to iterate; Xcode Cloud's advantage is that it uploads straight to
TestFlight with no submission queue.
