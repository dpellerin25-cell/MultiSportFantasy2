import Link from "next/link";

type SeasonOption = {
  year: number;
  name: string;
};

type SeasonSelectorProps = {
  seasons: SeasonOption[];
  selectedYear: number;
};

export default function SeasonSelector({
  seasons,
  selectedYear,
}: SeasonSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {seasons.map((season) => {
        const selected = season.year === selectedYear;

        return (
          <Link
            key={season.year}
            href={
              selected
                ? "/"
                : `/?season=${season.year}`
            }
            className={`rounded-full border px-3 py-1.5 text-sm font-bold transition ${
              selected
                ? "border-blue-700 bg-blue-700 text-white"
                : "border-blue-200 bg-white text-blue-800 hover:bg-blue-50"
            }`}
          >
            {season.name}
          </Link>
        );
      })}
    </div>
  );
}
