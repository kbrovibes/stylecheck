import type { Metadata } from "next";
import Watch from "@/components/Watch";
import { getJob } from "@/lib/jobs/store";

type Props = { params: Promise<{ id: string }> };

/** Link previews (WhatsApp, iMessage, Slack): poster, players, score and top speed. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const job = await getJob((await params).id).catch(() => null);
  if (!job) return { title: "RallyVision" };
  const s = job.summary;
  const title = s ? `${s.nearLabel} vs ${s.farLabel} · ${s.scoreNear}–${s.scoreFar}` : job.source.name;
  const description = s ? `${s.rallies} rallies · ${s.shots} shots${s.topSpeedKmh ? ` · top shot ~${s.topSpeedKmh} km/h` : ""} · RallyVision` : "Badminton analysis on RallyVision";
  const images = job.output?.posterUrl ? [{ url: job.output.posterUrl, width: job.output.width, height: job.output.height }] : undefined;
  return {
    title: `${title} — RallyVision`,
    description,
    openGraph: { title, description, images, type: "video.other", ...(job.output ? { videos: [{ url: job.output.videoUrl, width: job.output.width, height: job.output.height, type: "video/mp4" }] } : {}) },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images: images?.map((i) => i.url) },
  };
}

export default async function Page({ params }: Props) {
  return <Watch id={(await params).id} />;
}
