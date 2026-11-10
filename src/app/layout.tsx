import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Both include Greek glyphs: product names and store texts are often Greek.
const inter = Inter({ subsets: ["latin", "greek"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin", "greek"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: { default: "Restock", template: "%s | Restock" },
  description: "Track product stock at Greek stores and get notified on Discord.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full`}>
      <body className="min-h-full">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
