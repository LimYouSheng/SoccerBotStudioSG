import Link from "next/link";
import { Arena } from "@/components/arena";
import { Icon } from "@/components/icon";
import { homeMedia } from "@/content/media";
import { SERVICE_NAME } from "@/domain/catalog";
export default function Home() {
  return (
    <>
      <Arena />
      <div className="bg-navy text-slate-200">
        <div className="mx-auto flex max-w-[1160px] flex-wrap justify-center gap-8 border-t border-white/10 px-5 py-5 text-sm sm:gap-20">
          <span className="flex items-center gap-3">
            <Icon name="clock" />
            40-minute sessions
          </span>
          <span className="flex items-center gap-3">
            <Icon name="users" />
            Up to 4 players
          </span>
        </div>
      </div>
      <section className="bg-navy px-5 py-12 text-white sm:px-10 sm:py-20">
        <div className="mx-auto grid max-w-[1160px] items-center gap-9 md:grid-cols-2 md:gap-16">
          <img
            src={homeMedia.studio.src}
            alt={homeMedia.studio.alt}
            width={1080}
            height={608}
            className="aspect-[16/10] w-full rounded-xl object-cover"
            loading="lazy"
          />
          <div>
            <h2 className="text-4xl sm:text-5xl">Inside the studio</h2>
            <p className="my-6 max-w-lg text-slate-300">
              Interactive projections surround the turf, bringing targets and
              football scenarios into the arena. Every session includes full
              instructor guidance for your group.
            </p>
            <Link href="/studio/" className="button">
              Explore the studio <Icon name="arrow" />
            </Link>
            <p className="mt-5 text-xs text-slate-400">
              Imagery:{" "}
              <a
                href="https://soccerbot360.com/en"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                SOCCERBOT360 global studios
              </a>
              .
            </p>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-[1240px] px-5 py-14 sm:px-10 sm:py-20">
        <h2 className="text-4xl">Book a session</h2>
        <p className="mt-3 text-muted">Full instructor guidance included.</p>
        <Link
          href="/book/account/"
          className="mt-8 grid overflow-hidden rounded-xl border border-line bg-white transition-shadow hover:shadow-lg md:grid-cols-2"
        >
          <div className="overflow-hidden">
            <img
              src={homeMedia.kickoff.src}
              alt={homeMedia.kickoff.alt}
              width={1920}
              height={890}
              className="h-full min-h-60 w-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="p-7 sm:p-10">
            <h3 className="text-2xl font-bold italic">{SERVICE_NAME}</h3>
            <p className="my-5 text-muted">
              A 40-minute studio session for up to four players. Explore Single,
              Team and Battle play in the immersive arena, with an instructor
              guiding your group throughout.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <span className="text-sm">40 minutes · 1–4 players</span>
              <strong>S$88 / session</strong>
            </div>
          </div>
        </Link>
      </section>
      <Link
        href="/enquiry/"
        className="flex items-center justify-between gap-6 bg-[#e5edf1] px-6 py-10 sm:px-[max(40px,calc((100vw-1160px)/2))]"
      >
        <div>
          <h2 className="text-3xl sm:text-4xl">Contact us</h2>
          <p className="mt-3 max-w-2xl text-sm text-muted">
            For Multi-Session Bundles, Membership, Academy, Corporate and
            Sponsorship Rates
          </p>
        </div>
        <Icon name="arrow" className="h-8 w-8" />
      </Link>
    </>
  );
}
