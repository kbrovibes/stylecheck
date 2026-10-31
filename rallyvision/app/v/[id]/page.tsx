import Watch from "@/components/Watch";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Watch id={(await params).id} />;
}
