import type { SVGProps } from 'react';

/*
 * Pepino's icon set: 24px grid, 2px square strokes, no curves except where
 * the object is round. Icons inherit currentColor and are decorative by
 * default; the button around them carries the accessible label.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden
      focusable={false}
      {...props}
    >
      {children}
    </svg>
  );
}

export const FolderIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 5h7l2 3h9v11H3z" />
  </Icon>
);

export const BackIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 12H5M11 5l-7 7 7 7" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4v16M4 12h16" />
  </Icon>
);

export const SortIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />
  </Icon>
);

export const MoreIcon = (props: IconProps) => (
  <Icon {...props} fill="currentColor" stroke="none">
    <rect x="10" y="3" width="4" height="4" />
    <rect x="10" y="10" width="4" height="4" />
    <rect x="10" y="17" width="4" height="4" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 5l14 14M19 5L5 19" />
  </Icon>
);

export const PromptIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6l6 6-6 6M12 19h8" />
  </Icon>
);

export const BranchIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="3" width="4" height="4" />
    <rect x="4" y="17" width="4" height="4" />
    <rect x="16" y="7" width="4" height="4" />
    <path d="M6 7v10M18 11v1a3 3 0 0 1-3 3H6" />
  </Icon>
);

export const SlidersIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
    <rect x="14" y="4" width="4" height="4" />
    <rect x="8" y="10" width="4" height="4" />
    <rect x="16" y="16" width="4" height="4" />
  </Icon>
);
