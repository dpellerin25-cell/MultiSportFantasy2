import MainNavigation from '@/components/MainNavigation';
import ScoringControls from '@/components/ScoringControls';
export const metadata={title:'Scoring Controls | Pentagon Cup'};
export default function ScoringControlsPage(){return <main className="min-h-screen bg-blue-50 px-4 py-6 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl"><MainNavigation/><h1 className="mb-3 text-3xl font-bold">Scoring Controls</h1><p className="mb-6 text-slate-600">Commissioner controls for roster-overage penalties. Published standings are unchanged by this page.</p><ScoringControls/></div></main>;}
