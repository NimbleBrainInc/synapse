/**
 * Avatar — a circular identity chip. Renders an image when `src` is given,
 * otherwise initials derived from `name` on a subtle tinted background.
 */

import { type HTMLAttributes, useEffect, useState } from "react";
import { tokens } from "../tokens.js";

/** Up to two initials from a name ("Jordan Ratner" → "JR", "mat" → "M"). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  if (parts.length === 1) return first.charAt(0).toUpperCase();
  const last = parts[parts.length - 1] ?? "";
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Name used for initials and the image alt text. */
  name: string;
  /** Optional image URL; falls back to initials when absent or on error. */
  src?: string;
  /** Diameter in px. Default 28. */
  size?: number;
}

export function Avatar({ name, src, size = 28, style, ...rest }: AvatarProps) {
  // Fall back to initials if the image fails to load. Reset on `src` change.
  const [failed, setFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when src changes
  useEffect(() => setFailed(false), [src]);
  const showImage = Boolean(src) && !failed;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        background: tokens.bgSubtle,
        color: tokens.fgMuted,
        fontFamily: tokens.fontSans,
        fontSize: Math.round(size * 0.4),
        fontWeight: tokens.weightSemibold,
        userSelect: "none",
        ...style,
      }}
      {...rest}
    >
      {showImage ? (
        <img
          src={src}
          alt={name}
          width={size}
          height={size}
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
