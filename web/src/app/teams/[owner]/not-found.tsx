import Link from "next/link";

export default function TeamNotFound() {
  return (
    <main className="min-h-screen bg-blue-50 px-4 py-12 text-slate-900 sm:p-12">
      <div className="mx-auto max-w-xl rounded-xl border border-blue-100 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Owner not found</h1>
        <p className="mt-3 text-slate-600">This owner is not in the selected championship standings.</p>
        <Link href="/" className="mt-5 inline-flex min-h-11 items-center font-semibold text-blue-800 hover:underline">
          Back to overall standings
        </Link>
      </div>
    </main>
  );
}
