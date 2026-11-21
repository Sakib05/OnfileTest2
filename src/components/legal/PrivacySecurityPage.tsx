"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { getPrivacySections, getSecuritySections } from "@/content/privacy";
import LegalDocument from "@/components/legal/LegalDocument";

type Part = "privacy" | "security";

/** Privacy & Security page: Privacy Policy and Security overview behind one segmented control. */
export default function PrivacySecurityPage() {
  const [part, setPart] = useState<Part>("privacy");
  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold text-primary">Privacy &amp; Security</h1>
        <p className="text-xs text-secondary mt-0.5">How Onfile handles your data and protects your account</p>
      </div>
      <div role="tablist" aria-label="Privacy and security" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-secondary">
        {(["privacy", "security"] as const).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={part === p}
            onClick={() => setPart(p)}
            className={cn(
              "min-h-10 rounded-lg text-sm font-semibold transition-colors",
              part === p ? "bg-card text-primary shadow-app-sm" : "text-secondary"
            )}
          >
            {p === "privacy" ? "Privacy Policy" : "Security"}
          </button>
        ))}
      </div>
      {part === "privacy" ? (
        <LegalDocument title="Privacy Policy" sections={getPrivacySections()} headingLevel="h2" />
      ) : (
        <LegalDocument title="Security" sections={getSecuritySections()} headingLevel="h2" showDraftNotice={false} />
      )}
    </div>
  );
}
