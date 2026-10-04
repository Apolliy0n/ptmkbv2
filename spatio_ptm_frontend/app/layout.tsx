import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Perceptron PTMKB v2.0",
  description: "Next-generation Post-Translational Modification mapping and structural dynamics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 min-h-screen flex flex-col font-sans">
        <Providers>
          {/* Main Content */}
          <main className="flex-grow max-w-screen-2xl mx-auto w-full">
            {children}
          </main>
        </Providers>

        {/* Global PTMKB Footer */}
        <footer className="w-full bg-[#1e293b] text-slate-400 py-8 mt-12 text-sm text-center border-t border-slate-700">
          <div className="max-w-7xl mx-auto px-6 flex flex-col items-center justify-center gap-2">
            <p className="font-semibold text-slate-300">© 2026 Perceptron PTMKB. All rights reserved.</p>
            <p>Developed at the Lahore University of Management Sciences (LUMS).</p>
          </div>
        </footer>
      </body>
    </html>
  );
}