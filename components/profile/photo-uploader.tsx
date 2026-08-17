"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";
import { BUCKET } from "@/lib/storage";

export default function PhotoUploader({ userId }: { userId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const supabase = createClient();
    const paths: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setStatus(`Compressing ${i + 1}/${files.length}…`);
        const compressed = await imageCompression(files[i], {
          maxWidthOrHeight: 1280,
          maxSizeMB: 0.5,
          useWebWorker: true,
          fileType: "image/jpeg",
        });
        const path = `${userId}/profile/${crypto.randomUUID()}.jpg`;
        setStatus(`Uploading ${i + 1}/${files.length}…`);
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(path, compressed, { contentType: "image/jpeg" });
        if (error) throw new Error(error.message);
        paths.push(path);
      }
      setStatus("Detecting who's who…");
      const res = await fetch("/api/profile/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "registration failed");
      setStatus(
        json.problems?.length ? json.problems[0] : `Added ${paths.length} photo${paths.length > 1 ? "s" : ""}.`
      );
      router.refresh();
    } catch (e) {
      setStatus(`Something went wrong: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed hairline bg-paper/60 text-ink-faint transition-colors hover:border-camel/50 hover:text-camel disabled:opacity-50"
      >
        <span className="text-2xl font-light">+</span>
        <span className="text-[12px]">
          {busy ? "Working…" : "Add photos"}
        </span>
      </button>
      {status && (
        <p className="mt-2 text-[12px] leading-snug text-ink-faint">{status}</p>
      )}
    </div>
  );
}
