import { useEffect, useRef } from "react";
import { bindDialog } from "../lib/useDialog";

/** Se pone como primer hijo de un `div role="dialog"` dentro de un `{cond && …}`: le da Esc, foco atrapado y devolución del foco. */
function DialogBehavior({ onClose }: { onClose?: () => void }) {
  const marker = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => bindDialog(marker.current?.closest<HTMLElement>('[role="dialog"]') ?? null, close), []);
  return <i ref={marker} hidden />;
}

export default DialogBehavior;
