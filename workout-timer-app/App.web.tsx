// The web version's root (App.tsx is the Android app's). The same screens, fonts and
// navigation, minus everything that needs the phone or the Flex server: no ads, no
// billing, no server calls, no update checks. Workouts and settings are kept in this
// browser (AsyncStorage is localStorage on web).
import React, { useEffect, useState } from 'react';
import { Alert, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFonts } from 'expo-font';
import { Anton_400Regular } from '@expo-google-fonts/anton';
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
} from '@expo-google-fonts/archivo';
import { RootStackParamList } from './src/types';

import { LibraryScreen } from './src/screens/LibraryScreen';
import { WorkoutEditorScreen } from './src/screens/WorkoutEditorScreen';
import { ImportScreen } from './src/screens/ImportScreen';
import { WorkoutPreviewScreen } from './src/screens/WorkoutPreviewScreen';
import { ActiveSessionScreen } from './src/screens/ActiveSessionScreen';
import { CompletionScreen } from './src/screens/CompletionScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { loadHasSeenOnboarding } from './src/storage';
import { RotatingDumbbellIcon } from './src/components/WorkoutIcons';
import { initWebAudio } from './src/web/audioEngine';
import { WebOverlays } from './src/web/WebOverlays';
import { colors } from './src/theme';

type AlertButton = { text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };

// react-native-web's Alert.alert does nothing; the shared screens use it for things
// like "Workout name needed", so show them with the browser's own dialogs.
Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
  const text = [title, message].filter(Boolean).join('\n\n');
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    buttons?.[0]?.onPress?.();
    return;
  }
  const cancel = buttons.find(b => b.style === 'cancel');
  const confirm = [...buttons].reverse().find(b => b.style !== 'cancel');
  if (window.confirm(text)) confirm?.onPress?.();
  else cancel?.onPress?.();
};

// Create the audio context now; the first tap anywhere unlocks it (see web/audioEngine.ts).
initWebAudio();

const Stack = createNativeStackNavigator<RootStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const styles = StyleSheet.create({
  launch: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function App() {
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
  });

  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    loadHasSeenOnboarding().then(setHasSeenOnboarding);
  }, []);

  const [routeName, setRouteName] = useState<string | undefined>(undefined);

  if (hasSeenOnboarding === null || !fontsLoaded) {
    return (
      <View style={styles.launch}>
        <RotatingDumbbellIcon color={colors.ink} size={56} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <NavigationContainer
        ref={navigationRef}
        documentTitle={{ formatter: () => 'Flex' }}
        onReady={() => setRouteName(navigationRef.getCurrentRoute()?.name)}
        onStateChange={() => setRouteName(navigationRef.getCurrentRoute()?.name)}
      >
        <Stack.Navigator initialRouteName={hasSeenOnboarding ? 'Library' : 'Onboarding'}>
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
            options={{ headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen name="Library" component={LibraryScreen} options={{ headerShown: false }} />
          <Stack.Screen name="WorkoutEditor" component={WorkoutEditorScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Import" component={ImportScreen} options={{ headerShown: false }} />
          <Stack.Screen name="WorkoutPreview" component={WorkoutPreviewScreen} options={{ headerShown: false }} />
          <Stack.Screen
            name="ActiveSession"
            component={ActiveSessionScreen}
            options={{ headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen
            name="Completion"
            component={CompletionScreen}
            options={{ headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen name="History" component={HistoryScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
      <WebOverlays onLibrary={routeName === 'Library'} />
    </SafeAreaProvider>
  );
}
