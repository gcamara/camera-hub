import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Muted } from '@/components/ui';
import { colors, font, spacing } from '@/theme';

interface OptionProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  href: Href;
  primary?: boolean;
}

function Option({ icon, title, body, href, primary = false }: OptionProps) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.option, primary ? styles.optionPrimary : styles.optionSecondary, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name={icon} size={26} color={primary ? colors.accentText : colors.text} />
      <View style={styles.optionText}>
        <Text style={[styles.optionTitle, primary && { color: colors.accentText }]}>{title}</Text>
        <Text style={[styles.optionBody, primary && { color: colors.accentText }]}>{body}</Text>
      </View>
    </Pressable>
  );
}

export default function AddCameraScreen() {
  return (
    <View style={styles.screen}>
      <Option
        primary
        icon="search"
        title="Find cameras on my network"
        body="Scans your Wi‑Fi for ONVIF devices and reads their stream addresses."
        href="/add/discover"
      />
      <Option
        icon="create-outline"
        title="Add manually"
        body="Brand presets for Hikvision, Dahua, Reolink, Tapo and more, or paste an RTSP URL."
        href="/add/manual"
      />
      <Muted>Cloud-only cameras (Ring, Nest, Arlo, Blink) do not expose a local stream and cannot be added.</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: spacing.lg, borderRadius: 14 },
  optionPrimary: { backgroundColor: colors.accent },
  optionSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: font.heading, fontWeight: '600', color: colors.text },
  optionBody: { fontSize: font.small, lineHeight: 18, color: colors.muted },
});
