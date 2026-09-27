import { StyleSheet, Text, View } from "react-native";
import { fr } from "@cetem-qc/i18n";

export default function App() {
  return (
    <View style={styles.container}>
      <Text>CETEM-QC</Text>
      <Text>Application mobile prête au développement.</Text>
      <Text>{fr.common.loading}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
});
