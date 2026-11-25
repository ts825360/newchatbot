import Link from "next/link";
import "./brand-logo.css";

export function BrandLogo({ href = "/rooms", label = "행사방 목록" }: { href?: string; label?: string }) {
  return <Link href={href} className="brand-logo" aria-label={label} title="행사비서">
    <svg className="brand-mark" viewBox="0 0 48 48" role="img" aria-label="행사비서 로고">
      <path className="brand-page-back" d="M8 8h15l7 7v25H8a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3Z" />
      <path className="brand-page-front" d="M19 4h16l8 8v25a3 3 0 0 1-3 3H19a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" />
      <path className="brand-fold" d="M35 4v8h8" />
      <path className="brand-cross" d="M28 16v15m-6-9h12" />
      <path className="brand-check" d="m32 37 4 4 8-9" />
    </svg><span>행사비서</span>
  </Link>;
}
