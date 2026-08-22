import { Tabs } from 'expo-router'

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="velocity-lab" options={{ title: 'Velocity Lab', tabBarLabel: 'Velocity Lab' }} />
      <Tabs.Screen name="punchlab" options={{ title: 'PunchLab', tabBarLabel: 'PunchLab' }} />
      <Tabs.Screen name="puncheokie" options={{ title: 'Puncheokie', tabBarLabel: 'Puncheokie' }} />
    </Tabs>
  )
}
