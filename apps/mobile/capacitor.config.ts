import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "dev.sandkasten.mobile",
  appName: "Sandkasten",
  loggingBehavior: "none",
  webDir: "dist",
  server: { cleartext: true },
  android: { allowMixedContent: true },
  plugins: {
    SystemBars: { style: "DARK", insetsHandling: "native", initialViewportFitValueHint: "cover" },
  },
};
export default config;
