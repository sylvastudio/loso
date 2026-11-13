"use client";

import { useCallback, useEffect, useState } from "react";
import { Film, Image as ImageIcon, Music, RefreshCw } from "lucide-react";
import { cx } from "@/components/ui";
import type { FolderEntry } from "@/lib/local/folder";
import type { EditorBackend } from "./backend";

const ICON = { video: Film, image: ImageIcon, audio: Music } as const;
const KIND = { video: "Video", image: "Picture", audio: "Sound" } as const;

// Left-rail section for local projects: the clips already in the project's
// folder. Clicking one adds it as a layer, read in place (nothing is copied).
export function FolderTray({
  folder,
  version,
  used,
  onAdd,
}: {
  folder: NonNullable<EditorBackend["folder"]>;
  version: number;
  used: Set<string>;
  onAdd: (entry: FolderEntry) => void;
}) {
  const [entries, setEntries] = useState<FolderEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    folder
      .list()
      .then(setEntries)
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, version]);
  useEffect(load, [load]);

  return (
    <section aria-labelledby="folder-h" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h2 id="folder-h" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">
          {folder.inBrowser ? "Your clips" : "In your folder"}
        </h2>
        <button
          type="button"
          onClick={load}
          title="Look for new files"
          aria-label="Refresh folder"
          className="flex h-8 w-8 items-center justify-center text-ink-dim transition-colors hover:text-ink"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      {entries?.length === 0 && (
        <p className="text-[13px] leading-relaxed text-ink-dim">
          {folder.inBrowser
            ? "No videos, pictures or sounds yet. Add some with the button above."
            : `No videos, pictures or sounds in “${folder.name}” yet. Put files in the folder, or drop them anywhere here.`}
        </p>
      )}
      <div className="flex max-h-[240px] flex-col overflow-y-auto border-t border-line">
        {entries?.map((e) => {
          const Icon = ICON[e.kind];
          const inUse = used.has(folder.refFor(e));
          return (
            <button
              key={e.path}
              type="button"
              onClick={() => onAdd(e)}
              title={`Put ${e.path} in the video`}
              className={cx(
                "flex min-h-11 min-w-0 shrink-0 items-center gap-2.5 border-b border-line text-left text-[13.5px] transition-colors hover:text-lime",
                inUse ? "text-ink" : "text-ink-dim"
              )}
            >
              <Icon size={14} className="shrink-0" aria-hidden />
              <span className="w-[54px] shrink-0 text-[12px] text-ink-faint">{KIND[e.kind]}</span>
              <span className={cx("min-w-0 flex-1 truncate", inUse && "underline decoration-lime decoration-1 underline-offset-4")}>{e.name}</span>
              {inUse && <span className="text-[12px] text-lime">in use</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
