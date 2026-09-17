import { Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';

import { useCameraStore } from '@/store/cameraStore';
import { colors } from '@/theme';

export default function RootLayout() {
  const hydrated = useCameraStore((state) => state.hydrated);
  const hydrate = useCameraStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
  }, [hydrate]);

  if (!hydrated) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.link,
          headerTitleStyle: { color: colors.text, fontWeight: '600' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="add/index" options={{ title: 'Add camera' }} />
        <Stack.Screen name="add/manual" options={{ title: 'Add manually' }} />
        <Stack.Screen name="add/discover" options={{ title: 'Find cameras' }} />
        <Stack.Screen name="camera/[id]/index" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="camera/[id]/edit" options={{ title: 'Edit camera' }} />
      </Stack>
    </>
  );
}
