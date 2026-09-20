"use client";

import { useRouter } from "next/navigation";

type SeasonOption = {
  year: number;
  name: string;
};

type SeasonSelectorProps = {
  seasons: SeasonOption[];
  selectedYear: number;
  basePath?: string;
};

export default function SeasonSelector({
  seasons,
  selectedYear,
  basePath = "/",
}: SeasonSelectorProps) {
  const router = useRouter();

  function handleChange(
    event: React.ChangeEvent<HTMLSelectElement>
  ) {
    const year = event.target.value;

    router.push(`${basePath}?season=${year}`);
  }

  return (
    <div className="inline-flex items-center gap-2">
      <label
        htmlFor="season-selector"
        className="text-sm font-semibold text-slate-700"
      >
        Season
      </label>

      <select
        id="season-selector"
        value={selectedYear}
        onChange={handleChange}
        className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-blue-800 shadow-sm outline-none transition hover:border-blue-300 focus:border-blue-500"
      >
        {[...seasons]
          .sort((a, b) => b.year - a.year)
          .map((season) => (
            <option
              key={season.year}
              value={season.year}
            >
              {season.name}
            </option>
          ))}
      </select>
    </div>
  );
}
