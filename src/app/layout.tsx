import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ローカルAI",
  description: "登録済みQAだけを根拠に回答する事業部向けAI",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
