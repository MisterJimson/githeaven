import { invoke, isTauri } from "@tauri-apps/api/core";
export const native = isTauri();
export async function call<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!native)
    throw new Error(
      "Open the desktop app with pnpm tauri dev to access local repositories.",
    );
  return invoke<T>(command, args);
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
