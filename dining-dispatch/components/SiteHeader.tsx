"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/restaurants", label: "Index" },
  { href: "/collections", label: "Collections" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="deepstate-header" aria-label="Site navigation">
      <div className="deepstate-header-main">
        <Link href="/" className="deepstate-brand">
          <span className="deepstate-wordmark">THE DINING DISPATCH</span>
        </Link>
        <div className="deepstate-header-controls">
          <nav className="deepstate-nav" aria-label="Primary">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? "is-active" : undefined}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="deepstate-header-status">
            <div className="deepstate-daily-volume">
              <span>CITY</span>
              <strong>MEXICO CITY</strong>
            </div>
            <div className="deepstate-wallet">
              <span />
              V0 INTEL
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
