"use client";

import { useState, type ReactNode } from "react";
import OwnerIdentity from "./OwnerIdentity";

export type RosterPlayer = {
  player_id: string | null;
  name: string | null;
  position: string | null;
  pro_team: string | null;
  pro_team_name: string | null;
  status_id: string | null;
  roster_position_id: string | null;
  headshot_url: string | null;
};

export type SportRoster = {
  sport: string;
  league_id?: string;
  players: RosterPlayer[];
};

type RosterCardProps = {
  owner: string;
  sports: SportRoster[];
  maxRosterSize?: number;
  children?: ReactNode;
  action?: ReactNode;
};

function getCountStyle(count: number, max: number) {
  const percentage = count / max;

  if (count > max) {
    return "bg-red-100 text-red-800";
  }

  if (percentage >= 0.9) {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-blue-100 text-blue-800";
}

export default function RosterCard({
  owner,
  sports,
  maxRosterSize = 65,
  children,
  action,
}: RosterCardProps) {
  const [expanded, setExpanded] = useState(false);

  const totalPlayers = sports.reduce(
    (total, sport) => total + sport.players.length,
    0
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 p-4 text-left transition hover:bg-blue-50 sm:p-5"
      >
        <div>
          <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
            <OwnerIdentity name={owner} />
          </h2>

          <p className="mt-1 text-sm font-medium text-slate-700">
            {expanded ? "Hide roster" : "View roster"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-sm font-bold ${getCountStyle(
              totalPlayers,
              maxRosterSize
            )}`}
          >
            {totalPlayers} / {maxRosterSize}
          </span>

          <span
            className={`text-xl font-bold text-blue-800 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          >
            â†“
          </span>
        </div>
      </button>
      {action && <div className="px-4 pb-4 sm:px-5">{action}</div>}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-blue-50 px-4 py-3 sm:px-5">
        {sports.map(sport=><span key={sport.sport} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">{sport.sport==="Premier League"?"EPL":sport.sport} <strong className="ml-1 text-blue-950">{sport.players.length}</strong></span>)}
        {totalPlayers>maxRosterSize&&<p className="w-full text-sm font-semibold text-red-800">Over roster limit by {totalPlayers-maxRosterSize} players</p>}
      </div>

      {expanded && (
        <div className="border-t border-blue-100">
          {sports.map((sport) => (
            <section
              key={sport.sport}
              className="border-b border-blue-100 p-4 last:border-b-0 sm:p-5"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-slate-900">
                  {sport.sport}
                </h3>

                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-800">
                  {sport.players.length}
                </span>
              </div>

              {sport.players.length === 0 ? (
                <p className="text-sm font-medium text-slate-600">
                  No players
                </p>
              ) : (
                <div className="divide-y divide-blue-50">
                  {sport.players.map((player, index) => (
                    <div
                      key={
                        player.player_id ??
                        `${sport.sport}-${player.name}-${index}`
                      }
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">
                          {player.name ?? "Unknown Player"}
                        </p>

                        {player.pro_team_name && (
                          <p className="mt-0.5 truncate text-xs text-slate-600">
                            {player.pro_team_name}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {player.position && (
                          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                            {player.position}
                          </span>
                        )}

                        {player.pro_team && (
                          <span className="min-w-10 text-right text-xs font-semibold text-slate-600">
                            {player.pro_team}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
          {children}
        </div>
      )}
    </div>
  );
}
