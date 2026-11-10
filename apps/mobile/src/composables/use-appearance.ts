import { readonly, ref } from "vue";
import { Capacitor, registerPlugin } from "@capacitor/core";

const nativeAppearance = registerPlugin<{
  get(): Promise<{ theme: string | null }>;
  set(options: { theme: string }): Promise<void>;
}>("Appearance");

export type ThemeId = "coral" | "rose" | "sea" | "forest" | "indigo" | "amber";

interface AppearanceTokens {
  background: string;
  surface: string;
  surfaceRaised: string;
  primary: string;
  onPrimary: string;
  text: string;
  muted: string;
  line: string;
  secondary: string;
  tertiary: string;
}

export interface AppearanceTheme {
  id: ThemeId;
  name: string;
  swatches: readonly [string, string, string];
  tokens: Readonly<AppearanceTokens>;
}

export const THEMES: readonly AppearanceTheme[] = [
  {
    id: "coral",
    name: "珊瑚",
    swatches: ["#d86b39", "#3b6b68", "#786115"],
    tokens: {
      background: "#1b110e",
      surface: "#2b1c17",
      surfaceRaised: "#39261e",
      primary: "#ffb79a",
      onPrimary: "#46271b",
      text: "#f4e0d7",
      muted: "#b8a297",
      line: "#61473b",
      secondary: "#9ccac5",
      tertiary: "#dfc175",
    },
  },
  {
    id: "rose",
    name: "玫瑰",
    swatches: ["#a53d69", "#79536a", "#85621a"],
    tokens: {
      background: "#1a1117",
      surface: "#2b1a24",
      surfaceRaised: "#3c2732",
      primary: "#f2a9c3",
      onPrimary: "#44192d",
      text: "#f4dfe8",
      muted: "#bca0ae",
      line: "#604251",
      secondary: "#c5afc1",
      tertiary: "#e2c47c",
    },
  },
  {
    id: "sea",
    name: "海盐",
    swatches: ["#008080", "#406c7e", "#626414"],
    tokens: {
      background: "#0e181a",
      surface: "#17282b",
      surfaceRaised: "#21383c",
      primary: "#8edbd8",
      onPrimary: "#103a3b",
      text: "#dceeed",
      muted: "#9fb7b8",
      line: "#405f63",
      secondary: "#a6c9df",
      tertiary: "#d7d57c",
    },
  },
  {
    id: "forest",
    name: "森林",
    swatches: ["#42723d", "#526f61", "#806114"],
    tokens: {
      background: "#111811",
      surface: "#1d2a1e",
      surfaceRaised: "#2b3b2b",
      primary: "#aad59b",
      onPrimary: "#233e1d",
      text: "#e2ecdc",
      muted: "#a8b6a0",
      line: "#4e6148",
      secondary: "#adcabb",
      tertiary: "#dfc47b",
    },
  },
  {
    id: "indigo",
    name: "靛蓝",
    swatches: ["#4c61b3", "#685d87", "#007c80"],
    tokens: {
      background: "#12131e",
      surface: "#1e2133",
      surfaceRaised: "#2c3047",
      primary: "#b5beff",
      onPrimary: "#282c59",
      text: "#e5e5f5",
      muted: "#aaaac2",
      line: "#505571",
      secondary: "#c8b9e3",
      tertiary: "#91d3cf",
    },
  },
  {
    id: "amber",
    name: "琥珀",
    swatches: ["#956500", "#80683a", "#536e70"],
    tokens: {
      background: "#1b160c",
      surface: "#2d2415",
      surfaceRaised: "#3e321e",
      primary: "#efc577",
      onPrimary: "#443111",
      text: "#f1e6d0",
      muted: "#bcad91",
      line: "#675538",
      secondary: "#cfbd91",
      tertiary: "#a6c6c5",
    },
  },
];

const STORAGE_KEY = "sandkasten.theme";
const defaultTheme = THEMES[0]!;

function savedTheme(): AppearanceTheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.find((entry) => entry.id === saved) ?? defaultTheme;
  } catch {
    return defaultTheme;
  }
}

function applyTheme(selected: AppearanceTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const tokens = selected.tokens;
  const properties: Record<string, string> = {
    "--bg": tokens.background,
    "--surface": tokens.surface,
    "--raised": tokens.surfaceRaised,
    "--primary": tokens.primary,
    "--on-primary": tokens.onPrimary,
    "--text": tokens.text,
    "--muted": tokens.muted,
    "--line": tokens.line,
    "--secondary": tokens.secondary,
    "--tertiary": tokens.tertiary,
  };
  for (const [property, value] of Object.entries(properties)) {
    root.style.setProperty(property, value);
  }
  root.style.setProperty("color-scheme", "dark");
  root.setAttribute("data-theme", selected.id);
  document.querySelector?.('meta[name="theme-color"]')?.setAttribute("content", tokens.background);
}

function cacheTheme(selected: AppearanceTheme) {
  try {
    localStorage.setItem(STORAGE_KEY, selected.id);
  } catch {
    // Android restores from native preferences; browser selection still works.
  }
}

export function useAppearance() {
  const native = Capacitor.isNativePlatform();
  const initial = savedTheme();
  const theme = ref<ThemeId>(initial.id);
  const ready = ref(!native);
  const error = ref("");
  let selectionVersion = 0;
  applyTheme(initial);

  function markReady(value: boolean) {
    ready.value = value;
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-appearance-ready", String(value));
    }
  }
  markReady(!native);

  async function initialize() {
    if (!native) return;
    try {
      const saved = await nativeAppearance.get();
      if (selectionVersion !== 0) return;
      const restored = THEMES.find((entry) => entry.id === saved.theme);
      const selected = restored ?? initial;
      // A WebView localStorage write may not survive immediate process death.
      // Native preferences are authoritative once a theme has been committed.
      if (!restored) await nativeAppearance.set({ theme: selected.id });
      if (selectionVersion !== 0) return;
      theme.value = selected.id;
      applyTheme(selected);
      cacheTheme(selected);
      markReady(true);
    } catch {
      if (selectionVersion === 0) error.value = "无法读取已保存的主题，请重新选择";
    }
  }
  const initialized = initialize();
  let writes = initialized;

  function setTheme(id: string): Promise<void> {
    const selected = THEMES.find((entry) => entry.id === id);
    if (!selected) return Promise.resolve();
    const version = ++selectionVersion;
    theme.value = selected.id;
    applyTheme(selected);
    cacheTheme(selected);
    error.value = "";
    markReady(!native);
    if (!native) return Promise.resolve();

    // Serialize durable writes so an earlier selection cannot overwrite a later
    // one. Readiness describes the latest selection, never an older completion.
    writes = writes.then(async () => {
      try {
        await nativeAppearance.set({ theme: selected.id });
        if (version === selectionVersion) markReady(true);
      } catch {
        if (version === selectionVersion) error.value = "主题未能保存，请重新选择";
      }
    });
    return writes;
  }

  return { theme: readonly(theme), themes: THEMES, ready: readonly(ready), error: readonly(error), initialized, setTheme };
}
