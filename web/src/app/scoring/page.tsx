import MainNavigation from "@/components/MainNavigation";
import constitution from "../../../data/constitution.json";

export const metadata = {title: "League Constitution | Multi-Sport Fantasy League"};

export default function ConstitutionPage() {
  return (
    <main className="min-h-screen bg-blue-50 px-4 py-6 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <MainNavigation />
        <header className="mb-6">
          <h1 className="text-3xl font-bold sm:text-4xl">League Constitution</h1>
          <p className="mt-2 text-slate-600">Multi-Sport Fantasy League · Pentagon Cup</p>
        </header>
        <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <nav aria-label="Constitution sections" className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm lg:sticky lg:top-4">
            <h2 className="mb-3 font-bold text-blue-950">On this page</h2>
            <ol className="space-y-1">
              {constitution.map(section => <li key={section.id}><a className="block rounded-lg px-2 py-2 text-sm text-blue-800 hover:bg-blue-50 hover:underline focus-visible:outline-2 focus-visible:outline-blue-700" href={`#${section.id}`}>{section.title}</a></li>)}
            </ol>
          </nav>
          <div className="min-w-0 space-y-6">
            {constitution.map(section => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-6 rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-6">
                <h2 id={`${section.id}-title`} className="mb-4 text-xl font-bold text-blue-950 sm:text-2xl">{section.title}</h2>
                <div className="space-y-4 leading-7 text-slate-700">
                  {section.blocks.map((block, index) => {
                    if (block.kind === "table" && block.rows) return (
                      <div key={index} className="overflow-x-auto rounded-lg border border-blue-100">
                        <table className="w-full text-left text-sm">
                          <caption className="sr-only">{section.title} reference table</caption>
                          <thead className="bg-blue-50 text-blue-950"><tr>{block.rows[0].map((cell, i) => <th key={i} scope="col" className="px-3 py-3 font-semibold">{cell}</th>)}</tr></thead>
                          <tbody>{block.rows.slice(1).map((row, i) => <tr key={i} className="border-t border-blue-100 align-top">{row.map((cell, j) => j === 0 ? <th key={j} scope="row" className="px-3 py-3 font-medium">{cell}</th> : <td key={j} className="min-w-24 whitespace-pre-line px-3 py-3">{cell}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    );
                    if (block.kind === "heading") return <h3 key={index} className="pt-2 text-lg font-bold text-blue-900">{block.text}</h3>;
                    if (block.kind === "equation") return <p key={index} className="rounded-lg bg-blue-50 px-4 py-3 font-semibold text-blue-950">{block.text}</p>;
                    return <p key={index} className="whitespace-pre-line">{block.text}</p>;
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
