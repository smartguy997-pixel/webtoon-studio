"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, signOut } from "@/hooks/useAuth";
import s from "./NavSidebar.module.css";

const NAV = [
  { href: "/projects", icon: "◈", label: "내 프로젝트" },
  { href: "/settings", icon: "⚙", label: "설정" },
];

export function NavSidebar() {
  const pathname = usePathname();
  const auth = useAuth();

  // Don't show sidebar on login page
  if (pathname === "/login") return null;

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

      {/* User section */}
      <div className={s.userSection}>
        {auth.loading ? (
          <div className={s.userLoading} />
        ) : auth.uid ? (
          <div className={s.userCard}>
            <div className={s.userAvatar}>
              {auth.photoURL ? (
                <img src={auth.photoURL} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <span>{(auth.displayName ?? auth.email ?? "U")[0].toUpperCase()}</span>
              )}
            </div>
            <div className={s.userInfo}>
              <div className={s.userName}>
                {auth.isLocalMode ? "로컬 모드" : (auth.displayName ?? auth.email ?? "사용자")}
              </div>
              <button onClick={signOut} className={s.signOutBtn}>
                로그아웃
              </button>
            </div>
          </div>
        ) : (
          <Link href="/login" className={s.loginBtn}>
            로그인
          </Link>
        )}
      </div>
    </aside>
  );
}
