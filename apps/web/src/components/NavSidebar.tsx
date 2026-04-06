"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import s from "./NavSidebar.module.css";

const NAV = [
  { href: "/projects", icon: "◈", label: "내 프로젝트" },
  { href: "/settings", icon: "⚙", label: "설정" },
];

export function NavSidebar() {
  const pathname = usePathname();

  return (
    <aside className={s.nav}>
      <Link href="/projects" className={s.brand}>
        <span className={s.brandIcon}>✦</span>
        <span className={s.brandText}>AI Webtoon Studio</span>
      </Link>

      <div className={s.items}>
        <div className={s.section}>메뉴</div>
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${s.item} ${active ? s.itemActive : ""}`}
            >
              <span className={s.itemIcon}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className={s.footer}>AI Webtoon Studio v0.1</div>
    </aside>
  );
}
