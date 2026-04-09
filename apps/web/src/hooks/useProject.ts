import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Project } from "@webtoon-studio/shared";

export function useProject(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }
    const ref = doc(db, "projects", projectId);
    const unsubscribe = onSnapshot(ref, (snap: { exists: () => boolean; data: () => unknown }) => {
      setProject(snap.exists() ? (snap.data() as Project) : null);
      setLoading(false);
    });
    return unsubscribe;
  }, [projectId]);

  return { project, loading };
}
