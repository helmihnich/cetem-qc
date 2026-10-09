import type { SVGProps } from "react";

const paths = {
  tasks: "M9 5h10M9 12h10M9 19h10M4.5 5.5l1 1 2-2M4.5 12.5l1 1 2-2M4.5 19.5l1 1 2-2",
  plus: "M12 5v14M5 12h14",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7.5V12l3 2",
  team: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.25 3.25 0 0 1 0 6.1",
  logout: "M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  shield: "M12 3l7 3v5.5c0 4.4-3 8.1-7 9.5-4-1.4-7-5.1-7-9.5V6l7-3zM9 12l2 2 4-4",
  inbox: "M4 13h4l1.5 2.5h5L16 13h4M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2.5-8z",
  alert: "M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  copy: "M9 9h10v10H9zM5 15V5h10",
} as const;

export type IconName = keyof typeof paths;

/** Stroke icons drawn inline so the shell needs no icon library. */
export function Icon({ name, size = 18, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <path d={paths[name]} />
  </svg>;
}

/** A long identifier shown as its first block; assistive technology and copy/paste still get the full value. */
export function ShortId({ id }: { id: string }) {
  if (id.length <= 12) return <>{id}</>;
  return <><span className="short-id" aria-hidden="true">#{id.slice(0, 8)}</span><span className="visually-hidden">{id}</span></>;
}

export function BrandMark({ size = 36 }: { size?: number }) {
  return <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
    <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5.5c0 4.4-3 8.1-7 9.5-4-1.4-7-5.1-7-9.5V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  </span>;
}
