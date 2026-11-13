"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui";
import { FetchError, fetchJson } from "@/lib/fetch-json";
import { CompositorEditor } from "@/components/compositor/editor";
import { serverBackend } from "@/components/compositor/server-backend";
import { LosoMark } from "@/components/logo";
import type { CompositorDoc } from "@/lib/compositor";

// The dev-server editor: /project/<id> opens a project stored in the local
// SQLite database. Only compositor projects open here. Older projects from the
// retired script-to-voiceover pipeline stay in the database untouched, but
// Loso doesn't open them any more.

interface RawProject {
  id: string;
  title: string;
  updatedAt: number;
  settings: { kind?: string; compositor?: CompositorDoc };
  artifacts: { render?: { url: string; renderedAt: number } };
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<RawProject | null>(null);
  const [failure, setFailure] = useState<{ notFound: boolean; message: string } | null>(null);

  const load = useCallback(() => {
    setFailure(null);
    fetchJson<{ project: RawProject }>(`/api/projects/${id}`)
      .then((d) => setProject(d.project))
      .catch((e: FetchError) => setFailure({ notFound: e.status === 404, message: e.message }));
  }, [id]);

  useEffect(load, [load]);

  const back = (
    <Link href="/" className="text-[13px] text-ink-dim transition-colors hover:text-lime">
      ← All projects
    </Link>
  );

  if (failure) {
    return failure.notFound ? (
      <ErrorState title="This project no longer exists" detail="It may have been deleted, or the link is mistyped.">
        {back}
      </ErrorState>
    ) : (
      <ErrorState detail={`The project couldn't load (${failure.message}).`} onRetry={load}>
        {back}
      </ErrorState>
    );
  }
  if (!project) {
    return (
      <p role="status" className="flex items-center justify-center gap-3 py-24 text-sm text-ink-dim">
        <LosoMark working size={22} />
        Opening your video…
      </p>
    );
  }
  if (project.settings?.kind !== "compositor") {
    return (
      <ErrorState
        title="Loso can't open this one"
        detail="It was made with an older version of Loso that turned scripts into voiceovers. That kind of project isn't supported any more. It's still saved, so nothing is lost."
      >
        {back}
      </ErrorState>
    );
  }
  return <CompositorEditor backend={serverBackend(project)} />;
}
