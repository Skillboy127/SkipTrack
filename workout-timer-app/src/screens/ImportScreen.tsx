import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  Image,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { RootStackParamList, ServerUsage } from '../types';
import {
  extractWorkoutFromImage,
  extractWorkoutFromText,
  fetchUsage,
  getLastKnownUsage,
  ImportLimitError,
} from '../api';
import { CloseIcon, InfoIcon, CameraIcon, RotatingDumbbellIcon } from '../components/WorkoutIcons';
import { ConfirmDialog } from '../components/ConfirmDialog';

type Props = NativeStackScreenProps<RootStackParamList, 'Import'>;
type Tab = 'image' | 'text';

const LOADING_MESSAGES: Record<Tab, string[]> = {
  image: ['Scanning the image...', 'Reading exercise names...', 'Extracting sets and reps...', 'Structuring your workout...'],
  text: ['Reading your workout...', 'Identifying exercises...', 'Structuring sets and reps...', 'Almost done...'],
};

const ERROR_TITLES: Record<Tab, string> = {
  image: "Couldn't read that image",
  text: "Couldn't understand that workout",
};

const ERROR_ALT_ACTION: Record<Tab, string | null> = {
  image: 'Or type it in as text instead',
  text: null,
};

type ImportError = { tab: Tab; message: string };

export function ImportScreen({ navigation }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('image');
  const [loading, setLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [importError, setImportError] = useState<ImportError | null>(null);

  // The import allowance lives on the server. Start from the last value we heard
  // (if any) and refresh it each time this screen opens; if that request fails we
  // keep the last known value, or show no counter at all if there isn't one.
  const [usage, setUsage] = useState<ServerUsage | null>(getLastKnownUsage());
  const [limitModalVisible, setLimitModalVisible] = useState(false);
  const isFocused = useIsFocused();

  // An extraction can finish after the user has backed out of this screen; its
  // result is dropped in that case rather than navigating them somewhere unexpected.
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  useEffect(() => {
    if (!isFocused) return;
    fetchUsage()
      .then(fresh => {
        if (!isMountedRef.current) return;
        setUsage(fresh);
        if (fresh.remaining <= 0) setLimitModalVisible(true);
      })
      .catch(() => {});
  }, [isFocused]);

  /** Returns true if the import can proceed; otherwise shows the limit-reached modal. */
  const checkImportAllowed = (): boolean => {
    if (usage !== null && usage.remaining <= 0) {
      setLimitModalVisible(true);
      return false;
    }
    return true;
  };

  // Cycle through contextual status lines while extraction is underway
  useEffect(() => {
    if (!loading) {
      setLoadingMessageIndex(0);
      return;
    }
    const id = setInterval(() => setLoadingMessageIndex(current => current + 1), 1700);
    return () => clearInterval(id);
  }, [loading]);

  // Image tab state
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState('image/jpeg');

  // Text tab state
  const [workoutText, setWorkoutText] = useState('');

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handlePickImage = async () => {
    try {
      // On iOS, check and request permission if needed.
      // On modern Android (API 33+), the system Photo Picker runs in its own process and requires zero permissions.
      if (Platform.OS === 'ios') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Allow access to your photo library to import a workout image.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.6,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setImageUri(asset.uri);
        setImageBase64(asset.base64 ?? null);
        const ext = asset.uri.split('.').pop()?.toLowerCase();
        setImageMime(ext === 'png' ? 'image/png' : 'image/jpeg');
      }
    } catch (e: any) {
      console.log('Error opening photo library:', e);
      Alert.alert('Error', e.message || 'Could not open photo library');
    }
  };

  const handleImageExtract = async () => {
    if (!imageBase64) {
      Alert.alert('No Image', 'Pick a workout image first.');
      return;
    }
    if (!checkImportAllowed()) return;
    setLoading(true);
    setImportError(null);
    try {
      const { workout, usage: updated } = await extractWorkoutFromImage(imageBase64, imageMime);
      if (!isMountedRef.current) return;
      if (updated) setUsage(updated);
      navigation.replace('WorkoutEditor', { draftWorkout: workout });
    } catch (e: any) {
      if (e instanceof ImportLimitError) {
        if (isMountedRef.current) {
          setUsage(e.usage);
          setLimitModalVisible(true);
        }
        return;
      }
      setImportError({ tab: 'image', message: e.message || 'Something went wrong reading that image.' });
    } finally {
      setLoading(false);
    }
  };

  const handleTextExtract = async () => {
    if (!workoutText.trim()) {
      Alert.alert('Error', 'Paste or type a workout description first.');
      return;
    }
    if (!checkImportAllowed()) return;
    setLoading(true);
    setImportError(null);
    try {
      const { workout, usage: updated } = await extractWorkoutFromText(workoutText.trim());
      if (!isMountedRef.current) return;
      if (updated) setUsage(updated);
      navigation.replace('WorkoutEditor', { draftWorkout: workout });
    } catch (e: any) {
      if (e instanceof ImportLimitError) {
        if (isMountedRef.current) {
          setUsage(e.usage);
          setLimitModalVisible(true);
        }
        return;
      }
      setImportError({ tab: 'text', message: e.message || 'Something went wrong reading that workout.' });
    } finally {
      setLoading(false);
    }
  };

  const handleRetryImport = () => {
    if (!importError) return;
    if (importError.tab === 'image') handleImageExtract();
    else handleTextExtract();
  };

  const handleSwitchToTextFromError = () => {
    setImportError(null);
    setActiveTab('text');
  };

  // ─── Tab content ─────────────────────────────────────────────────────────────

  const renderImageTab = () => (
    <View style={styles.imageInputSection}>
      <TouchableOpacity style={styles.imagePicker} onPress={handlePickImage}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.imagePreview} resizeMode="contain" />
        ) : (
          <View style={styles.imagePickerPlaceholder}>
            <View style={styles.cameraCircle}>
              <CameraIcon color="#CCFF00" size={20} />
            </View>
            <Text style={styles.imagePickerHint}>Tap to upload photo</Text>
          </View>
        )}
      </TouchableOpacity>
      <Text style={styles.imageInputHint}>Snap a photo of a workout plan or card</Text>
    </View>
  );

  const renderTextTab = () => (
    <View style={styles.textInputSection}>
      <TextInput
        style={styles.textArea}
        placeholder="Paste your workout plan here..."
        placeholderTextColor="#475569"
        value={workoutText}
        onChangeText={setWorkoutText}
        multiline
        numberOfLines={8}
        textAlignVertical="top"
      />
      <Text style={styles.textInputHint}>Paste exercise names and timing as text</Text>
    </View>
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  const TABS: { id: Tab; label: string; emoji: string }[] = [
    { id: 'image', label: 'Image', emoji: '' },
    { id: 'text',  label: 'Text',  emoji: '' },
  ];

  const processingSource = activeTab === 'image'
    ? 'Workout image'
    : 'Workout description';
  const limitReached = usage !== null && usage.remaining <= 0;
  const resetDate = usage?.resets_at
    ? new Date(usage.resets_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const limitMessage = usage
    ? `You've used all ${usage.limit} imports for this month.${resetDate ? ` Your imports reset on ${resetDate}.` : ''}`
    : "You've used all your imports for this month.";
  const canImportText = workoutText.trim().length > 0 && !limitReached;
  const canImportImage = imageBase64 !== null && !limitReached;
  const activeLoadingMessages = LOADING_MESSAGES[activeTab];
  const loadingMessage = activeLoadingMessages[loadingMessageIndex % activeLoadingMessages.length];

  return (
    <View style={styles.container}>
      <View style={styles.headerAndForm}>
        <View style={styles.statusBarSpacer} />
        <View style={styles.screenHeader}>
          <Text style={styles.screenTitle}>Import Workout</Text>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()} accessibilityLabel="Close import">
            <CloseIcon color="#94A3B8" size={16} />
          </TouchableOpacity>
        </View>

        {usage !== null && (
          <View style={styles.importsRemainingRow}>
            <Text style={[styles.importsRemainingText, limitReached && styles.importsRemainingTextZero]}>
              {limitReached
                ? 'No imports left this month'
                : `${usage.remaining} import${usage.remaining === 1 ? '' : 's'} left this month`}
            </Text>
          </View>
        )}

        <View style={styles.tabBarContainer}>
          <View style={styles.tabBar}>
            {TABS.map(tab => (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tabBtn, activeTab === tab.id && styles.tabBtnActive]}
                onPress={() => {
                  if (loading) return;
                  setImportError(null);
                  setActiveTab(tab.id);
                }}
                disabled={loading}
              >
                <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <RotatingDumbbellIcon color="#CCFF00" size={56} />
            <View style={styles.statusTextBlock}>
              <Text style={styles.loadingTitle}>{loadingMessage}</Text>
              <Text style={styles.loadingSource} numberOfLines={1}>{processingSource}</Text>
            </View>
            <View style={styles.annotationBox}>
              <InfoIcon color="#CCFF00" size={16} />
              <Text style={styles.annotationText}>Flows into Edit Workout screen for review</Text>
            </View>
          </View>
        ) : importError ? (
          <View style={styles.errorContainer}>
            <View style={styles.errorIconCircle}>
              <CloseIcon color="#F87171" size={20} />
            </View>
            <Text style={styles.errorTitle}>{ERROR_TITLES[importError.tab]}</Text>
            <Text style={styles.errorMessage}>{importError.message}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleRetryImport}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
            {ERROR_ALT_ACTION[importError.tab] && (
              <TouchableOpacity onPress={handleSwitchToTextFromError} hitSlop={8}>
                <Text style={styles.errorAltAction}>{ERROR_ALT_ACTION[importError.tab]} →</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.formReferenceContentContainer}
            keyboardShouldPersistTaps="handled"
          >
            {activeTab === 'image' && renderImageTab()}
            {activeTab === 'text'  && renderTextTab()}
          </ScrollView>
        )}
      </View>

      {loading ? (
        <View style={styles.stickyFooter}>
          <View style={styles.processingButton}>
            <Text style={styles.processingLabel}>PROCESSING</Text>
          </View>
        </View>
      ) : importError ? null : activeTab === 'text' ? (
        <View style={styles.stickyFooter}>
          <TouchableOpacity
            style={[styles.importButton, canImportText && styles.importButtonEnabled]}
            onPress={handleTextExtract}
            disabled={!canImportText}
          >
            <Text style={[styles.importLabel, canImportText && styles.importLabelEnabled]}>IMPORT</Text>
          </TouchableOpacity>
        </View>
      ) : activeTab === 'image' ? (
        <View style={styles.stickyFooter}>
          <TouchableOpacity
            style={[styles.importButton, canImportImage && styles.importButtonEnabled]}
            onPress={handleImageExtract}
            disabled={!canImportImage}
          >
            <Text style={[styles.importLabel, canImportImage && styles.importLabelEnabled]}>IMPORT</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <ConfirmDialog
        visible={limitModalVisible}
        title="Import limit reached"
        message={limitMessage}
        onRequestClose={() => setLimitModalVisible(false)}
        actions={[
          { label: 'OK', variant: 'primary', onPress: () => setLimitModalVisible(false) },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090A',
  },
  headerAndForm: {
    flex: 1,
  },
  statusBarSpacer: {
    height: 44,
  },
  screenHeader: {
    height: 48,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  screenTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 31,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1F1F24',
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
  },
  importsRemainingRow: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  importsRemainingText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  importsRemainingTextZero: {
    color: '#F87171',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  textContentContainer: {
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  formReferenceContentContainer: {
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  formScroll: {
    flex: 1,
  },
  // ── Tab bar ────────────────────────────────────────────────────────────────
  tabBarContainer: {
    height: 70,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  tabBar: {
    flexDirection: 'row',
    height: 46,
    padding: 3,
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 12,
    backgroundColor: '#121214',
    opacity: 0.9,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  tabBtnActive: {
    backgroundColor: '#CCFF00',
  },
  tabLabel: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  tabLabelActive: {
    color: '#09090A',
    fontWeight: '700',
  },
  // ── Tab content ────────────────────────────────────────────────────────────
  tabContent: {
    gap: 16,
  },
  tabDescription: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 20,
  },
  // ── Inputs ─────────────────────────────────────────────────────────────────
  input: {
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    backgroundColor: '#121214',
    color: '#FFFFFF',
  },
  textArea: {
    height: 180,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 12,
    backgroundColor: '#121214',
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
  },
  textInputSection: {
    gap: 12,
  },
  textInputHint: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  // ── Image picker ───────────────────────────────────────────────────────────
  imagePicker: {
    height: 180,
    borderWidth: 1,
    borderColor: '#475569',
    borderStyle: 'dashed',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#121214',
    alignSelf: 'stretch',
  },
  imagePickerPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  cameraCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1F1F24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePickerHint: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  imageInputSection: {
    gap: 16,
  },
  imageInputHint: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  imagePreview: {
    width: '100%',
    height: 220,
  },
  // ── Buttons ────────────────────────────────────────────────────────────────
  extractBtn: {
    backgroundColor: '#CCFF00',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  extractBtnText: {
    color: '#09090A',
    fontSize: 16,
    fontWeight: '700',
  },
  extractBtnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#CCFF00',
  },
  extractBtnOutlineText: {
    color: '#CCFF00',
  },
  // ── Loading ────────────────────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    gap: 32,
  },
  statusTextBlock: {
    alignItems: 'center',
    gap: 8,
  },
  loadingTitle: {
    maxWidth: 260,
    color: '#CCFF00',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
    textAlign: 'center',
  },
  loadingSource: {
    maxWidth: 242,
    color: '#94A3B8',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 17,
  },
  annotationBox: {
    width: '100%',
    minHeight: 41,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(204, 255, 0, 0.2)',
    borderRadius: 8,
    backgroundColor: 'rgba(204, 255, 0, 0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  annotationText: {
    flex: 1,
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 17,
  },
  // ── Error ──────────────────────────────────────────────────────────────────
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 40,
    gap: 16,
  },
  errorIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    backgroundColor: 'rgba(248, 113, 113, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorMessage: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    height: 48,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: '#CCFF00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    color: '#09090A',
    fontSize: 15,
    fontWeight: '700',
  },
  errorAltAction: {
    color: '#CCFF00',
    fontSize: 13,
    fontWeight: '600',
  },
  stickyFooter: {
    height: 112,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#1F1F24',
    backgroundColor: '#09090A',
  },
  importButton: {
    height: 54,
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 12,
    backgroundColor: '#121214',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
  importButtonEnabled: {
    borderColor: '#CCFF00',
    backgroundColor: '#CCFF00',
    opacity: 1,
  },
  importLabel: {
    color: '#475569',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
  },
  importLabelEnabled: {
    color: '#09090A',
  },
  processingButton: {
    height: 54,
    borderRadius: 12,
    backgroundColor: '#CCFF00',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  processingLabel: {
    color: '#09090A',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 15,
    textAlign: 'center',
  },
});
