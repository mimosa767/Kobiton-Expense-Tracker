/**
 * Kobiton Expense Tracker
 *
 * Root application component. Configures navigation and global context providers.
 *
 * Kobiton SDK Integration Points:
 *  - expo-local-authentication  → biometric auth (Face ID / Fingerprint)
 *  - expo-image-picker          → camera / photo-library capture for receipts
 *
 * Both libraries are exercised by Kobiton's device cloud when running
 * automated tests, allowing you to validate biometric and imaging flows
 * across hundreds of real iOS and Android devices.
 */

import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ExpenseProvider } from './src/context/ExpenseContext';
import LoginScreen from './src/screens/LoginScreen';
import ExpenseListScreen from './src/screens/ExpenseListScreen';
import AddExpenseScreen from './src/screens/AddExpenseScreen';

const Stack = createStackNavigator();

// Auth stack shown before the user authenticates
function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}

// Main app stack shown after successful biometric authentication
function AppStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#1a73e8' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Stack.Screen
        name="ExpenseList"
        component={ExpenseListScreen}
        options={{ title: 'My Expenses' }}
      />
      <Stack.Screen
        name="AddExpense"
        component={AddExpenseScreen}
        options={{ title: 'Add Expense' }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ExpenseProvider>
          <NavigationContainer>
            <StatusBar style="light" />
            {isAuthenticated ? (
              <AppStack />
            ) : (
              // Pass setIsAuthenticated so LoginScreen can signal success
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Login">
                  {(props) => (
                    <LoginScreen
                      {...props}
                      onAuthSuccess={() => setIsAuthenticated(true)}
                    />
                  )}
                </Stack.Screen>
              </Stack.Navigator>
            )}
          </NavigationContainer>
        </ExpenseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
