/**
 * Gaps spec §8.4 (plan Task 10-B): an `image` param's picker -- the image files of the chosen folder, as the server lists
 * them (GET /api/control/flows/images: excludes applied, at most 200, links never offered), each a folder-relative path a
 * start or a `params` change accepts. The picker only fills the param's path field beside it; the person may always type
 * a path instead (a file past the bound, or when the folder cannot be listed). A folder that is no registered dir
 * project's is refused (flow-dir-unregistered), and that refusal is shown. A later answer for an older folder or
 * template is dropped, never shown.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ControlRequestError, controlGet } from "./controlApi.js";
import type { FlowFolderImagesV1 } from "./controlTypes.js";
import { refusalText } from "./i18n.js";

type Listing = { kind: "reading" } | { kind: "failed" } | { kind: "too-large" } | { kind: "refused"; text: string } | { kind: "read"; files: string[]; truncated: boolean; limit: number };
/** The wait after the last keystroke in the folder field before the folder is listed. */
export const LIST_DELAY_MS = 250;

/** `hasDefault` (Task 11 acceptance, session ffec7b28): only a param with a default offers "none picked (use the default)". */
export function FolderImagePicker(props: { dir: string; template: string; paramId: string; value: string; hasDefault: boolean; onPick: (path: string) => void }): JSX.Element {
  const { t } = useTranslation();
  const dir = props.dir.trim();
  const [listing, setListing] = useState<Listing>({ kind: "reading" });
  useEffect(() => {
    if (!dir.startsWith("/")) return;
    let live = true;
    setListing({ kind: "reading" });
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const answer = await controlGet<FlowFolderImagesV1>(`/api/control/flows/images?dir=${encodeURIComponent(dir)}&template=${encodeURIComponent(props.template)}`);
          if (!live) return;
          setListing(Array.isArray(answer?.files) ? { kind: "read", files: answer.files, truncated: answer.truncated === true, limit: answer.limit } : { kind: "failed" });
        } catch (error) {
          // Task 10-B fix I1: a folder past the server's entry or time cap is said to be too large, not unlistable.
          // Final review M4: a folder that is no registered dir project's is refused as a start on it is -- shown so.
          if (!live) return;
          if (error instanceof ControlRequestError && error.refusal.code === "flow-folder-too-large") setListing({ kind: "too-large" });
          else if (error instanceof ControlRequestError && error.refusal.code === "flow-dir-unregistered") setListing({ kind: "refused", text: refusalText(error.refusal) });
          else setListing({ kind: "failed" });
        }
      })();
    }, LIST_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [dir, props.template]);
  if (!dir.startsWith("/")) return <p className="detail-note">{t("flow.start.image.needsFolder")}</p>;
  if (listing.kind === "reading") return <p className="detail-note" role="status">{t("flow.start.image.reading")}</p>;
  if (listing.kind === "too-large") return <p className="detail-note" role="status">{t("flow.start.image.tooLarge")}</p>;
  if (listing.kind === "failed") return <p className="detail-note" role="status">{t("flow.start.image.failed")}</p>;
  if (listing.kind === "refused") return <p className="detail-note" role="status">{listing.text}</p>;
  if (listing.files.length === 0) return <p className="detail-note">{t("flow.start.image.empty")}</p>;
  return (
    <>
      <select aria-label={t("flow.start.image.pick", { param: props.paramId })} value={listing.files.includes(props.value) ? props.value : ""}
        onChange={(event) => props.onPick(event.currentTarget.value)}>
        <option value="">{t(props.hasDefault ? "flow.start.image.none" : "flow.start.image.choose")}</option>
        {listing.files.map((file) => <option key={file} value={file}>{file}</option>)}
      </select>
      {listing.truncated && <p className="detail-note">{t("flow.start.image.truncated", { limit: listing.limit })}</p>}
    </>
  );
}
