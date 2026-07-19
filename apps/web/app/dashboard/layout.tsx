import { Sidebar } from "@/components/sidebar";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="min-h-screen px-4 pb-28 pt-6 sm:px-8 sm:pt-8 lg:mr-72 lg:px-10 lg:pb-12">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
