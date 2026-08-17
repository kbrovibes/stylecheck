import { PageTitle } from "@/components/ui";
import Uploader from "@/components/upload/uploader";

export const dynamic = "force-dynamic";

export default function UploadPage() {
  return (
    <div className="fade-up">
      <PageTitle
        eyebrow="Intake"
        title="Upload your"
        accent="closet"
      />
      <p className="-mt-6 mb-10 max-w-xl text-sm leading-relaxed text-ink-faint">
        Drop photos of clothing, shoes, and accessories — laid flat, hung, or on
        a surface. Photos of you (including selfies) are detected automatically
        and added to your profile. Images are compressed on your device before
        upload.
      </p>
      <Uploader />
    </div>
  );
}
