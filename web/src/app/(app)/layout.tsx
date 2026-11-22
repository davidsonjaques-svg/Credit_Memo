import { Header } from "@/components/header";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col gap-7 px-4 py-8 sm:px-8">
        {children}
      </main>
    </div>
  );
}
