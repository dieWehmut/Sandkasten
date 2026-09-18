import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import ApiEndpointDialog from "../src/components/ApiEndpointDialog.vue";
import { createTranslator } from "../src/i18n/locale";

afterEach(() => {
  document.body.innerHTML = "";
});

const t = createTranslator("en");

function mountDialog(props = {}) {
  return mount(ApiEndpointDialog, {
    props: { open: true, value: "", t, ...props },
    attachTo: document.body,
  });
}

describe("ApiEndpointDialog", () => {
  test("shows the current endpoint and explains the default", () => {
    const wrapper = mountDialog({ value: "https://run.example.com" });
    const input = wrapper.get("[data-testid='api-endpoint-input']");
    expect((input.element as HTMLInputElement).value).toBe("https://run.example.com");
    expect(wrapper.get("[data-testid='api-endpoint-hint']").text()).toContain("same origin");
  });

  test("reports the local desktop default when nothing is configured", () => {
    const wrapper = mountDialog({ value: "", desktop: true });
    expect(wrapper.get("[data-testid='api-endpoint-hint']").text()).toContain("127.0.0.1:8080");
  });

  test("emits the normalized endpoint on save", async () => {
    const wrapper = mountDialog();
    const input = wrapper.get("[data-testid='api-endpoint-input']");
    await input.setValue("  https://run.example.com/  ");
    await wrapper.get("[data-testid='api-endpoint-form']").trigger("submit");
    expect(wrapper.emitted("save")).toEqual([["https://run.example.com"]]);
  });

  test("clears the override when the field is emptied", async () => {
    const wrapper = mountDialog({ value: "https://run.example.com" });
    await wrapper.get("[data-testid='api-endpoint-input']").setValue("   ");
    await wrapper.get("[data-testid='api-endpoint-form']").trigger("submit");
    expect(wrapper.emitted("save")).toEqual([[""]]);
  });

  test("shows a validation error and does not emit for a bad value", async () => {
    const wrapper = mountDialog();
    await wrapper.get("[data-testid='api-endpoint-input']").setValue("ftp://example.com");
    await wrapper.get("[data-testid='api-endpoint-form']").trigger("submit");
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.get("[data-testid='api-endpoint-error']").text()).toMatch(/http/i);
  });

  test("resets the draft whenever the dialog opens", async () => {
    const wrapper = mountDialog({ open: false, value: "https://first.example.com" });
    await wrapper.setProps({ open: true });
    expect((wrapper.get("[data-testid='api-endpoint-input']").element as HTMLInputElement).value).toBe("https://first.example.com");
    await wrapper.get("[data-testid='api-endpoint-input']").setValue("https://edited.example.com");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true, value: "https://second.example.com" });
    expect((wrapper.get("[data-testid='api-endpoint-input']").element as HTMLInputElement).value).toBe("https://second.example.com");
  });

  test("closes without saving when cancelled or dismissed with Escape", async () => {
    const wrapper = mountDialog({ value: "https://run.example.com" });
    await wrapper.get("[data-testid='api-endpoint-input']").setValue("https://edited.example.com");
    await wrapper.get("[data-action='api-endpoint-cancel']").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.emitted("save")).toBeUndefined();

    await wrapper.get("[data-testid='api-endpoint-dialog']").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toHaveLength(2);
  });
});
