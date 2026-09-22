# Camera Hub

One phone app for every IP camera on a home network, whatever its brand, playing each camera's own
stream over the LAN with no cloud in between.

## Language

**Camera**:
A saved device the app can play: a host, an RTSP port, credentials and one or two stream paths.
_Avoid_: device (that is a Discovered device, below), feed

**Hub**:
A server on the network that owns its own camera list and restreams each of its cameras through
go2rtc. The app pulls that list over an authenticated HTTP API and plays the URLs it returns; it never
learns those cameras' own passwords, only go2rtc's, which are embedded in the URLs.
_Avoid_: server, NVR, bridge

**Playable camera**:
One camera as the grid and the viewer see it, saved on this phone or served by the hub: a name, a
brand, an origin and the stream URLs, with nothing else about where it came from.
_Avoid_: item, entry

**Stream**:
One RTSP endpoint of a camera. Every camera has a *main* stream; most also have a *sub* stream at a
lower resolution, which the grid plays.
_Avoid_: channel (that is the NVR input number), profile (that is ONVIF's term)

**Brand preset**:
The known RTSP paths, RTSP port and ONVIF port for a camera brand, used to pre-fill a camera. A
camera keeps its own paths after saving; the preset is only a starting point.
_Avoid_: template, vendor

**Discovered device**:
An address on the network that answered like a camera during a scan or a probe. It becomes a Camera
only after credentials and streams are chosen.
_Avoid_: result, hit

**Probe**:
One unauthenticated request to an address that asks "are you a camera, and which kind?" — an ONVIF
call or an HTTP fetch of the web login page.

**Fingerprint**:
A recognisable marker in a probe's answer that names a brand: a login-page title, a server header, an
ONVIF manufacturer string.

**Evidence**:
The fingerprint a detection matched, shown to the person so a wrong brand guess is visible and
correctable.
_Avoid_: reason, confidence

**Detection**:
Running the probes against one address and pre-filling the brand preset from the strongest
fingerprint. Detection fills empty fields and never overwrites one the person typed.
_Avoid_: auto-config, identification

**Reconnect**:
Remounting a stream's player after it reported an error, with an exponential delay between attempts.
_Avoid_: retry
