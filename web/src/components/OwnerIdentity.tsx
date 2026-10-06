export default function OwnerIdentity({name}:{name:string}) {
  const initials=name.trim().split(/\s+/).map(part=>part[0]).slice(0,2).join("").toUpperCase();
  return <span className="inline-flex min-w-0 items-center gap-3"><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-sm font-bold text-blue-800">{initials}</span><span className="truncate font-semibold">{name}</span></span>;
}
