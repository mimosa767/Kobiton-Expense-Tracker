import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/src/components/TopBar';
import { Colors, Radius, Shadow, Spacing, Typography } from '@/src/constants/theme';

interface Step {
  text: string;
  tip?: string;
}

interface Section {
  id: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  title: string;
  subtitle: string;
  steps: Step[];
}

const GUIDE_SECTIONS: Section[] = [
  {
    id: 'login',
    icon: 'lock',
    color: Colors.primary,
    title: 'Signing In',
    subtitle: 'Access the app securely',
    steps: [
      { text: 'Open the app — the login screen appears automatically.' },
      { text: 'Enter your email and password, then tap Sign In.', tip: 'Demo: test@kobiton.com / kobiton123' },
      { text: 'On a real device, tap the fingerprint/face icon to sign in with biometrics.', tip: 'Biometric login requires Face ID or Touch ID to be set up on your device.' },
      { text: 'Once signed in you land on the Expenses screen automatically.' },
    ],
  },
  {
    id: 'expenses',
    icon: 'list',
    color: Colors.categoryBusiness,
    title: 'Expense List',
    subtitle: 'Browse, search, filter and sort',
    steps: [
      { text: 'All your expenses appear as cards. Each card shows the name, amount, currency, category, and date.' },
      { text: 'Use the search bar at the top to filter by name, notes, category, or currency in real time.' },
      { text: 'Tap a category chip (Business, Travel, Meals…) to show only that category. Tap All to reset.', tip: 'You can combine a category filter with a search query.' },
      { text: 'Tap the sort button (top-right of search bar) to cycle the order: Newest → Oldest → Highest → Lowest.' },
      { text: 'Swipe any card to the left to reveal a red Delete button for quick removal.', tip: 'On web, long-press a card for the same delete option.' },
      { text: 'When no filter is active, a dashboard summary appears above the list showing this month\'s totals and category breakdown.' },
    ],
  },
  {
    id: 'add',
    icon: 'plus-circle',
    color: Colors.categoryTravel,
    title: 'Adding an Expense',
    subtitle: 'Record a new expense in seconds',
    steps: [
      { text: 'Tap the blue + button (bottom-right) on the Expenses screen.' },
      { text: 'Choose an Expense Head (e.g. Flight, Hotel, Taxi) from the dropdown.' },
      { text: 'Enter the amount. Use the slider below for quick rough values, or type an exact figure.' },
      { text: 'Select the currency (USD, EUR, GBP, AUD, SGD, JPY, INR).' },
      { text: 'Pick a date using the date picker.' },
      { text: 'Choose a category: Business, Travel, Meals, Office, Software, or Misc.' },
      { text: 'Toggle Recurring Expense on if this expense repeats regularly.' },
      { text: 'Optionally attach a receipt photo — tap the attachment area to take a photo or choose from your library.', tip: 'Receipt images are stored locally on the device.' },
      { text: 'Add any notes in the text area, then tap Save Expense.' },
    ],
  },
  {
    id: 'edit',
    icon: 'edit-2',
    color: Colors.categoryMeals,
    title: 'Editing & Deleting',
    subtitle: 'Update or remove an expense',
    steps: [
      { text: 'Tap any expense card to open its detail screen.' },
      { text: 'The detail screen shows all fields: amount, date, category, currency, recurring flag, notes, and any attached receipt image.' },
      { text: 'Tap Edit to open the edit form, pre-filled with the current values.' },
      { text: 'Make your changes and tap Update Expense to save.', tip: 'Tapping the back arrow while editing will warn you about unsaved changes.' },
      { text: 'To delete, tap Delete on the detail screen. A confirmation bar appears — tap Confirm Delete to permanently remove it, or Cancel to go back.' },
    ],
  },
  {
    id: 'dashboard',
    icon: 'bar-chart-2',
    color: Colors.categoryOffice,
    title: 'Dashboard Summary',
    subtitle: 'Monthly spending at a glance',
    steps: [
      { text: 'The dashboard appears automatically at the top of your expense list when you have expenses and no active filter.' },
      { text: 'It shows: total spending this month (USD-normalised), change vs last month (green = down, red = up), and a category bar chart.' },
      { text: 'The three cards below the chart highlight your top spending categories.' },
      { text: 'Tap the dashboard header to collapse or expand it.', tip: 'The dashboard reflects all expenses, not just filtered results.' },
    ],
  },
  {
    id: 'kobiton-sdk',
    icon: 'cpu',
    color: Colors.primary,
    title: 'Kobiton SDK',
    subtitle: 'Instrument and report test sessions',
    steps: [
      { text: 'Open the ≡ menu and tap Kobiton SDK.' },
      { text: 'Enter your Kobiton API key and tap Initialize SDK. The status changes from idle to ready.' },
      { text: 'Enter a test name and tap Start Session. The status shows ACTIVE with a session ID and start time.' },
      { text: 'Use the instrumentation buttons: Log Action (records a test step), Log Error (flags a failure), Screenshot (captures the current screen), Log Network (logs an HTTP request).' },
      { text: 'Switch to the Events tab to see all logged entries colour-coded by level (info, warn, error).' },
      { text: 'Switch to the Network tab to inspect captured HTTP request/response data.' },
      { text: 'Tap End Session when your test is complete.', tip: 'Running on a device built with EAS Build activates native network capture and crash reporting automatically — no code changes needed.' },
      { text: 'The iOS Build Setup guide at the bottom of the Session tab shows exactly how to configure the Expo plugin for a native build.' },
    ],
  },
  {
    id: 'location',
    icon: 'map-pin',
    color: Colors.accent,
    title: 'Location Mock',
    subtitle: 'Simulate GPS coordinates for testing',
    steps: [
      { text: 'Open ≡ menu → Location Mock.' },
      { text: 'Tap any city preset (New York, London, Tokyo, etc.) to instantly apply those coordinates.' },
      { text: 'Or enter a custom Latitude and Longitude and tap Apply.' },
      { text: 'The MOCKED badge confirms that mock coordinates are active.', tip: 'A side-by-side comparison shows real device GPS vs the mock coordinates.' },
      { text: 'Tap Clear Mock to return to real GPS data.' },
    ],
  },
  {
    id: 'media',
    icon: 'image',
    color: Colors.categoryOffice,
    title: 'Media & QR Scanner',
    subtitle: 'Test camera and media injection',
    steps: [
      { text: 'Open ≡ menu → Media & QR Scanner.' },
      { text: 'Use the Gallery tab to pick or capture images — useful for testing receipt attachment flows.' },
      { text: 'Use the QR Scanner tab to activate the camera and scan QR codes. Scanned data appears below the viewfinder.' },
      { text: 'Injected media can be used to verify that the app handles various image types and sizes correctly.', tip: 'Camera permission is required for QR scanning.' },
    ],
  },
  {
    id: 'audio',
    icon: 'mic',
    color: Colors.categoryMeals,
    title: 'Audio Capture',
    subtitle: 'Record and play back audio for testing',
    steps: [
      { text: 'Open ≡ menu → Audio Capture.' },
      { text: 'Tap the record button to start recording. A live timer shows the duration.' },
      { text: 'Tap Stop to finish the recording.' },
      { text: 'Use the playback controls to review the captured audio.', tip: 'Microphone permission is required. Useful for testing voice-note features in automation suites.' },
    ],
  },
  {
    id: 'metrics',
    icon: 'activity',
    color: Colors.categoryTravel,
    title: 'System Metrics',
    subtitle: 'Monitor device performance in real time',
    steps: [
      { text: 'Open ≡ menu → System Metrics.' },
      { text: 'View live readings for: battery level and charging state, platform and OS version, memory and CPU (where available).' },
      { text: 'Tap Start Stress Test to simulate CPU load — useful for testing app behaviour under resource pressure.' },
      { text: 'Metrics update automatically every second.', tip: 'Use this screen during automated test runs to correlate app slowness with device resource state.' },
    ],
  },
  {
    id: 'debug',
    icon: 'terminal',
    color: Colors.textSecondary,
    title: 'Debug Screen',
    subtitle: 'Developer tools and sample data',
    steps: [
      { text: 'Tap the version label (v1.0.0) at the very bottom of the Expenses screen seven times quickly.' },
      { text: 'The Debug screen opens with developer tools.' },
      { text: 'Tap Load Sample Expenses to fill the app with 7 realistic test entries across all categories.' },
      { text: 'Tap Clear All Expenses to wipe the local data store.' },
      { text: 'The Crash App button triggers an intentional JavaScript error — use it to test crash reporting integration.', tip: 'The same Crash App option is available in the ≡ menu.' },
    ],
  },
  {
    id: 'logout',
    icon: 'log-out',
    color: Colors.error,
    title: 'Logging Out',
    subtitle: 'End your session securely',
    steps: [
      { text: 'Tap the ≡ menu icon (top-left of the Expenses screen).' },
      { text: 'Tap Logout at the bottom of the menu.' },
      { text: 'You are returned to the login screen immediately.', tip: 'All expense data is stored locally and persists across sessions — only the login session is cleared.' },
      { text: 'Attempting to navigate to any protected screen while logged out automatically redirects to login.' },
    ],
  },
];

function GuideCard({ section, isOpen, onToggle }: {
  section: Section;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable style={styles.cardHeader} onPress={onToggle} accessibilityRole="button" testID={`guide-section-${section.id}`}>
        <View style={[styles.iconBox, { backgroundColor: section.color + '18' }]}>
          <Feather name={section.icon} size={20} color={section.color} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.cardTitle}>{section.title}</Text>
          <Text style={styles.cardSubtitle}>{section.subtitle}</Text>
        </View>
        <Feather
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={Colors.textMuted}
        />
      </Pressable>

      {isOpen && (
        <View style={styles.stepsContainer}>
          <View style={[styles.stepDivider, { backgroundColor: section.color + '20' }]} />
          {section.steps.map((step, idx) => (
            <View key={idx} style={styles.step}>
              <View style={[styles.stepNum, { backgroundColor: section.color }]}>
                <Text style={styles.stepNumText}>{idx + 1}</Text>
              </View>
              <View style={styles.stepBody}>
                <Text style={styles.stepText}>{step.text}</Text>
                {step.tip && (
                  <View style={styles.tipBox}>
                    <Feather name="info" size={12} color={Colors.accent} style={{ marginTop: 1 }} />
                    <Text style={styles.tipText}>{step.tip}</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function GuideScreen() {
  const insets = useSafeAreaInsets();
  const [openId, setOpenId] = useState<string | null>('login');
  const [allOpen, setAllOpen] = useState(false);

  const bottomPad = Platform.OS === 'web' ? 24 : insets.bottom;

  function toggleSection(id: string) {
    if (allOpen) {
      setAllOpen(false);
      setOpenId(id);
    } else {
      setOpenId((prev) => (prev === id ? null : id));
    }
  }

  function isOpen(id: string) {
    return allOpen || openId === id;
  }

  function handleExpandAll() {
    setAllOpen(true);
    setOpenId(null);
  }

  function handleCollapseAll() {
    setAllOpen(false);
    setOpenId(null);
  }

  return (
    <View style={styles.root}>
      <TopBar title="Feature Guide" onBackPress={() => router.back()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Feather name="book-open" size={28} color={Colors.white} />
          </View>
          <Text style={styles.heroTitle}>Kobiton Expense Tracker</Text>
          <Text style={styles.heroSubtitle}>
            Complete guide to all features — tap any section to expand.
          </Text>
        </View>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          <TouchableOpacity style={styles.quickBtn} onPress={handleExpandAll} testID="guide-expand-all-btn">
            <Feather name="maximize-2" size={14} color={Colors.primary} />
            <Text style={styles.quickBtnText}>Expand All</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickBtn} onPress={handleCollapseAll} testID="guide-collapse-all-btn">
            <Feather name="minimize-2" size={14} color={Colors.textSecondary} />
            <Text style={[styles.quickBtnText, { color: Colors.textSecondary }]}>Collapse All</Text>
          </TouchableOpacity>
        </View>

        {/* Sections */}
        {GUIDE_SECTIONS.map((section) => (
          <GuideCard
            key={section.id}
            section={section}
            isOpen={isOpen(section.id)}
            onToggle={() => toggleSection(section.id)}
          />
        ))}

        {/* Footer note */}
        <View style={styles.footer}>
          <Feather name="shield" size={14} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            All data is stored locally on your device. Nothing is sent to a server unless you configure the Kobiton SDK with your API key.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  scroll: { flex: 1 },
  content: { padding: Spacing.md, gap: Spacing.md },

  hero: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: 10,
    ...Shadow.card,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.white + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: Typography.sizeLg,
    fontFamily: Typography.fontBold,
    color: Colors.white,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.white + 'CC',
    textAlign: 'center',
    lineHeight: 20,
  },

  quickRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  quickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  quickBtnText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontMedium,
    color: Colors.primary,
  },

  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    ...Shadow.card,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerText: { flex: 1 },
  cardTitle: {
    fontSize: Typography.sizeMd,
    fontFamily: Typography.fontSemiBold,
    color: Colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: Typography.sizeXs,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    marginTop: 1,
  },

  stepDivider: { height: 1 },
  stepsContainer: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },

  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingTop: Spacing.md,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumText: {
    fontSize: 11,
    fontFamily: Typography.fontBold,
    color: Colors.white,
  },
  stepBody: { flex: 1 },
  stepText: {
    fontSize: Typography.sizeSm,
    fontFamily: Typography.fontRegular,
    color: Colors.textPrimary,
    lineHeight: 21,
  },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    backgroundColor: Colors.accent + '10',
    borderRadius: Radius.sm,
    padding: 8,
    marginTop: 6,
  },
  tipText: {
    flex: 1,
    fontSize: Typography.sizeXs,
    fontFamily: Typography.fontRegular,
    color: Colors.textSecondary,
    lineHeight: 17,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    ...Shadow.card,
  },
  footerText: {
    flex: 1,
    fontSize: Typography.sizeXs,
    fontFamily: Typography.fontRegular,
    color: Colors.textMuted,
    lineHeight: 17,
  },
});
