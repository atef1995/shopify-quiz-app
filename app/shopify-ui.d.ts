/**
 * Type declarations for Shopify Polaris web components (s-* tags)
 * 
 * These components are used in Shopify embedded apps and work at runtime,
 * but official types are incomplete. This file provides proper TypeScript support.
 * 
 * Reference: https://shopify.dev/docs/api/app-bridge-library/web-components
 */

import type * as React from "react";

type BaseProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

declare global {
  namespace JSX {
    interface IntrinsicElements {
      's-text': BaseProps & {
        variant?: string;
        color?: string;
        alignment?: string;
        children?: React.ReactNode;
      };
      's-stack': BaseProps & {
        direction?: 'block' | 'inline' | string;
        gap?: string;
        align?: string;
        alignContent?: string;
        alignItems?: string;
        wrap?: boolean;
        children?: React.ReactNode;
      };
      's-inline-stack': BaseProps & {
        gap?: string;
        align?: string;
        wrap?: boolean;
        children?: React.ReactNode;
      };
      's-box': BaseProps & {
        padding?: string;
        paddingBlock?: string;
        paddingInline?: string;
        borderWidth?: string;
        borderRadius?: string;
        background?: string;
        display?: string;
        children?: React.ReactNode;
      };
      's-banner': BaseProps & {
        variant?: string;
        tone?: string;
        children?: React.ReactNode;
      };
      's-badge': BaseProps & {
        variant?: string;
        tone?: string;
        children?: React.ReactNode;
      };
      's-button': BaseProps & {
        variant?: string;
        size?: string;
        type?: string;
        tone?: string;
        target?: string;
        fullWidth?: boolean;
        disabled?: boolean;
        loading?: boolean;
        onClick?: (event: React.MouseEvent) => void;
        children?: React.ReactNode;
      };
      's-icon': BaseProps & {
        source?: string;
        name?: string;
      };
      's-grid': BaseProps & {
        columns?: number | string;
        gap?: string;
        children?: React.ReactNode;
      };
      's-modal': BaseProps & {
        open?: boolean;
        onClose?: () => void;
        primaryAction?: {
          content: string;
          onAction: () => void;
          destructive?: boolean;
        };
        secondaryActions?: Array<{
          content: string;
          onAction: () => void;
        }>;
        children?: React.ReactNode;
      };
      's-page': BaseProps & {
        heading?: string;
        'max-width'?: string;
        backAction?: { url?: string; onAction?: () => void };
        children?: React.ReactNode;
      };
      's-section': BaseProps & {
        heading?: string;
        slot?: string;
        children?: React.ReactNode;
      };
      's-paragraph': BaseProps & {
        children?: React.ReactNode;
      };
      's-text-field': BaseProps & {
        name?: string;
        label?: string;
        value?: string;
        placeholder?: string;
        details?: string;
        helpText?: string;
        multiline?: boolean;
        rows?: number;
        disabled?: boolean;
        required?: boolean;
        requiredIndicator?: boolean;
        autocomplete?: string;
        error?: string;
        onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
      };
      's-select': BaseProps & {
        name?: string;
        label?: string;
        value?: string;
        options?: Array<{ label: string; value: string }>;
        onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
      };
      's-checkbox': BaseProps & {
        name?: string;
        value?: string;
        checked?: boolean;
        label?: string;
        onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
      };
      's-card': BaseProps & {
        title?: string;
        children?: React.ReactNode;
      };
      's-divider': BaseProps;
      's-spinner': BaseProps & {
        size?: string;
      };
      's-resource-item': BaseProps & {
        onClick?: () => void;
        children?: React.ReactNode;
      };
      's-resource-list': BaseProps & {
        children?: React.ReactNode;
      };
      's-empty-state': BaseProps & {
        heading?: string;
        message?: string;
        children?: React.ReactNode;
      };
      's-link': BaseProps & {
        url?: string;
        href?: string;
        target?: string;
        external?: boolean;
        children?: React.ReactNode;
      };
      's-thumbnail': BaseProps & {
        source?: string;
        alt?: string;
        size?: string;
      };
      // List components
      's-ordered-list': BaseProps & {
        children?: React.ReactNode;
      };
      's-unordered-list': BaseProps & {
        children?: React.ReactNode;
      };
      's-list-item': BaseProps & {
        children?: React.ReactNode;
      };
      // Table components
      's-data-table': BaseProps & {
        children?: React.ReactNode;
      };
      's-table': BaseProps & {
        children?: React.ReactNode;
      };
      's-table-head': BaseProps & {
        children?: React.ReactNode;
      };
      's-table-body': BaseProps & {
        children?: React.ReactNode;
      };
      's-table-row': BaseProps & {
        children?: React.ReactNode;
      };
      's-table-header': BaseProps & {
        children?: React.ReactNode;
      };
      's-table-cell': BaseProps & {
        children?: React.ReactNode;
      };
      // Tooltip
      's-tooltip': BaseProps & {
        content?: string;
        children?: React.ReactNode;
      };
      // Heading
      's-heading': BaseProps & {
        children?: React.ReactNode;
      };
    }
  }
}

export {};
