import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto min-h-[55vh] max-w-xl px-6 py-20 text-center">
      <h1 className="page-title">Page not found</h1>
      <p className="my-6 text-muted">
        The page you’re looking for isn’t available.
      </p>
      <Link href="/" className="button">
        Back to home
      </Link>
    </div>
  );
}
