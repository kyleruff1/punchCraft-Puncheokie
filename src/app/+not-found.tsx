import { Link, Stack } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

export default function NotFound() {
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Text style={styles.title}>Route not found</Text>
      <Link href="/(tabs)/velocity-lab" asChild>
        <Pressable style={styles.linkButton}>
          <Text style={styles.linkButtonText}>Go to Velocity Lab</Text>
        </Pressable>
      </Link>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 16, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700' },
  linkButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
  },
  linkButtonText: { fontSize: 16, fontWeight: '600' },
})
