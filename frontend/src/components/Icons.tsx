import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'fill' | 'stroke' | 'viewBox' | 'width' | 'height'> & {
  size?: number;
  strokeWidth?: number;
};

const make = (path: ReactNode) =>
  function Icon({ size = 16, strokeWidth = 1.5, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        {path}
      </svg>
    );
  };

export const Icons = {
  Brain: make(
    <path d="M5 3.5c-1.4 0-2.5 1.1-2.5 2.5 0 .5.2 1 .5 1.4-.6.4-1 1.1-1 1.9 0 1.2.9 2.2 2 2.4M5 3.5c.6-.6 1.4-1 2.3-1 1 0 1.9.5 2.4 1.3M5 3.5v9.4M11 3.5c1.4 0 2.5 1.1 2.5 2.5 0 .5-.2 1-.5 1.4.6.4 1 1.1 1 1.9 0 1.2-.9 2.2-2 2.4M11 3.5c-.6-.6-1.4-1-2.3-1M11 3.5v9.4M5 13c.6.6 1.4 1 2.3 1 1.4 0 2.5-1.1 2.5-2.5M11 13c-.6.6-1.4 1-2.3 1" />,
  ),
  Home: make(<path d="M2.5 7L8 2.5 13.5 7v6.5h-3v-4h-5v4h-3V7z" />),
  Folders: make(<path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5h5.5c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1v-7.5z" />),
  Inbox: make(<path d="M2 9.5h3l1 1.5h4l1-1.5h3M2 9.5L3.5 3.5h9L14 9.5M2 9.5v3c0 .6.4 1 1 1h10c.6 0 1-.4 1-1v-3" />),
  Tag: make(<path d="M2 7V3.5c0-.6.4-1 1-1H7l6.5 6.5L9 13.5 2.5 7zM5 5h.01" />),
  Activity: make(<path d="M1.5 8h2L5 4l3 8 2-6 1.5 2H14.5" />),
  Search: make(
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m13.5 13.5-3-3" />
    </>,
  ),
  Trash: make(<path d="M2.5 4h11M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M3.5 4l.7 8.5c0 .6.4 1 1 1h5.6c.5 0 1-.4 1-1l.7-8.5M6.5 7v4M9.5 7v4" />),
  Pencil: make(<path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" />),
  Plus: make(<path d="M8 3v10M3 8h10" />),
  Doc: make(<path d="M3.5 2.5h6L13 6v7c0 .6-.4 1-1 1H3.5c-.6 0-1-.4-1-1V3.5c0-.6.4-1 1-1zM9 2.5V6h4M5 9h6M5 11h4" />),
  Note: make(
    <>
      <path d="M3 3a1 1 0 0 1 1-1h7l3 3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3z" />
      <path d="M5 6h6M5 9h6M5 12h4" />
    </>,
  ),
  Check: make(<path d="m3 8 3.5 3.5L13 5" />),
  Clock: make(
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </>,
  ),
  Calendar: make(
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </>,
  ),
  Grip: make(
    // Filled dots — override the default fill="none" so the grip
    // reads as solid pegs rather than tiny circle outlines.
    <g fill="currentColor" stroke="none">
      <circle cx="6" cy="4" r="1.1" />
      <circle cx="10" cy="4" r="1.1" />
      <circle cx="6" cy="8" r="1.1" />
      <circle cx="10" cy="8" r="1.1" />
      <circle cx="6" cy="12" r="1.1" />
      <circle cx="10" cy="12" r="1.1" />
    </g>,
  ),
  Chat: make(<path d="M3 11.5V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6.5L3 13.5v-2z" />),
  Cog: make(
    <>
      <path d="M9.4 1.5h-2.8l-.4 1.7c-.5.2-1 .4-1.4.7l-1.6-.7L1.6 5.9l1.3 1.1a5.4 5.4 0 0 0 0 1.6L1.6 9.7l1.6 2.7 1.6-.7c.4.3.9.5 1.4.7l.4 1.7h2.8l.4-1.7c.5-.2 1-.4 1.4-.7l1.6.7 1.6-2.7-1.3-1.1c.05-.5.05-1.1 0-1.6l1.3-1.1-1.6-2.7-1.6.7c-.4-.3-.9-.5-1.4-.7l-.4-1.7z" />
      <circle cx="8" cy="8" r="2.3" />
    </>,
  ),
  Pin: make(<path d="M8 1.5v3M5 4.5h6L9.5 9.5h-3L5 4.5zM8 9.5v5" />),
  Sparkle: make(<path d="M8 2v4M8 10v4M2 8h4M10 8h4M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2" />),
  ChevronRight: make(<path d="m6 3 5 5-5 5" />),
  ChevronDown: make(<path d="m3 6 5 5 5-5" />),
  ChevronLeft: make(<path d="m10 3-5 5 5 5" />),
  ChevronUp: make(<path d="m13 10-5-5-5 5" />),
  ExternalLink: make(<path d="M9.5 2.5h4v4M13.5 2.5 8 8M11.5 8.5v4a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h4" />),
  Download: make(<path d="M8 2v8.5M4.5 7l3.5 3.5L11.5 7M2.5 13h11" />),
  X: make(<path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />),
  More: make(
    <>
      <circle cx="3" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="13" cy="8" r="1" />
    </>,
  ),
  Send: make(
    <>
      <path d="M14 2 2 7l5 2 2 5L14 2zM14 2 7 9" />
    </>,
  ),
  Filter: make(<path d="M2 3h12l-4.5 5.5v4.5L6.5 11V8.5L2 3z" />),
  Sun: make(
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M2 8H.5M15.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1" />
    </>,
  ),
  Moon: make(<path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" />),
  Link: make(<path d="M6.5 9.5 9.5 6.5M5.5 4.5h-1A2.5 2.5 0 0 0 4.5 9.5h1M10.5 11.5h1A2.5 2.5 0 0 0 11.5 6.5h-1" />),
  Upload: make(<path d="M8 10.5V2M5 5l3-3 3 3M2.5 11v1.5c0 .6.4 1 1 1h9c.6 0 1-.4 1-1V11" />),
  Expand: make(
    <path d="M3.5 6V3.5H6M10 3.5h2.5V6M12.5 10v2.5H10M6 12.5H3.5V10" />,
  ),
  Compact: make(
    // Four brackets each pointing INWARD from a viewBox corner — the
    // visual inverse of Expand. Elbows inset 2.5 units from each edge.
    // Previously the top-right segment had its elbow on the corner
    // instead of inset, making the icon look lopsided.
    <path d="M6 3.5V6H3.5M12.5 6H10V3.5M12.5 10H10V12.5M3.5 10H6v2.5" />,
  ),
  Globe: make(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" />
    </>,
  ),
  ArchiveBox: make(<path d="M2 4.5h12V6c0 .3-.2.5-.5.5h-11c-.3 0-.5-.2-.5-.5V4.5zM3 6.5v6c0 .5.4 1 1 1h8c.6 0 1-.5 1-1v-6M6 9h4" />),
  Layers: make(<path d="M8 1.5 1.5 5 8 8.5 14.5 5 8 1.5zM1.5 8 8 11.5 14.5 8M1.5 11 8 14.5 14.5 11" />),
  Hash: make(<path d="M3 6h10M3 10h10M6 2 5 14M11 2l-1 12" />),
  Eye: make(
    <>
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" />
      <circle cx="8" cy="8" r="2" />
    </>,
  ),
  Sidebar: make(
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </>,
  ),
  Bookmark: make(<path d="M3.5 2h9v12L8 11l-4.5 3V2z" />),
  Density: make(<path d="M2 3h12M2 6h12M2 9h12M2 12h12" />),
};
