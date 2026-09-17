# Camera Hub

One iOS app for every IP camera on your network, whatever the brand. It plays each camera's
RTSP stream directly over Wi‑Fi (no vendor cloud, no relay server), finds cameras with ONVIF,
and keeps passwords in the iOS keychain.

- **Grid** of live sub‑stream previews; tap for full screen (rotates to landscape), long‑press to edit.
- **Add manually** with presets for Hikvision / Annke / HiLook, Dahua / Amcrest / Lorex / Imou, Reolink,
  TP‑Link Tapo, Wyze (RTSP firmware), Ubiquiti UniFi (standalone), Axis, Foscam, Uniview, Eufy — or paste
  any `rtsp://` URL. A **Test stream** button plays the feed before you save.
- **Find cameras** scans your subnet for ONVIF devices, signs in, lists their media profiles and reads the
  real stream addresses from the camera.
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
modules/vlc-player/        local Expo module: VlcPlayerView (Swift + MobileVLCKit), iOS only
src/components/            CameraPlayer (adapter over VlcPlayerView), CameraTile, CameraForm, ui primitives
src/hooks/                 useReconnect (back-off), useVisibility (focus + AppState gating)
src/lib/brands.ts          RTSP path presets per brand
src/lib/rtsp.ts            URL build/parse/redact
src/lib/onvif/             SOAP + WS-Security digest, XML parsing, device client, subnet discovery
src/store/cameraStore.ts   zustand store; AsyncStorage for cameras, SecureStore for passwords
```

## Notes and limits

- ONVIF discovery probes HTTP ports 80, 8080, 2020 and 8000 across the /24 (about 30 s). WS‑Discovery
  multicast would be faster but needs a UDP native module; not included yet.
- Streams are requested over RTSP‑interleaved TCP (`--rtsp-tcp`) with a 1 s network cache; TCP survives
  Wi‑Fi packet loss far better than RTP over UDP.
- Tapo cameras: sign in with the *Camera Account* created in the Tapo app, not your TP‑Link login.
- Away from home, reach your LAN through a VPN (Tailscale, WireGuard); the app has no relay.
- Bundle size grows by roughly 25–35 MB (thinned) because of MobileVLCKit.
