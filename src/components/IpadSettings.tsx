import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { Segmented } from "./BoardFilters";
import { ipadAddresses, ipadSettings, newToken, saveIpadSettings, startIpad, stopIpad, type IpadSettings as Settings } from "../lib/ipad";
import { ipadLink, isTailscale, sortAddresses } from "../lib/ipadLink";
import { isPrivate } from "../lib/privacy";
import { useToast } from "../context/ToastContext";
import { t } from "../lib/i18n";

const panel = "divide-y divide-line rounded-lg border border-line bg-surface";
const row = "flex items-center gap-4 px-5 py-4";
const ghostButton =
  "rounded-2xl border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm transition hover:bg-highlight active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60";

function qrSvg(text: string): string {
  const qr = qrcode(0, "M");

  qr.addData(text);
  qr.make();

  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

/** Settings > iPad: the switch for receiving images, and the link (with QR) to open on the iPad */
function IpadSettings() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<Settings>(ipadSettings);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.enabled) {
      ipadAddresses()
        .then((ips) => setAddresses(sortAddresses(ips)))
        .catch(console.error);
    }
  }, [settings.enabled]);

  async function apply(next: Settings) {
    setError(null);
    saveIpadSettings(next);

    try {
      await (next.enabled ? startIpad() : stopIpad());
      setSettings(next);
    } catch (failure) {
      const off = { ...next, enabled: false };

      saveIpadSettings(off);
      setSettings(off);
      setError(String(failure));
    }
  }

  const primary = addresses[0] ?? null;
  const link = primary ? ipadLink(primary, settings.port, settings.token) : null;

  return (
    <div className={panel}>
      <div className={row}>
        <div className="flex-1">
          <p className="font-semibold">{t("Receive images from the iPad")}</p>
          <p className="text-sm text-muted">
            {t("Opens a private page you use from the iPad to send images straight into a commission stage. It only works while ZeeBoard is open.")}
          </p>
        </div>
        <Segmented
          options={[
            { value: "off", label: t("Off") },
            { value: "on", label: t("On") },
          ]}
          value={settings.enabled ? "on" : "off"}
          onChange={(value) => apply({ ...settings, enabled: value === "on" })}
        />
      </div>

      {error && <p className="px-5 py-3 text-sm text-tone-bad">{t("Could not start the iPad receiver: {error}", { error })}</p>}

      {settings.enabled && !error && (
        <div className="px-5 py-4 text-sm">
          {isPrivate() ? (
            <p className="text-muted">{t("The link is hidden in private mode.")}</p>
          ) : (
            <>
              <div className="flex gap-5">
                {link && (
                  <div
                    className="h-40 w-40 shrink-0 rounded-md bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: qrSvg(link) }}
                  />
                )}

                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-muted">{t("Listening on port {port}. Scan the code with the iPad camera or open the link.", { port: settings.port })}</p>

                  {primary === null ? (
                    <p className="text-tone-warn">{t("No network address found on this PC.")}</p>
                  ) : isTailscale(primary) ? (
                    <p className="font-semibold text-tone-ok">{t("Tailscale found: this link works from the iPad even over mobile data.")}</p>
                  ) : (
                    <p className="text-tone-warn">
                      {t("Tailscale not found on this PC. Install it here and on the iPad (tailscale.com/download) and sign in with the same account so the iPad can reach this PC over mobile data. Until then the link only works on the same Wi-Fi.")}
                    </p>
                  )}

                  {link && <p className="break-all font-mono text-xs">{link}</p>}

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      disabled={!link}
                      onClick={() =>
                        navigator.clipboard
                          .writeText(link ?? "")
                          .then(() => showToast("Link copied.", "success"))
                          .catch(() => showToast("Could not copy it.", "error"))
                      }
                      className={ghostButton}
                    >
                      {t("Copy link")}
                    </button>
                    <button
                      type="button"
                      title={t("The old links stop working")}
                      onClick={() => apply({ ...settings, token: newToken() })}
                      className={ghostButton}
                    >
                      {t("New key")}
                    </button>
                  </div>

                  {addresses.length > 1 && (
                    <p className="text-xs text-muted">{t("Other addresses of this PC: {list}", { list: addresses.slice(1).join(", ") })}</p>
                  )}
                </div>
              </div>

              <p className="mt-3 text-xs text-muted">
                {t("The first time, Windows asks to allow ZeeBoard through the firewall: allow it on private networks.")}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default IpadSettings;
