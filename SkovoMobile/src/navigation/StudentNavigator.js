import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { studentApi } from '../services/api';
import { useTheme, useThemedStyles } from '../theme';
import OnboardingScreen from '../screens/student/OnboardingScreen';
import StudentTabs from './StudentTabs';
import CohortDetailScreen from '../screens/student/CohortDetailScreen';
import MentorBookingScreen from '../screens/student/MentorBookingScreen';
import CoursesScreen from '../screens/student/CoursesScreen';
import CourseDetailScreen from '../screens/student/CourseDetailScreen';
import SkovoProScreen from '../screens/student/SkovoProScreen';
import ReferralsScreen from '../screens/student/ReferralsScreen';
import ProfileScreen from '../screens/student/ProfileScreen';
import CollegesScreen from '../screens/student/CollegesScreen';
import OpportunitiesScreen from '../screens/student/OpportunitiesScreen';
import LeaderboardScreen from '../screens/student/LeaderboardScreen';
import StreakScreen from '../screens/student/StreakScreen';
import PracticeScreen from '../screens/student/PracticeScreen';
import WalletScreen from '../screens/student/WalletScreen';
import MarketScreen from '../screens/student/MarketScreen';
import DocumentVaultScreen from '../screens/student/DocumentVaultScreen';
import MyScoreScreen from '../screens/student/MyScoreScreen';
import ApplicationsScreen from '../screens/student/ApplicationsScreen';
import SavedCollegesScreen from '../screens/student/SavedCollegesScreen';
import CollegePredictorScreen from '../screens/student/CollegePredictorScreen';
import BhaAIScreen from '../screens/student/BhaAIScreen';
import EducationGoalsScreen from '../screens/student/EducationGoalsScreen';
import AssembleScreen from '../screens/student/AssembleScreen';
import MessagesScreen from '../screens/student/MessagesScreen';
import ConsentGateScreen from '../screens/student/ConsentGateScreen';
import AssessmentScreen from '../screens/student/AssessmentScreen';
import TasksScreen from '../screens/student/TasksScreen';
import NotificationsScreen from '../screens/student/NotificationsScreen';
import HelpSupportScreen from '../screens/student/HelpSupportScreen';

const Stack = createNativeStackNavigator();

export default function StudentNavigator() {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Two gates before the app opens, checked together so there is no flash of
  // the wrong screen: DPDP consent, and whether we know what the student is
  // studying. Mobile previously had neither — a signup here landed with
  // education_level = NULL, which silently degraded cohorts, colleges,
  // opportunities and mentors, since every one of them targets on it.
  const [gate, setGate] = useState(null);   // null = still checking

  const check = useCallback(() => {
    Promise.all([
      studentApi.get('/auth/me').catch(() => ({ data: {} })),
      studentApi.get('/profile/').catch(() => ({ data: {} })),
    ]).then(([me, profile]) => {
      setGate({
        consent: me.data?.response?.consent_status || 'granted',
        hasProfile: Boolean(profile.data?.response?.profile?.education_level),
      });
    }).catch(() => setGate({ consent: 'granted', hasProfile: true }));  // fail open
  }, []);

  useEffect(() => { check(); }, [check]);

  if (gate === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (gate.consent !== 'granted' || !gate.hasProfile) {
    return (
      <OnboardingScreen
        consentStatus={gate.consent}
        onDone={() => setGate({ consent: 'granted', hasProfile: true })}
      />
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="Tabs" component={StudentTabs} />
      <Stack.Screen name="CohortDetail" component={CohortDetailScreen} />
      <Stack.Screen name="MentorBooking" component={MentorBookingScreen} />
      <Stack.Screen name="Courses" component={CoursesScreen} />
      <Stack.Screen name="CourseDetail" component={CourseDetailScreen} />
      <Stack.Screen name="SkovoPro" component={SkovoProScreen} />
      <Stack.Screen name="Referrals" component={ReferralsScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="Colleges" component={CollegesScreen} />
      <Stack.Screen name="Opportunities" component={OpportunitiesScreen} />
      <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
      <Stack.Screen name="Streak" component={StreakScreen} />
      <Stack.Screen name="Practice" component={PracticeScreen} />
      <Stack.Screen name="Wallet" component={WalletScreen} />
      <Stack.Screen name="Market" component={MarketScreen} />
      <Stack.Screen name="DocumentVault" component={DocumentVaultScreen} />
      <Stack.Screen name="MyScore" component={MyScoreScreen} />
      <Stack.Screen name="Applications" component={ApplicationsScreen} />
      <Stack.Screen name="CollegePredictor" component={CollegePredictorScreen} options={{ title: 'College Predictor' }} />
      <Stack.Screen name="BhaAI" component={BhaAIScreen} options={{ title: 'BhaAI' }} />
      <Stack.Screen name="EducationGoals" component={EducationGoalsScreen} options={{ title: 'Education & Goals' }} />
      <Stack.Screen name="SavedColleges" component={SavedCollegesScreen} />
      <Stack.Screen name="Assemble" component={AssembleScreen} />
      <Stack.Screen name="Messages" component={MessagesScreen} />
      <Stack.Screen name="ConsentGate" component={ConsentGateScreen} />
      {/* The v1 screens mobile was missing: the assessment that seeds a score,
          the tasks that carry the most points, and the notifications that bring
          a student back. */}
      <Stack.Screen name="Assessment" component={AssessmentScreen} />
      <Stack.Screen name="Tasks" component={TasksScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="HelpSupport" component={HelpSupportScreen} />
    </Stack.Navigator>
  );
}

const makeStyles = (colors, shadow) => ({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
