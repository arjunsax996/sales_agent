import Spinner from "./Spinner";

export default function Loading() {
  return (
    <main className="mx-auto flex max-w-[1400px] items-center justify-center px-6 py-24">
      <Spinner className="h-8 w-8" style={{ color: "var(--text-muted)" }} />
    </main>
  );
}
