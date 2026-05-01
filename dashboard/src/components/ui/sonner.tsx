import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // The shadcn `--popover` / `--popover-foreground` / `--border` tokens
      // are defined in index.css as bare HSL components (e.g. `0 0% 100%`),
      // not as complete colors. Passing them straight to sonner's
      // `--normal-bg` produces an invalid `background: 0 0% 100%` and the
      // toast falls back to sonner's translucent default, which renders
      // illegibly on top of page content. Wrapping with `hsl(...)` gives an
      // opaque, themed background.
      style={
        {
          "--normal-bg": "hsl(var(--popover))",
          "--normal-text": "hsl(var(--popover-foreground))",
          "--normal-border": "hsl(var(--border))",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
