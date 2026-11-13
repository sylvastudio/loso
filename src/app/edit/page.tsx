"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { Button, ErrorState } from "@/components/ui";
import { LosoMark } from "@/components/logo";
import { CompositorEditor } from "@/components/compositor/editor";
import type { EditorBackend } from "@/components/compositor/backend";
import { localBackend } from "@/lib/local/backend";
import { localAssetUrl } from "@/lib/local/assets";
import {
  ProjectFileError,
  askProjectAccess,
  getLocalProject,
  openLocalProject,
  projectAccess,
  type LocalProjectRecord,
} from "@/lib/local/projects";

// The browser-only editor: /edit?id=<project id>. Static-export friendly
// (no dynamic route segment), so it can be hosted as plain files.
export default function EditPage() {
  return (
    <Suspense>
      <EditInner />
    </Suspense>
  );
}

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "needs-access"; record: LocalProjectRecord }
  | { kind: "error"; message: string }
  | { kind: "ready"; backend: EditorBackend };

function EditInner() {
  const id = useSearchParams().get("id");
  const [state, setState] = useState<State>({ kind: "loading" });

  const open = useCallback(async (record: LocalProjectRecord) => {
    try {
      const project = await openLocalProject(record);
      const exp = project.file.export;
      const exportUrl = exp ? await localAssetUrl(record.dir, record.id, exp.path).catch(() => null) : null;
      setState({ kind: "ready", backend: localBackend(project, exportUrl) });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof ProjectFileError ? e.message : `The project couldn't open (${(e as Error).message}).`,
      });
    }
  }, []);

  useEffect(() => {
    if (!id) return setState({ kind: "missing" });
    (async () => {
      const record = await getLocalProject(id);
      if (!record) return setState({ kind: "missing" });
      // Browser-stored (phone) projects need no permission; open() explains a cleared one.
      if (record.storage === "browser" || (await projectAccess(record)) === "granted") await open(record);
      else setState({ kind: "needs-access", record });
    })();
  }, [id, open]);

  const back = (
    <Link href="/" className="flex min-h-11 items-center text-[13px] text-ink-dim transition-colors hover:text-lime">
      ← All projects
    </Link>
  );

  switch (state.kind) {
    case "loading":
      return (
        <p role="status" className="flex items-center justify-center gap-3 py-24 text-sm text-ink-dim">
          <LosoMark working size={22} />
          Opening your video…
        </p>
      );
    case "missing":
      return (
        <ErrorState title="This project isn't in this browser" detail="Open it from its folder on the projects page.">
          {back}
        </ErrorState>
      );
    case "error":
      return <ErrorState detail={state.message}>{back}</ErrorState>;
    case "needs-access":
      return (
        <div className="mx-auto flex max-w-md flex-col items-start gap-5 px-5 py-16 sm:px-8 sm:py-24">
          <p className="micro">Permission needed</p>
          <h1 className="font-serif text-[30px] italic leading-tight tracking-tight">{state.record.title}</h1>
          <p className="text-[13.5px] leading-relaxed text-ink-dim">
            This project lives in your folder <span className="text-ink">“{state.record.folderName}”</span>. Your
            browser asks once per visit before Loso can open it.
          </p>
          <Button
            onClick={async () => {
              if (await askProjectAccess(state.record)) open(state.record);
            }}
          >
            <FolderOpen size={15} /> Open “{state.record.folderName}”
          </Button>
          {back}
        </div>
      );
    case "ready":
      return <CompositorEditor key={state.backend.projectId} backend={state.backend} />;
  }
}
