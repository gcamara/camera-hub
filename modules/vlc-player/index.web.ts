import { createElement, useEffect, useRef, type ComponentType, type CSSProperties } from 'react';
import { View } from 'react-native';

import type { VlcPlayerViewProps, VlcState } from './index';

export type { VlcPlayerViewProps, VlcState } from './index';

/**
 * How long the picture may sit on the same frame before this reports it as buffering again.
 * A live fragmented MP4 that dies mid-stream does not always fire `error` or `waiting` — the
 * socket just goes quiet — and the only reliable symptom is that `currentTime` stops moving.
 */
const STALL_MS = 6000;
const STALL_TICK_MS = 1000;

function describeMediaError(element: HTMLVideoElement): string {
  const error = element.error;
  if (!error) return 'The browser could not play this stream.';
  switch (error.code) {
    case 1:
      return 'The browser stopped loading the stream.';
    case 2:
      return 'The connection to the hub dropped.';
    case 3:
      return 'The stream is damaged and cannot be decoded.';
    case 4:
      return 'The hub did not serve a stream this browser can play.';
    default:
      return error.message || 'The browser could not play this stream.';
  }
}

/**
 * The browser half of the VLC view. It plays the fragmented MP4 the hub restreams, and it
 * reports the same five events the native view does, so `CameraPlayer` and `useReconnect`
 * drive it without knowing which of the two they are holding.
 *
 * The source is handed to a `<video>` element rather than pushed into `MediaSource` from
 * `fetch`, for three reasons. A `<video src>` request carries the hub's session cookie by
 * itself, which is the whole reason that cookie exists — an app-driven `fetch` could set an
 * Authorization header and would not need one. iPhone Safari has no `MediaSource` on
 * `<video>` at all, so the element is the only path that works everywhere the app is meant
 * to run. And clean-up is a real teardown rather than a promise to stop appending: pausing
 * and clearing `src` aborts the HTTP request, which is what keeps an abandoned tile from
 * holding a stream open on the hub. What is given up is buffer control — a browser decides
 * its own latency and this cannot trim it — and segment-level visibility, which the stall
 * check below replaces with something coarser but sufficient.
 */
export const VlcPlayerView: ComponentType<VlcPlayerViewProps> = function VlcPlayerViewWeb({
  uri,
  muted = true,
  paused = false,
  contentFit = 'contain',
  style,
  onPlaying,
  onBuffering,
  onError,
  onStopped,
  onPaused,
}) {
  const video = useRef<HTMLVideoElement | null>(null);

  // Every reported event re-renders the parent, so the callbacks live in a ref: only a new
  // URI may tear the element down and open a second connection to the hub.
  const handlers = useRef({ onPlaying, onBuffering, onError, onStopped, onPaused });
  handlers.current = { onPlaying, onBuffering, onError, onStopped, onPaused };

  const wantsPause = useRef(paused);
  wantsPause.current = paused;

  const wantsMute = useRef(muted);
  wantsMute.current = muted;

  useEffect(() => {
    const element = video.current;
    if (!element) return;

    const report = {
      buffering: (state: VlcState) => handlers.current.onBuffering?.({ nativeEvent: { isBuffering: true, state } }),
      playing: () => {
        handlers.current.onBuffering?.({ nativeEvent: { isBuffering: false, state: 'playing' } });
        handlers.current.onPlaying?.({ nativeEvent: {} });
      },
      error: (message: string, state: VlcState = 'error') =>
        handlers.current.onError?.({ nativeEvent: { message, state } }),
    };

    if (!uri) {
      report.error('This camera has no stream a browser can play.', 'invalid');
      return;
    }
    if (!/^https?:\/\//i.test(uri)) {
      // An RTSP URL reaching this view means the hub served no browser stream for the camera
      // and something upstream picked the phone's URL anyway. Say so rather than fail opaquely.
      report.error('This camera only streams over RTSP, which a browser cannot play.', 'invalid');
      return;
    }

    let disposed = false;
    let lastTime = -1;
    let lastProgressAt = Date.now();

    const onLoadStart = () => report.buffering('opening');
    const onWaiting = () => report.buffering('buffering');
    const onStalled = () => report.buffering('buffering');
    const onPlayingEvent = () => {
      lastProgressAt = Date.now();
      report.playing();
    };
    const onErrorEvent = () => report.error(describeMediaError(element));
    const onEnded = () => handlers.current.onStopped?.({ nativeEvent: { state: 'ended' } });
    const onPauseEvent = () => {
      // The browser pauses on its own at the end of a stream, and this effect pauses during
      // teardown; neither is the person asking for a still picture.
      if (disposed || element.ended || !wantsPause.current) return;
      handlers.current.onPaused?.({ nativeEvent: {} });
    };

    element.addEventListener('loadstart', onLoadStart);
    element.addEventListener('waiting', onWaiting);
    element.addEventListener('stalled', onStalled);
    element.addEventListener('playing', onPlayingEvent);
    element.addEventListener('error', onErrorEvent);
    element.addEventListener('ended', onEnded);
    element.addEventListener('pause', onPauseEvent);

    const stallTimer = setInterval(() => {
      if (disposed || element.paused || element.ended) return;
      if (element.currentTime !== lastTime) {
        lastTime = element.currentTime;
        lastProgressAt = Date.now();
        return;
      }
      // Reported as buffering, not as an error: the watchdog in CameraPlayer already owns how
      // long a quiet stream is allowed to stay quiet, and this only has to stop claiming it is
      // live. A stream that comes back fires `playing` and clears everything.
      if (Date.now() - lastProgressAt >= STALL_MS) report.buffering('buffering');
    }, STALL_TICK_MS);

    element.muted = wantsMute.current;
    element.src = uri;
    element.load();

    return () => {
      disposed = true;
      clearInterval(stallTimer);
      element.removeEventListener('loadstart', onLoadStart);
      element.removeEventListener('waiting', onWaiting);
      element.removeEventListener('stalled', onStalled);
      element.removeEventListener('playing', onPlayingEvent);
      element.removeEventListener('error', onErrorEvent);
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('pause', onPauseEvent);
      // Clearing the source is what actually aborts the request. Pausing alone leaves the
      // browser pulling the stream, and the hub counts that as a viewer for as long as it runs.
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
    // Only the URI belongs here. `muted` and `paused` have their own effects below, because
    // muting or pausing must never tear the element down and open a second stream on the hub.
  }, [uri]);

  useEffect(() => {
    if (video.current) video.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    const element = video.current;
    if (!element || !uri) return;
    if (paused) {
      element.pause();
      return;
    }
    let abandoned = false;
    void (async () => {
      try {
        await element.play();
      } catch (error) {
        if (abandoned) return;
        // Only a refusal is this promise's to report. An AbortError means something interrupted
        // the request — a new `load()`, a `pause()`, the browser parking video in a hidden tab —
        // and is no verdict on the stream; a source the browser cannot play also fires the
        // element's own `error` event, which already reports it. Treating either as a failure
        // here would start a reconnect loop against a hub that did nothing wrong.
        if (!(error instanceof Error) || error.name !== 'NotAllowedError') return;
        if (!element.muted) {
          // Autoplay with sound needs a gesture the grid never has. A muted picture is worth
          // more than a blocked one, and the viewer's unmute button is itself a gesture.
          element.muted = true;
          try {
            await element.play();
            return;
          } catch {
            // Fall through to the report below.
          }
        }
        if (abandoned) return;
        handlers.current.onError?.({ nativeEvent: { message: 'The browser blocked playback.', state: 'error' } });
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [paused, uri]);

  return createElement(
    View,
    { style: [{ backgroundColor: '#000000' }, style] },
    createElement('video', {
      ref: video,
      autoPlay: true,
      // React does not keep the `muted` attribute in sync with the property, so the effects
      // above own it; this only stops the first frame arriving unmuted.
      muted: true,
      playsInline: true,
      controls: false,
      preload: 'auto',
      disablePictureInPicture: true,
      style: { ...videoStyle, objectFit: contentFit },
    }),
  );
};

const videoStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  backgroundColor: '#000000',
};

export function getVlcLog(): Promise<string[]> {
  return Promise.resolve([
    '(no libVLC in a browser — video here is a <video> element playing the hub’s fragmented MP4)',
  ]);
}

export function clearVlcLog(): void {}
