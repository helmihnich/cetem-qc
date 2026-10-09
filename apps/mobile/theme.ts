import type { TextStyle, ViewStyle } from "react-native";

/** CETEM-QC design tokens, shared with the web app's visual language. */
export const colors = {
  navy: "#0B1F3A",
  navy2: "#132E54",
  navyGradientEnd: "#1D3F73",

  primary: "#2F5BEA",
  primaryPressed: "#2449C7",
  primarySoft: "#EAF0FF",
  primaryOnSoft: "#1E3FB8",

  canvas: "#F4F6FA",
  surface: "#FFFFFF",
  surfaceMuted: "#F8FAFC",
  border: "#E3E8EF",
  borderStrong: "#CBD3DF",

  text: "#0F172A",
  textSecondary: "#526077",
  textTertiary: "#8590A2",
  textOnNavy: "#FFFFFF",
  textOnNavyMuted: "rgba(255,255,255,0.72)",

  success: "#12805C",
  successSoft: "#E7F6EF",
  warning: "#B45309",
  warningSoft: "#FEF4E6",
  danger: "#C0362C",
  dangerSoft: "#FDECEA",
  info: "#0B6BCB",
  infoSoft: "#E8F1FC",
  neutral: "#475467",
  neutralSoft: "#EEF1F5",
} as const;

export const gradients = {
  navy: [colors.navy, colors.navyGradientEnd] as const,
  brandMark: ["#3D6BF2", colors.primaryPressed] as const,
};

export const radii = { sm: 10, md: 14, lg: 20, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

export const toneColors: Record<Tone, { fg: string; bg: string; border: string }> = {
  success: { fg: colors.success, bg: colors.successSoft, border: "#BFE6D3" },
  warning: { fg: colors.warning, bg: colors.warningSoft, border: "#F7D9AE" },
  danger: { fg: colors.danger, bg: colors.dangerSoft, border: "#F5C2BD" },
  info: { fg: colors.info, bg: colors.infoSoft, border: "#C3DBF5" },
  neutral: { fg: colors.neutral, bg: colors.neutralSoft, border: colors.border },
  primary: { fg: colors.primaryOnSoft, bg: colors.primarySoft, border: "#C9D7FF" },
};

/** Soft card elevation: iOS shadow and Android elevation. */
export const elevation: ViewStyle = {
  shadowColor: colors.text,
  shadowOpacity: 0.07,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 5 },
  elevation: 2,
};

/** Stronger elevation for the card that overlaps the sign-in hero. */
export const elevationRaised: ViewStyle = {
  shadowColor: colors.text,
  shadowOpacity: 0.12,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 6,
};

export const typography = {
  title: { color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -0.4 },
  sectionTitle: { color: colors.text, fontSize: 17, lineHeight: 23, fontWeight: "600", letterSpacing: -0.1 },
  body: { color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  label: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  overline: { color: colors.textTertiary, fontSize: 11, lineHeight: 14, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
} satisfies Record<string, TextStyle>;

/** Small overline under the sign-in wordmark (mirrors the web shell's brand tagline). */
export const BRAND_TAGLINE = "Contrôle qualité";
