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

  const showToast = useCallback((message: string, type: ToastType = "success", action?: ToastAction) => {
    setToastType(type);
    setToastMessage(t(message));
    setToastAction(action ?? null);

    // The previous toast must not close this one early; one with an action stays longer
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setToastMessage("");
      setToastAction(null);
    }, action ? 8000 : 2500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {toastMessage && (
        <div
          className={
            toastType === "success"
              ? "fixed bottom-6 right-6 z-[60] rounded-2xl bg-tone-ok px-5 py-3 text-sm font-bold text-on-tone shadow-xl"
              : "fixed bottom-6 right-6 z-[60] rounded-2xl bg-tone-bad px-5 py-3 text-sm font-bold text-on-tone shadow-xl"
          }
        >
          {toastMessage}
          {toastAction && (
            <button
              type="button"
              className="ml-4 rounded-sm bg-black/15 px-2 py-1 text-xs font-bold hover:bg-black/25"
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