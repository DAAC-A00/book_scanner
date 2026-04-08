import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "가람고 빛나래 · 장서점검",
  description:
    "동국대학교사범대학부속가람고등학교 도서부 동아리 빛나래 장서점검용 도구입니다. 바코드(숫자)를 찍을 때마다 이 기기에 바로 저장되며, 인터넷이 잠시 끊겨도 기록은 남습니다.",
  manifest: "/manifest.json",
  applicationName: "가람고 빛나래 장서점검",
  appleWebApp: {
    capable: true,
    title: "가람고 빛나래 장서점검",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black text-white">
        {children}
      </body>
    </html>
  );
}
