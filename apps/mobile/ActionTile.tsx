import { Pressable, Text, View, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
type Icon = ComponentProps<typeof Ionicons>["name"];
function actionIcon(title: string): Icon {
  if (/create account/i.test(title)) return "person-add-outline";
  if (/sign in|play as/i.test(title)) return "log-in-outline";
  if (/close|cancel|sign out/i.test(title)) return "close-outline";
  if (/pause/i.test(title)) return "pause-outline";
  if (/resume|voice/i.test(title)) return "mic-outline";
  if (/listen|replay|preview/i.test(title)) return "volume-high-outline";
  if (/send/i.test(title)) return "send-outline";
  if (/camera|scan|take a photo/i.test(title)) return "camera-outline";
  if (/choose a photo|library/i.test(title)) return "images-outline";
  if (/setting|rename/i.test(title)) return "settings-outline";
  if (/save/i.test(title)) return "checkmark-outline";
  if (/register|new tree/i.test(title)) return "add-outline";
  if (/location|nearby/i.test(title)) return "location-outline";
  if (/refresh/i.test(title)) return "refresh-outline";
  if (/care|water|recovery/i.test(title)) return "water-outline";
  if (/chat/i.test(title)) return "chatbubble-outline";
  if (/history|insight|ask|analy/i.test(title)) return "sparkles-outline";
  return "leaf-outline";
}
export function ActionTile({
  title,
  onPress,
  disabled = false,
  icon,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: Icon;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.tile,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <View style={s.square}>
        <Ionicons name={icon ?? actionIcon(title)} size={29} color="#fff" />
      </View>
      <Text style={s.label}>{title}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  tile: { width: 96, alignItems: "center", gap: 7, marginVertical: 3 },
  square: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: "#365d3d",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: "#244c37",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 16,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
