import type {ReactNode} from 'react';
import Link from 'next/link';
export const metadata={robots:{index:false,follow:false},referrer:'no-referrer'};
export default function AccountLayout({children}:{children:ReactNode}){return <main className="min-h-screen bg-blue-50 px-4 py-10 text-slate-900"><div className="mx-auto max-w-lg rounded-xl border border-blue-100 bg-white p-6 shadow-sm"><Link href="/" className="mb-6 inline-block text-blue-800 underline">← Pentagon Cup</Link>{children}</div></main>;}
