import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/branding";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: PRODUCT_NAME,
    template: `%s · ${PRODUCT_NAME}`,
  },
  description: `${PRODUCT_NAME} — AI scriptwriting for YouTube creators`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* Marketing is light; the app group forces its own dark theme (app/(app)/layout.tsx). */}
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">{children}</body>
    </html>
  );
}
