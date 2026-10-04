import Link from "next/link";
import { studioMedia } from "@/content/media";
import { Icon } from "@/components/icon";
export const metadata = { title: "The studio" };
export default function Studio() {
  return (
    <section className="bg-navy text-white">
      <h1 className="sr-only">SOCCERBOTSTUDIO Singapore</h1>
      <p className="border-y border-[#26374f] py-4 text-center text-xs tracking-[.23em] text-[#b5ccd8] uppercase">
        Performance · Experience · Production
      </p>
      {studioMedia.map((photo, index) => (
        <section
          key={photo.src}
          className="grid overflow-hidden border-b border-white/10 md:min-h-[470px] md:grid-cols-2"
        >
          <figure
            className={`min-h-64 overflow-hidden md:row-start-1 ${index % 2 ? "md:col-start-2" : ""}`}
          >
            <img
              src={photo.src}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              loading={index ? "lazy" : "eager"}
              className="h-full max-h-[650px] min-h-64 w-full object-cover"
              style={{ transform: `scale(${photo.zoom || 1})` }}
            />
          </figure>
          <div
            className={`flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-20 ${index % 2 ? "md:col-start-1 md:row-start-1" : ""}`}
          >
            <h2 className="text-4xl lg:text-5xl">{photo.title}</h2>
            <p className="mt-6 max-w-xl text-slate-300">{photo.description}</p>
          </div>
        </section>
      ))}
      <div className="px-6 py-14 text-center">
        <Link className="button min-w-60" href="/book/account/">
          Book now <Icon name="arrow" />
        </Link>
        <p className="mt-6 text-xs text-slate-400">
          Global studio imagery and technology:{" "}
          <a
            href="https://soccerbot360.com/en/produkt"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            official product information
          </a>
          .
        </p>
      </div>
    </section>
  );
}
