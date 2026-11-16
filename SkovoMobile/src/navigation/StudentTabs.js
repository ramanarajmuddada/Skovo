import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, font } from '../theme';
import { studentApi } from '../services/api';

import HomeScreen     from '../screens/student/HomeScreen';
import CohortsScreen  from '../screens/student/CohortsScreen';
import MentorsScreen  from '../screens/student/MentorsScreen';
import BookingsScreen from '../screens/student/BookingsScreen';
import MoreScreen     from '../screens/student/MoreScreen';

const Tab = createBottomTabNavigator();
const ICON = { Home: 'home', Cohorts: 'calendar', Mentors: 'users', Bookings: 'bookmark', More: 'grid' };

export default function StudentTabs() {
  const { colors, gradients, shadow } = useTheme();
  const navigation = useNavigation();

  // DPDP gate: send an un-consented student to the consent flow before the app.
  useEffect(() => {
    studentApi.get('/auth/me')
      .then(({ data: d }) => {
        const cs = d?.response?.consent_status;
        if (cs && cs !== 'granted') navigation.replace('ConsentGate');
      })
      .catch(() => {});
  }, [navigation]);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: font.xs, fontWeight: font.semibold, marginBottom: 2 },
        // Do not pin height — a fixed 64 ate the home-indicator inset on iPhone
        // and clipped the labels. Let React Navigation add the safe-area padding.
        tabBarStyle: {
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 6 : 10,
          borderTopWidth: 1,
          borderTopColor: colors.borderSoft,
          backgroundColor: colors.surface,
          elevation: 12,
          shadowColor: colors.text,
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarIcon: ({ color, size }) => <Feather name={ICON[route.name]} size={size - 1} color={color} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Cohorts" component={CohortsScreen} />
      <Tab.Screen name="Mentors" component={MentorsScreen} />
      <Tab.Screen name="Bookings" component={BookingsScreen} />
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}
