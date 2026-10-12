import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Comportamiento común de un diálogo: Esc lo cierra (solo el que está encima), Tab se queda dentro de él,
 * entra el foco al abrir y vuelve al elemento anterior al cerrar. Se pone `ref` en el `div role="dialog"`.
 * Sin `onClose` (p. ej. mientras se guarda) Esc no hace nada.
 */
/** Engancha el comportamiento a un diálogo ya montado; devuelve la función que lo deshace. */
export function bindDialog(node: HTMLElement | null, close: { current?: () => void }): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const items = () => [...(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((item) => item.offsetParent !== null);

  // Un diálogo sin controles (la lista de atajos) recibe el foco él mismo
  if (node && items().length === 0) node.tabIndex = -1;
  if (node && !node.contains(document.activeElement)) (items()[0] ?? node).focus();

  const onKey = (event: KeyboardEvent) => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    if (dialogs[dialogs.length - 1] !== node) return;

    if (event.key === "Escape" && close.current) {
      close.current();
    } else if (event.key === "Tab") {
      const list = items();
      if (list.length === 0) {
        event.preventDefault();
        return;
      }
      const [first, last] = [list[0], list[list.length - 1]];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  window.addEventListener("keydown", onKey);
  return () => {
    window.removeEventListener("keydown", onKey);
    previous?.focus?.();
  };
}

/** Para componentes cuyo diálogo siempre está montado: `const ref = useDialog(onClose)` y `ref` en el `div role="dialog"`. */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose?: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => bindDialog(ref.current, close), []);
  return ref;
}
