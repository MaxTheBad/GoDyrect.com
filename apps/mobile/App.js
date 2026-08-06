import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { supabase } from './src/lib/supabase';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>GoDyrect</Text>
        <Text style={styles.body}>
          Mobile shell is live. Next we can wire in login, listings, and the video editor flow for on-device testing.
        </Text>
        <Text style={styles.meta}>
          Backend: {supabase ? 'Supabase connected' : 'Set Expo env vars to connect'}
        </Text>
      </View>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 24,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0f172a',
  },
  body: {
    fontSize: 16,
    lineHeight: 22,
    color: '#334155',
  },
  meta: {
    fontSize: 13,
    color: '#64748b',
  },
});
