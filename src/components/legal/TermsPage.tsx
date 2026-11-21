"use client";
import React from "react";
import { getTermsSections } from "@/content/terms";
import LegalDocument from "@/components/legal/LegalDocument";

/** Terms & Conditions page (content lives in src/content/terms.ts). */
export default function TermsPage() {
  return (
    <div className="animate-fade-in">
      <LegalDocument
        title="Terms & Conditions"
        intro="Please read these terms carefully. They apply to creators and to people who open creators' links."
        sections={getTermsSections()}
      />
    </div>
  );
}
