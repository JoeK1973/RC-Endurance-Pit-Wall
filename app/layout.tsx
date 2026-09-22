import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RC Endurance Pit Wall",
  description: "Race-day pit wall and endurance strategy control system.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
