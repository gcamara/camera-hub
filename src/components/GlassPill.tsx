import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

interface GlassPillProps {
  children?: ReactNode;
  label?: string;
  dot?: string;
  /** Solid fill instead of glass; use for warnings that must stay legible over bright video. */
  solid?: string;
  textColor?: string;
  style?: StyleProp<ViewStyle>;
}

/** Frosted pill for text over video: LIVE badges, camera names in the viewer, reconnect notices. */
export function GlassPill({ children, label, dot, solid, textColor = '#FFFFFF', style }: GlassPillProps) {
  const content = (
    <View style={styles.row}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      {label ? <Text style={[styles.label, { color: textColor }]}>{label}</Text> : null}
      {children}
    </View>
  );
  if (solid) {
    return <View style={[styles.pill, { backgroundColor: solid }, style]}>{content}</View>;
  }
  return (
    <BlurView intensity={40} tint="dark" style={[styles.pill, styles.glass, style]}>
      {content}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  pill: { height: 28, paddingHorizontal: 10, borderRadius: 14, overflow: 'hidden', justifyContent: 'center' },
  glass: { backgroundColor: colors.overlay, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.glassBorder },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
});
