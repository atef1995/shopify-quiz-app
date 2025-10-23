/**
 * Extended type declarations for Shopify UI web components
 * These props are supported at runtime but missing from official types
 */

declare namespace JSX {
  interface IntrinsicElements {
    's-inline-stack': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      gap?: string;
      wrap?: boolean;
      children?: React.ReactNode;
    };
  }
}

declare module '@shopify/ui-extensions-react/admin' {
  export interface TextFieldProps {
    helpText?: string;
    multiline?: boolean;
    rows?: number;
  }

  export interface TextProps {
    variant?: 'headingSm' | 'headingMd' | 'headingLg' | 'bodySm' | 'bodyMd' | 'bodyLg' | 'heading-sm' | 'heading-md' | 'body-sm' | 'body-md';
  }

  export interface ButtonProps {
    size?: 'micro' | 'slim' | 'sm' | 'medium' | 'large';
    variant?: 'primary' | 'secondary' | 'tertiary' | 'plain' | 'auto';
  }

  export interface BannerProps {
    variant?: 'info' | 'success' | 'warning' | 'critical';
  }

  export interface StackProps {
    align?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
    gap?: 'tight' | 'base' | 'loose' | 'extraTight' | string;
  }

  export interface BoxProps {
    background?: 'surface' | 'subdued' | 'success-subdued' | string;
  }

  export interface SelectProps {
    options?: Array<{ label: string; value: string }>;
  }

  export interface PageProps {
    backAction?: { onAction: () => void };
  }
}
