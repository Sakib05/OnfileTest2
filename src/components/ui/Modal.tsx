"use client";
import React, { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  hideClose?: boolean;
}

export default function Modal({ open, onClose, title, children, size = "md", hideClose }: ModalProps) {
  // Rendered in a portal on <body>: a modal opened from inside a <form> (e.g. the
  // "New playlist" dialog inside the Publish details form) must NOT be a DOM
  // descendant of that form, or its own <form>/<button>s would nest inside it.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true, // client
    () => false // server
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open || !mounted) return null;

  const sizeClass = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
  }[size];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className={cn(
          "relative w-full bg-card rounded-2xl shadow-app-lg animate-slide-up overflow-hidden",
          sizeClass
        )}
        style={{ background: "var(--color-bg-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-app">
            <h2 className="text-base font-semibold text-primary">{title}</h2>
            {!hideClose && (
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-secondary transition-colors"
              >
                <X size={16} className="text-secondary" />
              </button>
            )}
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
