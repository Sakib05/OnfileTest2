"use client";
import React from "react";
import SavedItemsWidget from "@/components/viewer/SavedItemsWidget";

/** Bare centred screen for loading / not-found / error / empty states. No logo, no navigation. */
export function ViewerFrame({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="min-h-screen bg-app" data-testid={testId}>
      <div className="mx-auto w-full max-w-2xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(env(safe-area-inset-bottom)+5rem)] flex flex-col gap-5 overflow-x-hidden">
        {children}
      </div>
    </div>
  );
}

export function ViewerSkeleton({ label }: { label: string }) {
  return (
    <ViewerFrame>
      <div className="flex flex-col gap-4 animate-pulse-brand" aria-busy="true" aria-label={label} role="status">
        <div className="w-full aspect-video rounded-3xl bg-secondary border border-app" />
        <div className="h-7 w-3/4 rounded-lg bg-secondary" />
        <div className="h-8 w-1/3 rounded-full bg-secondary" />
        <div className="grid grid-cols-6 gap-2">
          <div className="col-span-3 h-[52px] rounded-2xl bg-secondary" />
          <div className="h-[52px] rounded-2xl bg-secondary" />
          <div className="h-[52px] rounded-2xl bg-secondary" />
          <div className="h-[52px] rounded-2xl bg-secondary" />
        </div>
      </div>
    </ViewerFrame>
  );
}

export function ViewerMessage({ icon, title, text, action, testId }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode; testId?: string }) {
  return (
    <>
      <ViewerFrame>
        <div className="flex flex-col items-center justify-center gap-4 text-center py-16 px-4" data-testid={testId}>
          <div className="w-20 h-20 rounded-3xl bg-secondary border border-app flex items-center justify-center text-muted">{icon}</div>
          <div>
            <h1 className="text-xl font-bold text-primary mb-1">{title}</h1>
            <p className="text-sm text-secondary">{text}</p>
          </div>
          {action}
        </div>
      </ViewerFrame>
      {/* Lets a visitor remove a stale saved entry even when its page no longer exists. */}
      <SavedItemsWidget />
    </>
  );
}
