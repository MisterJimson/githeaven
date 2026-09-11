// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PublishBranch } from "./PublishBranch";
afterEach(cleanup);
it("defaults to the same branch on origin and publishes only on confirmation", async () => {
  const publish = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(
    <PublishBranch
      target={{
        root: "/test",
        branch: "feature/new",
        remotes: ["upstream", "origin"],
      }}
      onPublish={publish}
      onClose={close}
    />,
  );
  expect(
    (screen.getByLabelText("Remote branch name") as HTMLInputElement).value,
  ).toBe("feature/new");
  expect(publish).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole("dialog"));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(publish).toHaveBeenCalledWith("origin", "feature/new");
});
