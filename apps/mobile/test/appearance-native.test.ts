import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  get: vi.fn<() => Promise<{ theme: string | null }>>(),
  set: vi.fn<(options: { theme: string }) => Promise<void>>(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => native,
}));

import { useAppearance } from "../src/composables/use-appearance";

let stored: Map<string, string>;
let colors: Map<string, string>;
let attributes: Map<string, string>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  native.get.mockReset().mockResolvedValue({ theme: "coral" });
  native.set.mockReset().mockResolvedValue(undefined);
  stored = new Map(); colors = new Map(); attributes = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.stubGlobal("document", {
    documentElement: {
      style: { setProperty: (key: string, value: string) => colors.set(key, value) },
      setAttribute: (key: string, value: string) => attributes.set(key, value),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

it("restores the native preference before permitting stale Web storage to overwrite it", async () => {
  stored.set("sandkasten.theme", "amber");
  const read = deferred<{ theme: string | null }>();
  native.get.mockReturnValueOnce(read.promise);
  const appearance = useAppearance();

  expect(appearance.theme.value).toBe("amber");
  expect(appearance.ready.value).toBe(false);
  expect(attributes.get("data-appearance-ready")).toBe("false");
  expect(native.set).not.toHaveBeenCalled();
  read.resolve({ theme: "coral" });
  await appearance.initialized;

  expect(appearance.theme.value).toBe("coral");
  expect(stored.get("sandkasten.theme")).toBe("coral");
  expect(colors.get("--bg")).toBe("#1b110e");
  expect(appearance.ready.value).toBe(true);
  expect(attributes.get("data-appearance-ready")).toBe("true");
  expect(native.set).not.toHaveBeenCalled();
});

it("migrates an existing Web preference only when native storage has no saved theme", async () => {
  stored.set("sandkasten.theme", "sea");
  native.get.mockResolvedValueOnce({ theme: null });
  const commit = deferred<void>();
  native.set.mockReturnValueOnce(commit.promise);
  const appearance = useAppearance();

  await vi.waitFor(() => expect(native.set).toHaveBeenCalledWith({ theme: "sea" }));
  expect(appearance.ready.value).toBe(false);
  expect(attributes.get("data-appearance-ready")).toBe("false");
  commit.resolve();
  await appearance.initialized;

  expect(appearance.theme.value).toBe("sea");
  expect(appearance.ready.value).toBe(true);
});

it("reports selection as saved only after the native commit acknowledges it", async () => {
  const appearance = useAppearance();
  await appearance.initialized;
  const commit = deferred<void>();
  native.set.mockReturnValueOnce(commit.promise);
  const saving = appearance.setTheme("sea");

  expect(appearance.theme.value).toBe("sea");
  expect(attributes.get("data-theme")).toBe("sea");
  expect(stored.get("sandkasten.theme")).toBe("sea");
  expect(appearance.ready.value).toBe(false);
  expect(attributes.get("data-appearance-ready")).toBe("false");
  await vi.waitFor(() => expect(native.set).toHaveBeenCalledWith({ theme: "sea" }));
  commit.resolve();
  await saving;

  expect(appearance.ready.value).toBe(true);
  expect(appearance.error.value).toBe("");
  expect(attributes.get("data-appearance-ready")).toBe("true");
});

it("serializes rapid selections without marking the newest theme saved after an older commit", async () => {
  const appearance = useAppearance();
  await appearance.initialized;
  const first = deferred<void>(), second = deferred<void>();
  native.set.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const savingFirst = appearance.setTheme("rose");
  const savingSecond = appearance.setTheme("forest");

  await vi.waitFor(() => expect(native.set).toHaveBeenCalledTimes(1));
  expect(native.set).toHaveBeenNthCalledWith(1, { theme: "rose" });
  expect(appearance.theme.value).toBe("forest");
  first.resolve();
  await savingFirst;
  await vi.waitFor(() => expect(native.set).toHaveBeenCalledTimes(2));

  expect(native.set).toHaveBeenNthCalledWith(2, { theme: "forest" });
  expect(appearance.theme.value).toBe("forest");
  expect(stored.get("sandkasten.theme")).toBe("forest");
  expect(appearance.ready.value).toBe(false);
  second.resolve();
  await savingSecond;
  expect(appearance.ready.value).toBe(true);
});

it("keeps a new selection when the initial native read arrives late", async () => {
  stored.set("sandkasten.theme", "amber");
  const read = deferred<{ theme: string | null }>();
  native.get.mockReturnValueOnce(read.promise);
  const appearance = useAppearance();
  const saving = appearance.setTheme("indigo");

  expect(appearance.theme.value).toBe("indigo");
  expect(native.set).not.toHaveBeenCalled();
  read.resolve({ theme: "coral" });
  await appearance.initialized;
  expect(appearance.theme.value).toBe("indigo");
  expect(stored.get("sandkasten.theme")).toBe("indigo");
  await saving;

  expect(native.set).toHaveBeenCalledExactlyOnceWith({ theme: "indigo" });
  expect(appearance.ready.value).toBe(true);
});

it("exposes a native read failure and lets an explicit selection recover", async () => {
  native.get.mockRejectedValueOnce(new Error("Native preference read failed"));
  const appearance = useAppearance();
  await appearance.initialized;

  expect(appearance.ready.value).toBe(false);
  expect(appearance.error.value).not.toBe("");
  expect(attributes.get("data-appearance-ready")).toBe("false");
  expect(native.set).not.toHaveBeenCalled();
  await appearance.setTheme("sea");
  expect(appearance.theme.value).toBe("sea");
  expect(appearance.ready.value).toBe(true);
  expect(appearance.error.value).toBe("");
});

it("keeps a failed native write unsaved and retries when the user chooses the theme again", async () => {
  const appearance = useAppearance();
  await appearance.initialized;
  native.set.mockRejectedValueOnce(new Error("Native preference commit failed"));
  await appearance.setTheme("forest");

  expect(appearance.theme.value).toBe("forest");
  expect(appearance.ready.value).toBe(false);
  expect(appearance.error.value).not.toBe("");
  expect(attributes.get("data-appearance-ready")).toBe("false");
  await appearance.setTheme("forest");
  expect(native.set).toHaveBeenCalledTimes(2);
  expect(appearance.ready.value).toBe(true);
  expect(appearance.error.value).toBe("");
});

it("does not attribute a failed superseded write to a newer selection", async () => {
  const appearance = useAppearance();
  await appearance.initialized;
  const latest = deferred<void>();
  native.set.mockRejectedValueOnce(new Error("Old commit failed")).mockReturnValueOnce(latest.promise);
  const first = appearance.setTheme("rose");
  const second = appearance.setTheme("amber");
  await first;
  await vi.waitFor(() => expect(native.set).toHaveBeenCalledTimes(2));

  expect(appearance.theme.value).toBe("amber");
  expect(appearance.error.value).toBe("");
  expect(appearance.ready.value).toBe(false);
  latest.resolve();
  await second;
  expect(appearance.ready.value).toBe(true);
});

it("recovers the committed theme after Web storage falls back to an earlier value on restart", async () => {
  let committed = "coral";
  native.get.mockImplementation(async () => ({ theme: committed }));
  native.set.mockImplementation(async ({ theme }) => { committed = theme; });
  const first = useAppearance();
  await first.initialized;
  await first.setTheme("forest");

  stored.set("sandkasten.theme", "amber");
  const restarted = useAppearance();
  expect(restarted.ready.value).toBe(false);
  await restarted.initialized;

  expect(restarted.theme.value).toBe("forest");
  expect(stored.get("sandkasten.theme")).toBe("forest");
  expect(restarted.ready.value).toBe(true);
  expect(native.set).toHaveBeenCalledExactlyOnceWith({ theme: "forest" });
});

it("restores the native theme even when the Web preference cache is unavailable", async () => {
  vi.stubGlobal("localStorage", {
    getItem: () => { throw new Error("Web storage unavailable"); },
    setItem: () => { throw new Error("Web storage unavailable"); },
  });
  native.get.mockResolvedValueOnce({ theme: "sea" });
  const appearance = useAppearance();
  await appearance.initialized;

  expect(appearance.theme.value).toBe("sea");
  expect(attributes.get("data-theme")).toBe("sea");
  expect(appearance.ready.value).toBe(true);
  expect(appearance.error.value).toBe("");
  expect(native.set).not.toHaveBeenCalled();
});
