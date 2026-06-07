/**
 * EmptyState — centered placeholder for empty lists/views. Optional icon,
 * title, description, and an action slot (e.g. a Button).
 */

import type { HTMLAttributes, ReactNode } from "react";
import { Stack } from "../primitives.js";
import { tokens } from "../tokens.js";
import { Heading, Text } from "../typography.js";

interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action, style, ...rest }: EmptyStateProps) {
  return (
    <Stack
      align="center"
      gap="0.5rem"
      style={{
        textAlign: "center",
        padding: "4rem 1.5rem",
        color: tokens.fgMuted,
        ...style,
      }}
      {...rest}
    >
      {icon ? <div style={{ color: tokens.fgFaint, marginBottom: "0.25rem" }}>{icon}</div> : null}
      {title ? <Heading size="sm">{title}</Heading> : null}
      {description ? (
        <Text size="sm" tone="muted" style={{ maxWidth: 360 }}>
          {description}
        </Text>
      ) : null}
      {action ? <div style={{ marginTop: "0.75rem" }}>{action}</div> : null}
    </Stack>
  );
}
