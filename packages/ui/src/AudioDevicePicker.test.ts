import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import AudioDevicePicker from "./AudioDevicePicker.svelte"

/**
 * STORY-07.1 acceptance tests.
 *
 * AC1: Uses `navigator.mediaDevices.enumerateDevices()` — verified by passing an
 *      `enumerateDevices` prop that's called on mount.
 * AC2: Renders human-readable labels (permission flow surfaced when labels are empty) —
 *      verified by the permission-pending branch.
 * AC3: Selected device persists — emits a `change` event the host wires to settings.
 * AC4: "Test" button captures 2s and shows a level meter — verified by the test-row.
 * AC5: Cross-platform — N/A in unit context; assumed via standard Web Audio APIs.
 */

interface DeviceInfo {
    deviceId: string
    label: string
    kind: "audioinput"
    groupId: string
}

function makeDevice(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
    return {
        deviceId: "mic-1",
        label: "Built-in Mic",
        kind: "audioinput",
        groupId: "g1",
        ...overrides
    }
}

describe("AudioDevicePicker", () => {
    let target: HTMLElement

    beforeEach(() => {
        target = document.createElement("div")
        document.body.appendChild(target)
    })

    afterEach(() => {
        document.body.removeChild(target)
    })

    describe("device enumeration (AC1, AC2)", () => {
        it("calls enumerateDevices on mount and renders the returned devices as <option>", async () => {
            const enumerateDevices = vi.fn(async () => [
                makeDevice({ deviceId: "mic-1", label: "Built-in Mic" }),
                makeDevice({ deviceId: "mic-2", label: "USB Interface", groupId: "g2" })
            ])
            const cmp = new AudioDevicePicker({ target, props: { enumerateDevices } })
            // Wait for the async refresh on mount.
            await new Promise((r) => setTimeout(r, 0))
            expect(enumerateDevices).toHaveBeenCalledTimes(1)
            const options = Array.from(target.querySelectorAll("option")) as HTMLOptionElement[]
            expect(options.map((o) => o.value)).toEqual(["", "mic-1", "mic-2"])
            expect(options.map((o) => o.textContent?.trim())).toContain("Built-in Mic")
            cmp.$destroy()
        })

        it("shows a 'No audio inputs detected' placeholder when the list is empty", async () => {
            const enumerateDevices = vi.fn(async () => [])
            const cmp = new AudioDevicePicker({ target, props: { enumerateDevices } })
            await new Promise((r) => setTimeout(r, 0))
            expect(target.textContent).toContain("No audio inputs detected")
            cmp.$destroy()
        })

        it("surfaces the request-permission prompt when all device labels are empty", async () => {
            const enumerateDevices = vi.fn(async () => [
                makeDevice({ deviceId: "mic-1", label: "" }),
                makeDevice({ deviceId: "mic-2", label: "", groupId: "g2" })
            ])
            const requestPermission = vi.fn(async () => {})
            const cmp = new AudioDevicePicker({
                target,
                props: { enumerateDevices, requestPermission }
            })
            await new Promise((r) => setTimeout(r, 0))
            const permButton = target.querySelector('[data-testid="request-permission"]') as HTMLButtonElement
            expect(permButton).not.toBeNull()
            expect(permButton.textContent).toMatch(/allow microphone access/i)
            cmp.$destroy()
        })

        it("does NOT show the permission prompt when at least one label is populated", async () => {
            const enumerateDevices = vi.fn(async () => [
                makeDevice({ deviceId: "mic-1", label: "Built-in Mic" })
            ])
            const requestPermission = vi.fn(async () => {})
            const cmp = new AudioDevicePicker({
                target,
                props: { enumerateDevices, requestPermission }
            })
            await new Promise((r) => setTimeout(r, 0))
            expect(target.querySelector('[data-testid="request-permission"]')).toBeNull()
            cmp.$destroy()
        })

        it("renders an unnamed-device fallback label when MediaDeviceInfo.label is empty", async () => {
            const enumerateDevices = vi.fn(async () => [makeDevice({ deviceId: "mic-1abcdef", label: "" })])
            const cmp = new AudioDevicePicker({ target, props: { enumerateDevices } })
            await new Promise((r) => setTimeout(r, 0))
            const opt = target.querySelector("option")
            expect(target.textContent).toContain("(unnamed device · mic-1abc")
            cmp.$destroy()
        })

        it("surfaces enumerate errors in the error region", async () => {
            const enumerateDevices = vi.fn(async () => {
                throw new Error("hardware died")
            })
            const cmp = new AudioDevicePicker({ target, props: { enumerateDevices } })
            await new Promise((r) => setTimeout(r, 0))
            const err = target.querySelector('[data-testid="error"]')
            expect(err?.textContent).toContain("hardware died")
            cmp.$destroy()
        })
    })

    describe("device selection (AC3)", () => {
        it("dispatches a 'change' event when the operator picks a device", async () => {
            const enumerateDevices = vi.fn(async () => [
                makeDevice({ deviceId: "mic-1" }),
                makeDevice({ deviceId: "mic-2", groupId: "g2" })
            ])
            const cmp = new AudioDevicePicker({ target, props: { enumerateDevices } })
            const events: { deviceId: string }[] = []
            cmp.$on("change", (e: any) => events.push(e.detail))
            await new Promise((r) => setTimeout(r, 0))
            const select = target.querySelector('[data-testid="device-select"]') as HTMLSelectElement
            select.value = "mic-2"
            select.dispatchEvent(new Event("change", { bubbles: true }))
            expect(events).toEqual([{ deviceId: "mic-2" }])
            cmp.$destroy()
        })

        it("respects the initial `value` prop by selecting the matching <option>", async () => {
            const enumerateDevices = vi.fn(async () => [
                makeDevice({ deviceId: "mic-1" }),
                makeDevice({ deviceId: "mic-2", groupId: "g2" })
            ])
            const cmp = new AudioDevicePicker({
                target,
                props: { enumerateDevices, value: "mic-2" }
            })
            await new Promise((r) => setTimeout(r, 0))
            const options = Array.from(target.querySelectorAll("option")) as HTMLOptionElement[]
            const selected = options.find((o) => o.selected)
            expect(selected?.value).toBe("mic-2")
            cmp.$destroy()
        })

        it("renders a neutral placeholder when devices exist but no value is selected", async () => {
            const enumerateDevices = vi.fn(async () => [
                makeDevice({ deviceId: "mic-1" }),
                makeDevice({ deviceId: "mic-2", groupId: "g2" })
            ])
            const cmp = new AudioDevicePicker({ target, props: { enumerateDevices, value: null } })
            await new Promise((r) => setTimeout(r, 0))
            const selected = target.querySelector("option:checked") as HTMLOptionElement
            expect(selected.value).toBe("")
            expect(selected.textContent?.trim()).toBe("Select an audio input")
            cmp.$destroy()
        })
    })

    describe("test capture (AC4)", () => {
        it("renders the Test button + level meter when startTest is provided", async () => {
            const enumerateDevices = vi.fn(async () => [makeDevice()])
            const startTest = vi.fn(async () => {})
            const cmp = new AudioDevicePicker({
                target,
                props: { enumerateDevices, startTest, value: "mic-1" }
            })
            await new Promise((r) => setTimeout(r, 0))
            expect(target.querySelector('[data-testid="test"]')).not.toBeNull()
            expect(target.querySelector('[data-testid="level-meter"]')).not.toBeNull()
            cmp.$destroy()
        })

        it("hides the Test button + level meter when startTest is not provided", async () => {
            const enumerateDevices = vi.fn(async () => [makeDevice()])
            const cmp = new AudioDevicePicker({ target, props: { enumerateDevices } })
            await new Promise((r) => setTimeout(r, 0))
            expect(target.querySelector('[data-testid="test"]')).toBeNull()
            expect(target.querySelector('[data-testid="level-meter"]')).toBeNull()
            cmp.$destroy()
        })

        it("calls startTest(deviceId) when the operator clicks Test", async () => {
            const enumerateDevices = vi.fn(async () => [makeDevice({ deviceId: "mic-1" })])
            const startTest = vi.fn(async () => {})
            const cmp = new AudioDevicePicker({
                target,
                props: { enumerateDevices, startTest, value: "mic-1" }
            })
            await new Promise((r) => setTimeout(r, 0))
            const btn = target.querySelector('[data-testid="test"]') as HTMLButtonElement
            btn.click()
            await new Promise((r) => setTimeout(r, 0))
            expect(startTest).toHaveBeenCalledWith("mic-1")
            cmp.$destroy()
        })

        it("disables the Test button while testing is in flight", async () => {
            const enumerateDevices = vi.fn(async () => [makeDevice({ deviceId: "mic-1" })])
            let resolveTest: (() => void) | null = null
            const startTest = vi.fn(
                () =>
                    new Promise<void>((r) => {
                        resolveTest = r
                    })
            )
            const cmp = new AudioDevicePicker({
                target,
                props: { enumerateDevices, startTest, value: "mic-1" }
            })
            await new Promise((r) => setTimeout(r, 0))
            const btn = target.querySelector('[data-testid="test"]') as HTMLButtonElement
            btn.click()
            await new Promise((r) => setTimeout(r, 0))
            expect(btn.disabled).toBe(true)
            expect(btn.textContent?.trim()).toMatch(/capturing/i)
            resolveTest?.()
            await new Promise((r) => setTimeout(r, 0))
            expect(btn.disabled).toBe(false)
            cmp.$destroy()
        })

        it("renders the level meter at the value of the `levelMeter` prop", async () => {
            const enumerateDevices = vi.fn(async () => [makeDevice({ deviceId: "mic-1" })])
            const startTest = vi.fn(async () => {})
            const cmp = new AudioDevicePicker({
                target,
                props: { enumerateDevices, startTest, value: "mic-1", levelMeter: 0.42 }
            })
            await new Promise((r) => setTimeout(r, 0))
            const fill = target.querySelector(".level-fill") as HTMLElement
            expect(fill.style.width).toBe("42%")
            // Update reactively.
            cmp.$set({ levelMeter: 0.8 })
            await new Promise((r) => setTimeout(r, 0))
            expect(fill.style.width).toBe("80%")
            cmp.$destroy()
        })

        it("clamps levelMeter to [0,1] for the visual fill", async () => {
            const enumerateDevices = vi.fn(async () => [makeDevice({ deviceId: "mic-1" })])
            const startTest = vi.fn(async () => {})
            const cmp = new AudioDevicePicker({
                target,
                props: { enumerateDevices, startTest, value: "mic-1", levelMeter: 1.5 }
            })
            await new Promise((r) => setTimeout(r, 0))
            const fill = target.querySelector(".level-fill") as HTMLElement
            expect(fill.style.width).toBe("100%")
            cmp.$set({ levelMeter: -0.2 })
            await new Promise((r) => setTimeout(r, 0))
            expect(fill.style.width).toBe("0%")
            cmp.$destroy()
        })
    })

    describe("refresh button", () => {
        it("re-runs enumerateDevices when clicked", async () => {
            const enumerateDevices = vi.fn(async () => [makeDevice()])
            const cmp = new AudioDevicePicker({ target, props: { enumerateDevices } })
            await new Promise((r) => setTimeout(r, 0))
            expect(enumerateDevices).toHaveBeenCalledTimes(1)
            const btn = target.querySelector('[data-testid="refresh"]') as HTMLButtonElement
            btn.click()
            await new Promise((r) => setTimeout(r, 0))
            expect(enumerateDevices).toHaveBeenCalledTimes(2)
            cmp.$destroy()
        })
    })
})
