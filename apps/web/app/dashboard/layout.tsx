import { Sidebar } from "@/components/sidebar";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Sidebar />
      <main className="min-h-screen px-4 pb-28 pt-8 sm:px-8 lg:mr-72 lg:px-10">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
