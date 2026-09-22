import * as Clipboard from 'expo-clipboard';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Muted, SectionLabel } from '@/components/ui';
import { getBrand } from '@/lib/brands';
import { notify } from '@/lib/dialogs';
import {
  describeScanFailure,
  entryClipboardText,
  scanHub,
  type ScanCandidate,
  type ScanReport,
} from '@/lib/hubScan';
import { useHubStore } from '@/store/hubStore';
import { colors, font, radius, spacing } from '@/theme';

function CandidateRow({ candidate }: { candidate: ScanCandidate }) {
  const [copied, setCopied] = useState(false);
  const [showEntry, setShowEntry] = useState(false);
  const text = entryClipboardText(candidate);

  const copy = useCallback(async () => {
    if (!text) return;
    let done = false;
    try {
      done = await Clipboard.setStringAsync(text);
    } catch {
      done = false;
    }
    if (done) {
      setCopied(true);
      return;
    }
    // A browser can refuse the clipboard outright; the entry is then shown for copying by hand.
    setShowEntry(true);
    notify('Could not copy', 'The clipboard refused the entry. It is shown below the host so you can select and copy it yourself.');
  }, [text]);

  const ports = candidate.ports.length > 0 ? candidate.ports.join(', ') : 'none reported';

  return (
    <View style={styles.candidate}>
      <View style={styles.rowBetween}>
        <Text style={styles.host} selectable>
          {candidate.host}
        </Text>
        <View style={[styles.badge, candidate.onHub ? styles.badgeOnHub : styles.badgeNew]}>
          <Text style={[styles.badgeText, candidate.onHub ? styles.badgeTextOnHub : styles.badgeTextNew]}>
            {candidate.onHub ? 'On the hub' : 'New'}
          </Text>
        </View>
      </View>
      <Muted>
        {getBrand(candidate.brand).label} · ports {ports}
        {candidate.onHub && candidate.hubCameraId ? ` · served as “${candidate.hubCameraId}”` : ''}
      </Muted>
      {candidate.evidence.map((line, index) => (
        <Text key={`${index}-${line}`} style={styles.evidence} selectable>
          {line}
        </Text>
      ))}
      {!candidate.onHub ? (
        text ? (
          <Button
            title={copied ? 'Copied' : 'Copy entry'}
            variant="secondary"
            icon={copied ? 'checkmark' : 'copy-outline'}
            onPress={() => void copy()}
          />
        ) : (
          <Muted>The hub sent no draft entry for this host.</Muted>
        )
      ) : null}
      {showEntry && text ? (
        <Text style={styles.evidence} selectable>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

function summary(report: ScanReport): string {
  const seconds = (report.durationMs / 1000).toFixed(1);
  const subnets = report.subnets.length > 0 ? report.subnets.join(', ') : 'the configured subnets';
  const count = report.candidates.length;
  return `Scanned ${subnets} in ${seconds} s: ${count} ${count === 1 ? 'device' : 'devices'} found.`;
}

export function ScanNetwork() {
  const baseUrl = useHubStore((state) => state.baseUrl);
  const token = useHubStore((state) => state.token);
  const [scanning, setScanning] = useState(false);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Every scan gets a number; an answer that arrives after a newer scan started is dropped.
  const generation = useRef(0);

  const run = useCallback(async () => {
    const current = ++generation.current;
    setScanning(true);
    setFailure(null);
    const result = await scanHub({ baseUrl, token });
    if (current !== generation.current) return;
    setScanning(false);
    if (result.outcome === 'ok') {
      setReport(result.report);
      return;
    }
    setFailure(describeScanFailure(result));
  }, [baseUrl, token]);

  const fresh = report?.candidates.filter((candidate) => !candidate.onHub).length ?? 0;

  return (
    <Card>
      <SectionLabel>Scan network</SectionLabel>
      <Muted>
        The hub probes its own network for cameras and marks the ones it already serves. New ones come with a draft
        entry for its camera list.
      </Muted>
      <Button title={scanning ? 'Scanning…' : 'Scan network'} icon="search-outline" loading={scanning} onPress={() => void run()} />
      {scanning ? (
        <View style={styles.busy} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.accent} />
          <Muted>The hub is probing every address on its subnets. This takes several seconds, up to a minute.</Muted>
        </View>
      ) : null}
      {failure ? <Text style={styles.error}>{failure}</Text> : null}
      {report && !scanning ? (
        <View style={styles.results}>
          <Muted>{summary(report)}</Muted>
          {report.skipped > 0 ? (
            <Muted>
              {report.skipped} {report.skipped === 1 ? 'result' : 'results'} had no usable address and{' '}
              {report.skipped === 1 ? 'was' : 'were'} left out.
            </Muted>
          ) : null}
          {fresh > 0 ? (
            <Text style={styles.instructions}>
              Copy entry puts a camera definition on the clipboard. Paste it into the cameras list in
              config/cameras.json on the hub and replace every REPLACE_ME with the camera's own username and
              password.
            </Text>
          ) : null}
          {report.candidates.map((candidate) => (
            <CandidateRow key={candidate.host} candidate={candidate} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  results: { gap: spacing.md },
  instructions: { fontSize: font.small, lineHeight: 18, color: colors.text },
  error: { fontSize: font.small, lineHeight: 18, color: colors.danger },
  candidate: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  host: { flexShrink: 1, fontSize: font.heading, fontWeight: '700', color: colors.text },
  evidence: { fontFamily: 'Menlo', fontSize: font.tiny, lineHeight: 16, color: colors.muted },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1 },
  badgeOnHub: { borderColor: colors.live },
  badgeNew: { borderColor: colors.accent, backgroundColor: colors.accent },
  badgeText: { fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  badgeTextOnHub: { color: colors.live },
  badgeTextNew: { color: colors.accentText },
});
