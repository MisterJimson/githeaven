import { invoke, isTauri } from "@tauri-apps/api/core";
import { startSpan } from "./performance";
export const native = isTauri();
export async function call<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!native)
    throw new Error(
      "Open the desktop app with pnpm tauri dev to access local repositories.",
    );
  const finish = startSpan(`ipc.${command}`);
  try {
    const result = await invoke<T>(command, args);
    finish();
    return result;
  } catch (error) {
    finish("error");
    throw error;
  }
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
