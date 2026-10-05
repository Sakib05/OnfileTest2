"use client";
import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-24 left-0 right-0 z-[100] flex flex-col gap-2 items-center pointer-events-none px-4">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const icons = {
    success: <CheckCircle2 size={16} className="text-green-500" />,
    error: <XCircle size={16} className="text-red-500" />,
    warning: <AlertTriangle size={16} className="text-yellow-500" />,
    info: <Info size={16} className="text-blue-500" />,
  };

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-app-lg text-sm font-medium",
        "animate-slide-up max-w-sm w-full"
      )}
      style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
    >
      {icons[toast.type]}
      <span className="flex-1">{toast.message}</span>
      <button onClick={() => onRemove(toast.id)} className="text-muted hover:text-primary transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}
