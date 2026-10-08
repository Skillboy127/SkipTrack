import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Updates from 'expo-updates';
import mobileAds from 'react-native-google-mobile-ads';
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
import { loadHasSeenOnboarding, loadAdFreeStatus } from './src/storage';
import { RotatingDumbbellIcon } from './src/components/WorkoutIcons';

const Stack = createNativeStackNavigator<RootStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const styles = StyleSheet.create({
  launch: {
    flex: 1,
    backgroundColor: '#0B0B0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function App() {
  // Decided before the navigator mounts so a returning user never sees the
  // onboarding flash, and a first-time user lands on it instead of Library.
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    loadHasSeenOnboarding().then(setHasSeenOnboarding);
  }, []);

  useEffect(() => {
    loadAdFreeStatus().then(adsRemoved => console.log('[AdMob] adsRemoved =', adsRemoved));
  }, []);

  // Required once at startup before any BannerAd can load.
  useEffect(() => {
    mobileAds()
      .initialize()
      .catch(error => console.warn('Mobile Ads SDK failed to initialize:', error));
  }, []);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    let cancelled = false;

    const checkForUpdates = async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (!update.isAvailable || cancelled) return;

        const fetchedUpdate = await Updates.fetchUpdateAsync();
        if (fetchedUpdate.isNew && !cancelled) {
          await Updates.reloadAsync();
        }
      } catch (error) {
        console.warn('OTA update check failed:', error);
      }
    };

    void checkForUpdates();

    return () => {
      cancelled = true;
    };
  }, []);

  if (hasSeenOnboarding === null) {
    return (
      <View style={styles.launch}>
        <RotatingDumbbellIcon color="#CCFF00" size={56} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator initialRouteName={hasSeenOnboarding ? 'Library' : 'Onboarding'}>
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
            options={{ headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen
            name="Library"
            component={LibraryScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="WorkoutEditor"
            component={WorkoutEditorScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Import"
            component={ImportScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen 
            name="WorkoutPreview" 
            component={WorkoutPreviewScreen} 
            options={{ headerShown: false }} 
          />
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
          <Stack.Screen
            name="History"
            component={HistoryScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
