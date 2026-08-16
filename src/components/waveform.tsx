export function Waveform({ active = 10, bars = 44 }: { active?: number; bars?: number }) {
  return <div className="waveform" aria-hidden="true">{Array.from({ length: bars }, (_, index) => {
    const height = 7 + ((index * 13 + index * index) % 24);
    return <i key={index} className={index < active ? "is-active" : ""} style={{ height }} />;
  })}</div>;
}
