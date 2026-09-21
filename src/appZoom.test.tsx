// @vitest-environment jsdom
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAppZoom } from "./appZoom";
const { setZoom } = vi.hoisted(() => ({
  setZoom: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./api", () => ({ native: true }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom }),
}));
function App() {
  useAppZoom();
  return (
    <div
      data-testid="viewer"
      onKeyDownCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    />
  );
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  setZoom.mockClear();
});
it("restores and remembers app zoom, while leaving consumed viewer shortcuts alone", async () => {
  localStorage.setItem("githeaven.app-zoom", "1.2");
  const { getByTestId } = render(<App />);
  await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(1.2));
  fireEvent.keyDown(window, { key: "+", metaKey: true, shiftKey: true });
  await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(1.3));
  fireEvent.keyDown(getByTestId("viewer"), { key: "-", metaKey: true });
  expect(setZoom).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(window, { key: "-", metaKey: true });
  await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(1.2));
  expect(localStorage.getItem("githeaven.app-zoom")).toBe("1.2");
  fireEvent.keyDown(window, { key: "0", metaKey: true });
  await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(1));
});
