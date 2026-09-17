import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CameraPlayer } from './CameraPlayer';
import { StatusPill } from './StatusPill';
import { Button, Chip, Field, Muted, SectionLabel } from './ui';
import { useReconnect } from '@/hooks/useReconnect';
import { BRANDS, getBrand, resolvePathTemplate } from '@/lib/brands';
import { buildStreamUrl, normalizePath, parseRtspUrl, redactUrl } from '@/lib/rtsp';
import type { BrandId, Camera, CameraInput } from '@/lib/types';
import { colors, font, spacing } from '@/theme';

export interface CameraFormValues {
  name: string;
  brand: BrandId;
  host: string;
  rtspPort: string;
  username: string;
  password: string;
  channel: string;
  mainPath: string;
  subPath: string;
}

interface CameraFormProps {
  initial?: Camera;
  initialPassword?: string;
  submitLabel: string;
  onSubmit: (input: CameraInput, password: string) => Promise<void>;
  footer?: ReactNode;
}

function valuesFrom(camera: Camera | undefined, password: string): CameraFormValues {
  const brand = getBrand(camera?.brand ?? 'generic');
  return {
    name: camera?.name ?? '',
    brand: brand.id,
    host: camera?.host ?? '',
    rtspPort: String(camera?.rtspPort ?? brand.rtspPort),
    username: camera?.username ?? '',
    password,
    channel: String(camera?.channel ?? 1),
    mainPath: camera?.mainPath ?? brand.mainPath,
    subPath: camera?.subPath ?? brand.subPath,
  };
}

type Errors = Partial<Record<keyof CameraFormValues, string>>;

export function validate(values: CameraFormValues): Errors {
  const errors: Errors = {};
  if (values.name.trim() === '') errors.name = 'Give the camera a name.';
  if (!/^[A-Za-z0-9.-]+$/.test(values.host.trim())) errors.host = 'Enter an IP address or hostname.';
  const port = Number(values.rtspPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.rtspPort = '1–65535';
  const channel = Number(values.channel);
  if (!Number.isInteger(channel) || channel < 1) errors.channel = '≥ 1';
  if (values.mainPath.trim() === '') errors.mainPath = 'The main stream path is required.';
  return errors;
}

export function toCameraInput(values: CameraFormValues, onvif?: Camera['onvif']): CameraInput {
  const input: CameraInput = {
    name: values.name.trim(),
    brand: values.brand,
    host: values.host.trim(),
    rtspPort: Number(values.rtspPort),
    username: values.username.trim(),
    channel: Number(values.channel) || 1,
    mainPath: normalizePath(values.mainPath),
    subPath: values.subPath.trim() === '' ? '' : normalizePath(values.subPath),
  };
  if (onvif) input.onvif = onvif;
  return input;
}

export function CameraForm({ initial, initialPassword = '', submitLabel, onSubmit, footer }: CameraFormProps) {
  const [values, setValues] = useState<CameraFormValues>(() => valuesFrom(initial, initialPassword));
  const [errors, setErrors] = useState<Errors>({});
  const [pathsTouched, setPathsTouched] = useState(initial !== undefined);
  const [pasteUrl, setPasteUrl] = useState('');
  const [pasteError, setPasteError] = useState<string | undefined>();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const reconnect = useReconnect(testing);

  const brand = getBrand(values.brand);

  const set = useCallback(<K extends keyof CameraFormValues>(key: K, value: CameraFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }, []);

  const selectBrand = useCallback(
    (id: BrandId) => {
      const preset = getBrand(id);
      setValues((prev) => ({
        ...prev,
        brand: id,
        rtspPort: String(preset.rtspPort),
        mainPath: pathsTouched ? prev.mainPath : preset.mainPath,
        subPath: pathsTouched ? prev.subPath : preset.subPath,
      }));
    },
    [pathsTouched],
  );

  const applyPastedUrl = useCallback(() => {
    const parts = parseRtspUrl(pasteUrl);
    if (!parts) {
      setPasteError('That does not look like an rtsp:// URL.');
      return;
    }
    setPasteError(undefined);
    setPathsTouched(true);
    setValues((prev) => ({
      ...prev,
      brand: 'generic',
      host: parts.host,
      rtspPort: String(parts.port),
      username: parts.username || prev.username,
      password: parts.password || prev.password,
      mainPath: parts.path,
    }));
    setPasteUrl('');
  }, [pasteUrl]);

  const previewCamera = useMemo(
    () => ({
      host: values.host.trim(),
      rtspPort: Number(values.rtspPort) || 554,
      username: values.username.trim(),
      channel: Number(values.channel) || 1,
      mainPath: normalizePath(values.mainPath),
      subPath: values.subPath.trim() === '' ? '' : normalizePath(values.subPath),
    }),
    [values],
  );
  const previewUrl = buildStreamUrl(previewCamera, values.password, 'main');
  const canTest = values.host.trim() !== '' && values.mainPath.trim() !== '';

  const submit = useCallback(async () => {
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaving(true);
    try {
      await onSubmit(toCameraInput(values, initial?.onvif), values.password);
    } finally {
      setSaving(false);
    }
  }, [values, onSubmit, initial]);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Name" value={values.name} onChangeText={(t) => set('name', t)} placeholder="Front door" error={errors.name} autoCapitalize="words" />

        <View style={styles.section}>
          <SectionLabel>Brand</SectionLabel>
          <View style={styles.chips}>
            {BRANDS.filter((b) => b.id !== 'onvif' || values.brand === 'onvif').map((b) => (
              <Chip key={b.id} label={b.label} selected={values.brand === b.id} onPress={() => selectBrand(b.id)} />
            ))}
          </View>
          {brand.hint ? <Muted>{brand.hint}</Muted> : null}
        </View>

        <View style={styles.row}>
          <Field
            label="Host or IP"
            value={values.host}
            onChangeText={(t) => set('host', t)}
            placeholder="192.168.1.20"
            keyboardType="url"
            error={errors.host}
            containerStyle={styles.flex}
          />
          <Field
            label="Port"
            value={values.rtspPort}
            onChangeText={(t) => set('rtspPort', t)}
            keyboardType="number-pad"
            error={errors.rtspPort}
            containerStyle={styles.port}
          />
        </View>

        <View style={styles.row}>
          <Field label="Username" value={values.username} onChangeText={(t) => set('username', t)} placeholder="admin" containerStyle={styles.flex} />
          <Field
            label="Password"
            value={values.password}
            onChangeText={(t) => set('password', t)}
            secureTextEntry
            textContentType="password"
            containerStyle={styles.flex}
          />
        </View>

        <View style={styles.section}>
          <SectionLabel
            right={
              brand.usesChannel ? (
                <View style={styles.channelRow}>
                  <Text style={styles.channelLabel}>Channel</Text>
                  <Field
                    label=""
                    value={values.channel}
                    onChangeText={(t) => set('channel', t)}
                    keyboardType="number-pad"
                    error={errors.channel}
                    containerStyle={styles.channelField}
                    style={styles.channelInput}
                  />
                </View>
              ) : undefined
            }
          >
            Streams
          </SectionLabel>
          <Field
            label="Main stream path"
            value={values.mainPath}
            onChangeText={(t) => {
              setPathsTouched(true);
              set('mainPath', t);
            }}
            mono
            error={errors.mainPath}
            hint={brand.usesChannel ? `{ch} becomes the channel number: ${resolvePathTemplate(values.mainPath, Number(values.channel) || 1)}` : undefined}
          />
          <Field
            label="Sub stream path (used for the grid)"
            value={values.subPath}
            onChangeText={(t) => {
              setPathsTouched(true);
              set('subPath', t);
            }}
            mono
            placeholder="Leave empty to reuse the main stream"
          />
          <View style={styles.preview}>
            <Text style={styles.previewText} selectable>
              {redactUrl(previewUrl)}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel>Paste a full RTSP URL instead</SectionLabel>
          <View style={styles.row}>
            <Field
              label=""
              value={pasteUrl}
              onChangeText={(t) => {
                setPasteUrl(t);
                setPasteError(undefined);
              }}
              placeholder="rtsp://user:pass@host:554/path"
              keyboardType="url"
              mono
              error={pasteError}
              containerStyle={styles.flex}
            />
            <Button title="Apply" variant="secondary" onPress={applyPastedUrl} disabled={pasteUrl.trim() === ''} style={styles.applyButton} />
          </View>
        </View>

        <View style={styles.section}>
          <Button
            title={testing ? 'Stop test' : 'Test stream'}
            variant="secondary"
            icon={testing ? 'stop-circle-outline' : 'play-circle-outline'}
            disabled={!canTest}
            onPress={() => setTesting((t) => !t)}
          />
          <View style={styles.testBox}>
            {testing && reconnect.retryIn === null ? (
              <CameraPlayer
                key={`${previewUrl}#${reconnect.attempt}`}
                uri={previewUrl}
                muted
                contentFit="contain"
                onStatus={reconnect.handleStatus}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <View style={styles.testOverlay} pointerEvents="none">
              {testing ? (
                <>
                  <StatusPill status={reconnect.retryIn !== null ? 'buffering' : reconnect.status} label={reconnect.retryIn !== null ? `Retrying in ${reconnect.retryIn} s` : undefined} />
                  {reconnect.detail ? <Text style={styles.testDetail}>{reconnect.detail}</Text> : null}
                </>
              ) : (
                <Muted center>Preview appears here</Muted>
              )}
            </View>
          </View>
        </View>

        <Button title={submitLabel} loading={saving} onPress={submit} />
        {footer}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl * 2 },
  section: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  port: { width: 96 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  channelLabel: { fontSize: font.small, color: colors.muted },
  channelField: { width: 64, gap: 0 },
  channelInput: { height: 36, textAlign: 'center', paddingHorizontal: 8 },
  preview: { backgroundColor: '#11161D', borderRadius: 10, padding: 10 },
  previewText: { fontFamily: 'Menlo', fontSize: 12, lineHeight: 17, color: colors.muted },
  applyButton: { minHeight: 48, marginTop: 18 },
  testBox: { aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#05070A', overflow: 'hidden' },
  testOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: spacing.md,
    gap: spacing.sm,
  },
  testDetail: { fontSize: font.small, color: colors.text, textAlign: 'center' },
});
