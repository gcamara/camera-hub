import { Ionicons } from '@expo/vector-icons';
import * as Network from 'expo-network';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Chip, Field, Muted, SectionLabel } from '@/components/ui';
import {
  createOnvifDevice,
  DEFAULT_ONVIF_PORTS,
  OnvifError,
  pickDefaultProfiles,
  scanHosts,
  subnetHosts,
  type DeviceInformation,
  type DiscoveredDevice,
  type OnvifProfile,
} from '@/lib/onvif';
import { brandFromManufacturer } from '@/lib/brands';
import { probeOnvif } from '@/lib/onvif/discovery';
import { parseRtspUrl } from '@/lib/rtsp';
import type { CameraInput } from '@/lib/types';
import { useCameraStore } from '@/store/cameraStore';
import { colors, font, spacing } from '@/theme';

type Phase = 'idle' | 'scanning' | 'done';

interface ConnectedState {
  info: DeviceInformation;
  profiles: OnvifProfile[];
  mainToken: string;
  subToken: string;
}

function deviceKey(device: DiscoveredDevice): string {
  return `${device.host}:${device.port}`;
}

function describeProfile(profile: OnvifProfile): string {
  const parts: string[] = [];
  if (profile.width && profile.height) parts.push(`${profile.width} × ${profile.height}`);
  if (profile.encoding) parts.push(profile.encoding);
  return parts.join(' · ') || 'Unknown resolution';
}

function parseCidr(value: string): { ip: string; prefix: number } | null {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return { ip: match[1]!, prefix: match[2] ? Number(match[2]) : 24 };
}

interface DeviceCardProps {
  device: DiscoveredDevice;
  existingName?: string;
  expanded: boolean;
  onToggle: () => void;
  onAdded: () => void;
}

function DeviceCard({ device, existingName, expanded, onToggle, onAdded }: DeviceCardProps) {
  const addCamera = useCameraStore((state) => state.addCamera);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'connect' | 'add' | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [connected, setConnected] = useState<ConnectedState | null>(null);
  const [name, setName] = useState('');

  const connect = useCallback(async () => {
    setBusy('connect');
    setError(undefined);
    try {
      const onvif = createOnvifDevice(device.host, device.port, { username, password });
      await onvif.syncClock();
      let info: DeviceInformation = {};
      try {
        info = await onvif.getDeviceInformation();
      } catch (e) {
        if (e instanceof OnvifError && e.kind === 'auth') throw e;
      }
      const profiles = await onvif.getProfiles();
      const defaults = pickDefaultProfiles(profiles);
      setConnected({
        info,
        profiles,
        mainToken: defaults.main?.token ?? '',
        subToken: defaults.sub?.token ?? '',
      });
      setName([info.manufacturer, info.model].filter(Boolean).join(' ') || device.host);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not talk to the camera.');
    } finally {
      setBusy(null);
    }
  }, [device, username, password]);

  const add = useCallback(async () => {
    if (!connected || connected.mainToken === '') return;
    setBusy('add');
    setError(undefined);
    try {
      const onvif = createOnvifDevice(device.host, device.port, { username, password });
      await onvif.syncClock();
      const mainUri = parseRtspUrl(await onvif.getStreamUri(connected.mainToken));
      if (!mainUri) throw new Error('The camera returned a stream address that is not RTSP.');
      let subPath = '';
      if (connected.subToken !== '') {
        const subUri = parseRtspUrl(await onvif.getStreamUri(connected.subToken));
        if (subUri && subUri.port === mainUri.port) subPath = subUri.path;
      }
      const input: CameraInput = {
        name: name.trim() || device.host,
        brand: brandFromManufacturer(connected.info.manufacturer),
        host: device.host,
        rtspPort: mainUri.port,
        username,
        channel: 1,
        mainPath: mainUri.path,
        subPath,
        onvif: {
          port: device.port,
          manufacturer: connected.info.manufacturer,
          model: connected.info.model,
          mainProfile: connected.mainToken,
          subProfile: connected.subToken || undefined,
        },
      };
      await addCamera(input, password);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the camera.');
      setBusy(null);
    }
  }, [connected, device, username, password, name, addCamera, onAdded]);

  const setRole = useCallback((token: string, role: 'main' | 'sub') => {
    setConnected((prev) => {
      if (!prev) return prev;
      if (role === 'main') return { ...prev, mainToken: token, subToken: prev.subToken === token ? '' : prev.subToken };
      return { ...prev, subToken: prev.subToken === token ? '' : token, mainToken: prev.mainToken === token ? '' : prev.mainToken };
    });
  }, []);

  return (
    <Card style={expanded ? styles.cardExpanded : undefined}>
      <View style={styles.cardHeader}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>
            {device.host} · port {device.port}
          </Text>
          <Text style={styles.cardSubtitle}>
            {existingName
              ? `Already added as “${existingName}”`
              : connected
                ? [connected.info.manufacturer, connected.info.model, connected.info.firmwareVersion && `firmware ${connected.info.firmwareVersion}`].filter(Boolean).join(' · ') || 'ONVIF device'
                : device.authRequired
                  ? 'ONVIF device · sign in to see model and streams'
                  : 'ONVIF device'}
          </Text>
        </View>
        {existingName ? (
          <Ionicons name="checkmark" size={22} color={colors.live} />
        ) : connected ? (
          <View style={styles.signedIn}>
            <Text style={styles.signedInText}>Signed in</Text>
          </View>
        ) : (
          <Button title={expanded ? 'Hide' : 'Sign in'} variant="ghost" onPress={onToggle} style={styles.smallButton} />
        )}
      </View>

      {expanded && !existingName ? (
        connected ? (
          <View style={styles.connected}>
            <SectionLabel>Pick the streams</SectionLabel>
            {connected.profiles.map((profile) => (
              <View key={profile.token} style={styles.profile}>
                <View style={styles.flex}>
                  <Text style={styles.profileName}>{profile.name || profile.token}</Text>
                  <Text style={styles.profileMeta}>{describeProfile(profile)}</Text>
                </View>
                <View style={styles.roles}>
                  <Chip label="Main" selected={connected.mainToken === profile.token} onPress={() => setRole(profile.token, 'main')} />
                  <Chip label="Sub" selected={connected.subToken === profile.token} onPress={() => setRole(profile.token, 'sub')} />
                </View>
              </View>
            ))}
            <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Add camera" icon="add" loading={busy === 'add'} disabled={connected.mainToken === ''} onPress={add} />
          </View>
        ) : (
          <View style={styles.credentials}>
            <View style={styles.row}>
              <Field label="Username" value={username} onChangeText={setUsername} containerStyle={styles.flex} />
              <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry containerStyle={styles.flex} />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Connect" variant="secondary" loading={busy === 'connect'} onPress={connect} />
            <Muted>Tapo cameras use the “Camera Account” from the Tapo app; Reolink and Hikvision use the admin login.</Muted>
          </View>
        )
      ) : null}
    </Card>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const cameras = useCameraStore((state) => state.cameras);
  const [cidr, setCidr] = useState('');
  const [cidrError, setCidrError] = useState<string | undefined>();
  const [single, setSingle] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    Network.getIpAddressAsync()
      .then((ip) => {
        if (!cancelled && ip && ip !== '0.0.0.0') setCidr(`${ip}/24`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      abort.current?.abort();
    };
  }, []);

  const existingByHost = useMemo(() => new Map(cameras.map((camera) => [camera.host, camera.name])), [cameras]);

  const addDevice = useCallback((device: DiscoveredDevice) => {
    setDevices((prev) => (prev.some((d) => d.host === device.host) ? prev : [...prev, device]));
  }, []);

  const scan = useCallback(async () => {
    const parsed = parseCidr(cidr);
    if (!parsed) {
      setCidrError('Use the form 192.168.1.0/24.');
      return;
    }
    setCidrError(undefined);
    setNotice(undefined);
    const hosts = subnetHosts(parsed.ip, parsed.prefix);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setDevices([]);
    setExpanded(null);
    setPhase('scanning');
    setProgress({ done: 0, total: hosts.length * DEFAULT_ONVIF_PORTS.length });
    const found = await scanHosts(hosts, DEFAULT_ONVIF_PORTS, {
      fetch: (url, init) => fetch(url, init),
      timeoutMs: 1500,
      concurrency: 48,
      signal: controller.signal,
      onProgress: (done, total) => setProgress({ done, total }),
    });
    if (controller.signal.aborted) return;
    setDevices(found);
    setPhase('done');
  }, [cidr]);

  const stop = useCallback(() => {
    abort.current?.abort();
    setPhase('done');
  }, []);

  const probeSingle = useCallback(async () => {
    const match = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(single.trim());
    if (!match) {
      setNotice('Enter an address like 192.168.1.50 or 192.168.1.50:8080.');
      return;
    }
    setProbing(true);
    setNotice(undefined);
    const host = match[1]!;
    const ports = match[2] ? [Number(match[2])] : DEFAULT_ONVIF_PORTS;
    let hit: DiscoveredDevice | null = null;
    for (const port of ports) {
      hit = await probeOnvif(host, port, (url, init) => fetch(url, init), 3000);
      if (hit) break;
    }
    setProbing(false);
    if (hit) {
      addDevice(hit);
      setExpanded(deviceKey(hit));
      if (phase === 'idle') setPhase('done');
    } else {
      setNotice(`${host} did not answer as an ONVIF device on ${ports.join(', ')}.`);
    }
  }, [single, addDevice, phase]);

  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  const hostsDone = Math.floor(progress.done / DEFAULT_ONVIF_PORTS.length);
  const hostsTotal = Math.floor(progress.total / DEFAULT_ONVIF_PORTS.length);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>
              {phase === 'idle' ? 'Scan your network' : phase === 'scanning' ? 'Scanning…' : 'Scan finished'}
            </Text>
            {phase !== 'idle' ? (
              <Text style={styles.counter}>
                {hostsDone} / {hostsTotal} hosts
              </Text>
            ) : null}
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${percent}%` }]} />
          </View>
          <View style={styles.row}>
            <Field
              label=""
              value={cidr}
              onChangeText={(t) => {
                setCidr(t);
                setCidrError(undefined);
              }}
              placeholder="192.168.1.0/24"
              keyboardType="numbers-and-punctuation"
              mono
              error={cidrError}
              editable={phase !== 'scanning'}
              containerStyle={styles.flex}
            />
            {phase === 'scanning' ? (
              <Button title="Stop" variant="secondary" onPress={stop} style={styles.scanButton} />
            ) : (
              <Button title={phase === 'idle' ? 'Scan' : 'Rescan'} icon="search" onPress={scan} style={styles.scanButton} />
            )}
          </View>
          <Muted>ONVIF on ports {DEFAULT_ONVIF_PORTS.join(', ')} · about 30 s for a /24</Muted>
        </Card>

        {phase !== 'idle' ? (
          <>
            <SectionLabel>
              {devices.length === 0 ? (phase === 'scanning' ? 'Looking…' : 'No devices found') : `${devices.length} ${devices.length === 1 ? 'device' : 'devices'} found`}
            </SectionLabel>
            {devices.map((device) => {
              const key = deviceKey(device);
              return (
                <DeviceCard
                  key={key}
                  device={device}
                  existingName={existingByHost.get(device.host)}
                  expanded={expanded === key}
                  onToggle={() => setExpanded((current) => (current === key ? null : key))}
                  onAdded={() => router.dismissTo('/')}
                />
              );
            })}
          </>
        ) : null}

        <Card>
          <SectionLabel>Probe a single address</SectionLabel>
          <View style={styles.row}>
            <Field
              label=""
              value={single}
              onChangeText={setSingle}
              placeholder="192.168.1.50:8080"
              keyboardType="numbers-and-punctuation"
              mono
              containerStyle={styles.flex}
            />
            <Button title="Probe" variant="secondary" loading={probing} onPress={probeSingle} style={styles.scanButton} />
          </View>
          {notice ? <Text style={styles.error}>{notice}</Text> : null}
        </Card>

        <Muted center>
          Camera not listed? It may not speak ONVIF, or ONVIF may be disabled in its settings. You can still add it manually.
        </Muted>
        <Button title="Add manually" variant="ghost" onPress={() => router.replace('/add/manual')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  cardExpanded: { borderWidth: 1, borderColor: colors.inputBorder },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  cardTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  cardSubtitle: { fontSize: font.small, lineHeight: 18, color: colors.muted },
  counter: { fontSize: font.small, color: colors.muted, fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
  scanButton: { minHeight: 48, paddingHorizontal: spacing.md },
  smallButton: { minHeight: 40, paddingHorizontal: spacing.sm },
  signedIn: { height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: `${colors.live}29`, justifyContent: 'center' },
  signedInText: { fontSize: 12, fontWeight: '600', color: colors.live },
  credentials: { gap: spacing.md },
  connected: { gap: spacing.md },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
  },
  profileName: { fontSize: font.body, fontWeight: '600', color: colors.text },
  profileMeta: { fontSize: 12, color: colors.muted },
  roles: { flexDirection: 'row', gap: 6 },
  error: { fontSize: font.small, lineHeight: 18, color: colors.danger },
});
