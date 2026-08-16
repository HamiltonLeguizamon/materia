type IconProps = { size?: number; className?: string };
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function WaveMark({ size = 34, className }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 34 34" aria-hidden="true"><path {...base} d="M5 14v6M10 8v18M15 3v28M20 10v14M25 6v22M30 13v8" /></svg>;
}
export function BookIcon({ size = 20 }: IconProps) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path {...base} d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11a2 2 0 0 1 2 2v16a2 2 0 0 0-2-2H7.5A3.5 3.5 0 0 0 4 21.5zM20 5.5A3.5 3.5 0 0 0 16.5 2H15a2 2 0 0 0-2 2v16a2 2 0 0 1 2-2h1.5a3.5 3.5 0 0 1 3.5 3.5z" /></svg>; }
export function PlusIcon({ size = 20 }: IconProps) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle {...base} cx="12" cy="12" r="9"/><path {...base} d="M12 8v8M8 12h8"/></svg>; }
export function PlayIcon({ size = 22 }: IconProps) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path {...base} d="m8 5 11 7-11 7z"/></svg>; }
export function PauseIcon({ size = 22 }: IconProps) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path {...base} d="M9 5v14M15 5v14"/></svg>; }
export function ArrowIcon({ size = 18 }: IconProps) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path {...base} d="m9 18 6-6-6-6"/></svg>; }
export function BackIcon({ size = 18 }: IconProps) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path {...base} d="m15 18-6-6 6-6"/></svg>; }
export function TrashIcon({ size = 18 }: IconProps) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path {...base} d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>; }
export function UploadIcon({ size = 25 }: IconProps) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path {...base} d="M12 16V4m0 0L8 8m4-4 4 4M5 14v5h14v-5"/></svg>; }
export function CheckIcon({ size = 18 }: IconProps) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path {...base} d="m5 12 4 4L19 6"/></svg>; }
