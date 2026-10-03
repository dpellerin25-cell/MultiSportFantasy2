import MainNavigation from '@/components/MainNavigation';
import LeagueSettings from '@/components/LeagueSettings';
export const metadata={title:'League Settings | Multi-Sport Fantasy League'};
export default function LeagueSettingsPage(){return <main className="min-h-screen bg-blue-50 px-4 py-6 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl"><MainNavigation/><h1 className="mb-6 text-3xl font-bold">League Settings</h1><LeagueSettings/></div></main>;}
