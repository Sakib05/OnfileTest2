"use client";
import React from "react";
import PublishWizard from "@/components/publish/PublishWizard";

/**
 * Entry point for the "Create" tab. The previous single-page "Import & Publish"
 * form was replaced by the step-by-step publishing flow in
 * src/components/publish/ (Link → Details → Monetization → Publish).
 */
export default function CreateTab({ onSuccess }: { onSuccess?: () => void }) {
  return <PublishWizard onFinished={onSuccess} />;
}
