"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Standings" },
  { href: "/sports", label: "Sports" },
  { href: "/rosters", label: "Rosters" },
  { href: "/scoring", label: "Scoring" },
  { href: "/trophy-case", label: "Trophy Case" },
];

export default function MainNavigation({ standingsHref = "/" }: { standingsHref?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="mb-8 flex flex-wrap items-center gap-2 border-b border-blue-200 pb-4">
      {links.map(({ href, label }) => {
        const active = href === "/"
          ? pathname === "/" || pathname.startsWith("/teams/")
          : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href === "/" ? standingsHref : href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:px-4 sm:text-base ${
              active
                ? "bg-blue-800 text-white shadow-sm hover:bg-blue-900"
                : "text-blue-800 hover:bg-blue-100 hover:text-blue-900"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
