/*
 * The Pepino mark: a cucumber slice — rind, flesh and a ring of eight seeds —
 * cut into a red square. Same geometry as public/favicon.svg and the Android
 * launcher icon (res/drawable/ic_launcher_foreground.xml).
 */
const SEED_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function Seeds({ fill }: { fill: string }) {
  return (
    <>
      {SEED_ANGLES.map((angle) => (
        <ellipse key={angle} cx="24" cy="16.5" rx="1.3" ry="2.6" fill={fill} transform={`rotate(${angle} 24 24)`} />
      ))}
    </>
  );
}

export function PepinoMark({ size = 40, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="48" height="48" fill="var(--primary)" />
      <circle cx="24" cy="24" r="17" fill="var(--bg)" />
      <circle cx="24" cy="24" r="14" fill="var(--fg)" />
      <Seeds fill="var(--bg)" />
    </svg>
  );
}

/** Line-art slice for empty states. */
export function SliceOutline({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <circle cx="24" cy="24" r="21.5" stroke="var(--outline)" strokeWidth="0.75" strokeDasharray="1.5 2.5" />
      <circle cx="24" cy="24" r="17" stroke="var(--fg)" strokeWidth="2" />
      <circle cx="24" cy="24" r="14" stroke="var(--outline)" strokeWidth="0.75" />
      <Seeds fill="var(--primary)" />
    </svg>
  );
}
