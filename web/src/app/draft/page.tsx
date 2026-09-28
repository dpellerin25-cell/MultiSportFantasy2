import MainNavigation from "@/components/MainNavigation";
import DraftRoom from "@/components/draft/DraftRoom";
export const metadata = { title: "Draft Room | Multi-Sport Fantasy League" };
export default function DraftPage() {
  return (
    <main className="min-h-screen bg-blue-50 px-4 py-6 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <MainNavigation />
        <header className="mb-6">
          <p className="font-semibold text-blue-800">
            Multi-Sport Fantasy League
          </p>
          <h1 className="mt-1 text-3xl font-bold sm:text-4xl">Draft Room</h1>
          <p className="mt-2 text-slate-600">
            Five sports. One team. Build your roster, one pick at a time.
          </p>
        </header>
        <DraftRoom />
      </div>
    </main>
  );
}
