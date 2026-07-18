import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AmiGo AI — مساعد مبيعاتك",
  description: "أتمتة محادثات المتاجر الجزائرية",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
