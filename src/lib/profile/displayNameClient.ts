"use client";
/**
 * Browser-side helper for the Edit Profile display name. Deliberately separate from ./avatarClient (the disabled
 * picture-upload helpers) so the active Edit Profile imports nothing related to uploading / cropping.
 */
import type { UserProfile } from "@/contexts/AppContext";
import { AvatarError } from "./avatarErrors";

async function parse(res: Response): Promise<{ user?: UserProfile; error?: string; code?: string }> {
  return (await res.json().catch(() => ({}))) as { user?: UserProfile; error?: string; code?: string };
}

/** Saves the custom display name ("" clears it → the Telegram name is used again). */
export async function saveDisplayName(displayName: string): Promise<UserProfile | null> {
  let res: Response;
  try {
    res = await fetch("/api/user/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
  } catch {
    throw new AvatarError("network");
  }
  const data = await parse(res);
  if (!res.ok) throw new Error(data.error || "Couldn't save your display name. Please try again.");
  return data.user ?? null;
}
