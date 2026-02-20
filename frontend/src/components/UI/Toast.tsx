import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, Info, XCircle, X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastProps {
  toasts: ToastMessage[];
  onClose: (id: string) => void;
}

const toastVariants = {
  success: {
    icon: <CheckCircle className="w-5 h-5 text-green-500" />,
    bg: 'bg-green-50 border-green-200',
    text: 'text-green-800'
  },
  error: {
    icon: <XCircle className="w-5 h-5 text-red-500" />,
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-800'
  },
  info: {
    icon: <Info className="w-5 h-5 text-blue-500" />,
    bg: 'bg-blue-50 border-blue-200',
    text: 'text-blue-800'
  },
  warning: {
    icon: <AlertCircle className="w-5 h-5 text-amber-500" />,
    bg: 'bg-amber-50 border-amber-200',
    text: 'text-amber-800'
  }
};

export const Toast: React.FC<ToastProps> = ({ toasts, onClose }) => {
  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 50, scale: 0.3 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
            className={twMerge(
              'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg min-w-[300px] max-w-md',
              toastVariants[toast.type].bg
            )}
          >
            <div className="flex-shrink-0">
              {toastVariants[toast.type].icon}
            </div>
            <div className={clsx('flex-grow text-sm font-medium', toastVariants[toast.type].text)}>
              {toast.message}
            </div>
            <button
              onClick={() => onClose(toast.id)}
              className="flex-shrink-0 p-1 hover:bg-black/5 rounded-full transition-colors"
            >
              <X className="w-4 h-4 opacity-50 hover:opacity-100" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
