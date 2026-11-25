import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { t } from "../lib/i18n";

type ToastType = "success" | "error";

type ToastAction = { label: string; onClick: () => void };

type ToastContextValue = {
  showToast: (message: string, type?: ToastType, action?: ToastAction) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<ToastType>("success");
  const [toastAction, setToastAction] = useState<ToastAction | null>(null);
  const timer = useRef<number>(0);

  const closeIn = useCallback((ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setToastMessage("");
      setToastAction(null);
    }, ms);
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "success", action?: ToastAction) => {
    setToastType(type);
    setToastMessage(t(message));
    setToastAction(action ?? null);

    // The previous toast must not close this one early; one with an action (Undo) stays longer
    closeIn(action ? 8000 : 2500);
  }, [closeIn]);

  // While the pointer or the keyboard is on the toast it stays, so Undo can't slip away mid-reach (M6.2)
  const hold = () => window.clearTimeout(timer.current);
  const release = () => closeIn(3000);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {toastMessage && (
        <div
          role={toastType === "success" ? "status" : "alert"}
          onMouseEnter={hold}
          onMouseLeave={release}
          onFocus={hold}
          onBlur={release}
          className={
            toastType === "success"
              ? "fixed bottom-6 right-6 z-[60] rounded-control bg-tone-ok px-5 py-3 text-sm font-bold text-on-tone shadow-xl"
              : "fixed bottom-6 right-6 z-[60] rounded-control bg-tone-bad px-5 py-3 text-sm font-bold text-on-tone shadow-xl"
          }
        >
          {toastMessage}
          {toastAction && (
            <button
              type="button"
              className="ml-4 rounded-chip bg-black/15 px-2 py-1 text-xs font-bold hover:bg-black/25"
              onClick={() => {
                setToastMessage("");
                setToastAction(null);
                toastAction.onClick();
              }}
            >
              {t(toastAction.label)}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return context;
}