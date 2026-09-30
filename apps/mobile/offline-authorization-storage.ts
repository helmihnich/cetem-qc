import * as SecureStore from "expo-secure-store";
import type { SecureKeyValueStore } from "./offline-authorization-state";

export const expoSecureKeyValueStore: SecureKeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: async (key, value) => { await SecureStore.setItemAsync(key, value); },
  remove: async (key) => { await SecureStore.deleteItemAsync(key); },
};
