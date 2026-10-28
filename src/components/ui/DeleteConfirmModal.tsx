"use client";
import React from "react";
import Modal from "./Modal";
import { Trash2 } from "lucide-react";

interface DeleteConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  loading?: boolean;
}

export default function DeleteConfirmModal({
  open,
  onClose,
  onConfirm,
  title = "Delete Item",
  description = "Are you sure you want to delete this? This action cannot be undone.",
  loading,
}: DeleteConfirmModalProps) {
  return (
    <Modal open={open} onClose={onClose} size="sm" hideClose>
      <div className="flex flex-col items-center text-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <Trash2 size={26} className="text-red-500" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-primary mb-1">{title}</h3>
          <p className="text-sm text-secondary leading-relaxed">{description}</p>
        </div>
        <div className="flex gap-3 w-full">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl font-medium text-sm btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-3 rounded-xl font-semibold text-sm bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
