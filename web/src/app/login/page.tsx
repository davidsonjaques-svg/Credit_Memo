import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-navy px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-lg font-bold tracking-[0.22em] text-white">
            SCALEFORCE <span className="text-gold">CAPITAL</span>
          </p>
          <p className="mt-2 text-sm text-mist">Deal Suite</p>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use the login your admin set up for you.</p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
