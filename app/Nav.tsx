"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Review" },
  { href: "/quote", label: "New Quote" },
  { href: "/batch", label: "Batch Upload" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b bg-white" style={{ borderColor: "var(--border)" }}>
      <div className="mx-auto flex max-w-[1400px] items-center gap-1 px-6 py-3">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm font-medium"
              style={active ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-muted)" }}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
