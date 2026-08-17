import { createClient } from "@/lib/supabase/server";
import { canManage, getActivePerson } from "@/lib/person";
import { PageTitle } from "@/components/ui";
import Uploader from "@/components/upload/uploader";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { person, role } = await getActivePerson(supabase, user);

  return (
    <div className="fade-up">
      <PageTitle
        eyebrow={`Intake — ${person.name}`}
        title="Upload the"
        accent="closet"
      />
      {canManage(role) ? (
        <>
          <p className="-mt-6 mb-10 max-w-xl text-sm leading-relaxed text-ink-faint">
            Everything you add lands in{" "}
            <span className="serif-accent text-camel-deep">{person.name}</span>
            &apos;s wardrobe. Drop photos of clothing, shoes, and accessories —
            laid flat, hung, worn, or on a surface. Photos of {person.name} are
            detected automatically and added to the profile. Images are
            compressed on your device before upload.
          </p>
          <Uploader />
        </>
      ) : (
        <p className="-mt-6 max-w-xl text-sm leading-relaxed text-ink-faint">
          This profile is shared with you as{" "}
          <span className="serif-accent">view only</span> — uploading is
          disabled. Ask the owner for manager access to add pieces.
        </p>
      )}
    </div>
  );
}
