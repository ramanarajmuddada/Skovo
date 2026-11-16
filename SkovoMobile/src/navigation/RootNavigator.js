import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme';

// The mobile app is STUDENT ONLY. Achievers run cohorts, upload verification
// documents and manage earnings — work that belongs on a real screen, and the
// mobile achiever portal only ever had 7 of the web's 11 screens. Rather than
// ship a portal that silently lacks verification and cohort management, an
// achiever signing in is told where their portal is (see LoginScreen).
//
// One sign-in still resolves the account from the email rather than asking —
// RoleSelect/StudentLogin/AchieverLogin are retired.
import LandingScreen from '../screens/auth/LandingScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import StudentNavigator from './StudentNavigator';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { colors, gradients, shadow } = useTheme();
  const { booting, portal } = useAuth();

  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      {portal === 'student' ? (
        <Stack.Screen name="StudentApp" component={StudentNavigator} />
      ) : (
        <>
          <Stack.Screen name="Landing" component={LandingScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
