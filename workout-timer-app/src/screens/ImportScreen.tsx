import React, { useState, useEffect } from 'react';
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
import * as Clipboard from 'expo-clipboard';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import {
  extractWorkoutFromVideo,
  extractWorkoutFromImage,
  extractWorkoutFromText,
} from '../api';

type Props = NativeStackScreenProps<RootStackParamList, 'ImportVideo'>;
type Tab = 'video' | 'image' | 'text';

export function ImportScreen({ navigation, route }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('video');
  const [loading, setLoading] = useState(false);

  // Video tab state
  const [url, setUrl] = useState(route.params?.initialUrl ?? '');

  // Pre-fill URL and switch to Video tab when an intent or navigation parameter is received
  useEffect(() => {
    if (route.params?.initialUrl) {
      setUrl(route.params.initialUrl);
      setActiveTab('video');
    }
  }, [route.params?.initialUrl]);

  // Image tab state
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState('image/jpeg');

  // Text tab state
  const [workoutText, setWorkoutText] = useState('');

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleVideoExtract = async () => {
    if (!url.trim()) {
      Alert.alert('Error', 'Please enter a YouTube URL');
      return;
    }
    setLoading(true);
    try {
      const workout = await extractWorkoutFromVideo(url.trim());
      navigation.replace('WorkoutEditor', { draftWorkout: workout });
    } catch (e: any) {
      Alert.alert('Extraction Failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasteUrl = async () => {
    const clipboardText = await Clipboard.getStringAsync();
    if (clipboardText.trim()) {
      setUrl(clipboardText.trim());
    }
  };

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
    setLoading(true);
    try {
      const workout = await extractWorkoutFromImage(imageBase64, imageMime);
      navigation.replace('WorkoutEditor', { draftWorkout: workout });
    } catch (e: any) {
      Alert.alert('Extraction Failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTextExtract = async () => {
    if (!workoutText.trim()) {
      Alert.alert('Error', 'Paste or type a workout description first.');
      return;
    }
    setLoading(true);
    try {
      const workout = await extractWorkoutFromText(workoutText.trim());
      navigation.replace('WorkoutEditor', { draftWorkout: workout });
    } catch (e: any) {
      Alert.alert('Extraction Failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Tab content ─────────────────────────────────────────────────────────────

  const renderVideoTab = () => (
    <View style={styles.videoInputSection}>
      <View style={styles.videoUrlInput}>
        <View style={styles.videoInputLeft}>
          <Text style={styles.youtubeGlyph}>▹</Text>
          <TextInput
            style={styles.videoUrlTextInput}
            placeholder="Paste YouTube URL"
            placeholderTextColor="#475569"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            numberOfLines={1}
          />
        </View>
        <TouchableOpacity style={styles.pasteButton} onPress={handlePasteUrl} accessibilityLabel="Paste YouTube URL">
          <Text style={styles.pasteLabel}>PASTE</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.videoInputHint}>We'll pull exercise names, timing, and rest from the video</Text>
    </View>
  );

  const renderImageTab = () => (
    <View style={styles.imageInputSection}>
      <TouchableOpacity style={styles.imagePicker} onPress={handlePickImage}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.imagePreview} resizeMode="contain" />
        ) : (
          <View style={styles.imagePickerPlaceholder}>
            <View style={styles.cameraCircle}>
              <Text style={styles.cameraGlyph}>▣</Text>
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
    { id: 'video', label: 'Video', emoji: '' },
    { id: 'image', label: 'Image', emoji: '' },
    { id: 'text',  label: 'Text',  emoji: '' },
  ];

  const processingSource = activeTab === 'video'
    ? url.trim() || 'youtube.com/watch'
    : activeTab === 'image'
      ? 'Workout image'
      : 'Workout description';
  const canImportText = workoutText.trim().length > 0;
  const canImportImage = imageBase64 !== null;
  const canImportVideo = url.trim().length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.headerAndForm}>
        <View style={styles.statusBarSpacer} />
        <View style={styles.screenHeader}>
          <Text style={styles.screenTitle}>Import Workout</Text>
          <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()} accessibilityLabel="Close import">
            <Text style={styles.closeLabel}>×</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabBarContainer}>
          <View style={styles.tabBar}>
            {TABS.map(tab => (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tabBtn, activeTab === tab.id && styles.tabBtnActive]}
                onPress={() => !loading && setActiveTab(tab.id)}
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
            <View style={styles.spinnerWrapper}>
              <View style={styles.spinnerBackground} />
              <View style={styles.spinnerActive} />
              <Text style={styles.spinnerGlyph}>▦</Text>
            </View>
            <View style={styles.statusTextBlock}>
              <Text style={styles.loadingTitle}>Analyzing...</Text>
              <Text style={styles.loadingSource} numberOfLines={1}>{processingSource}</Text>
            </View>
            <View style={styles.annotationBox}>
              <Text style={styles.infoGlyph}>ⓘ</Text>
              <Text style={styles.annotationText}>Flows into Edit Workout screen for review</Text>
            </View>
          </View>
        ) : (
          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.formReferenceContentContainer}
            keyboardShouldPersistTaps="handled"
          >
            {activeTab === 'video' && renderVideoTab()}
            {activeTab === 'image' && renderImageTab()}
            {activeTab === 'text'  && renderTextTab()}
          </ScrollView>
        )}
      </View>

      {loading ? (
        <View style={styles.stickyFooter}>
          <View style={styles.processingButton}>
            <Text style={styles.processingGlyph}>✣</Text>
            <Text style={styles.processingLabel}>PROCESSING</Text>
          </View>
        </View>
      ) : activeTab === 'text' ? (
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
      ) : activeTab === 'video' ? (
        <View style={styles.stickyFooter}>
          <TouchableOpacity
            style={[styles.importButton, canImportVideo && styles.importButtonEnabled]}
            onPress={handleVideoExtract}
            disabled={!canImportVideo}
          >
            <Text style={[styles.importLabel, canImportVideo && styles.importLabelEnabled]}>IMPORT</Text>
          </TouchableOpacity>
        </View>
      ) : null}
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
  closeLabel: {
    color: '#94A3B8',
    fontSize: 24,
    fontWeight: '400',
    lineHeight: 26,
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
  videoInputSection: {
    gap: 16,
  },
  videoUrlInput: {
    height: 56,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F1F24',
    borderRadius: 12,
    backgroundColor: '#121214',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  videoInputLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  youtubeGlyph: {
    color: '#475569',
    fontSize: 20,
    fontWeight: '700',
  },
  videoUrlTextInput: {
    flex: 1,
    padding: 0,
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
  },
  pasteButton: {
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#1F1F24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pasteLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  videoInputHint: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
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
  cameraGlyph: {
    color: '#CCFF00',
    fontSize: 20,
    fontWeight: '700',
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
  spinnerWrapper: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerBackground: {
    ...StyleSheet.absoluteFill,
    margin: 15,
    borderWidth: 4,
    borderColor: '#1F1F24',
    borderRadius: 45,
  },
  spinnerActive: {
    ...StyleSheet.absoluteFill,
    margin: 15,
    borderWidth: 4,
    borderColor: '#CCFF00',
    borderLeftColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRadius: 45,
    transform: [{ rotate: '-30deg' }],
  },
  spinnerGlyph: {
    color: '#CCFF00',
    fontSize: 24,
    fontWeight: '700',
  },
  statusTextBlock: {
    alignItems: 'center',
    gap: 8,
  },
  loadingTitle: {
    color: '#CCFF00',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
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
  infoGlyph: {
    color: '#CCFF00',
    fontSize: 16,
  },
  annotationText: {
    flex: 1,
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 17,
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
  processingGlyph: {
    color: '#09090A',
    fontSize: 20,
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
