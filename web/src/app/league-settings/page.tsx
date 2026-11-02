import MainNavigation from '@/components/MainNavigation';
import LeagueSettings from '@/components/LeagueSettings';
import ScoringControls from '@/components/ScoringControls';
export const metadata={title:'League Settings | Multi-Sport Fantasy League'};
export default function LeagueSettingsPage(){return <main className="min-h-screen bg-blue-50 px-4 py-6 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl"><MainNavigation/><h1 className="mb-6 text-3xl font-bold">League Settings</h1><details id="scoring-controls" className="mb-6 rounded-xl border border-blue-100 bg-white p-5 shadow-sm"><summary className="cursor-pointer text-xl font-bold text-blue-900">Scoring Controls</summary><div className="mt-5"><ScoringControls/></div></details><LeagueSettings/></div></main>;}

