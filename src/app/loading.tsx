import { logo } from "@/content/media";
export default function Loading() {
  return (
    <div className="grid min-h-[65vh] place-content-center" role="status">
      <img
        src={logo}
        width={565}
        height={190}
        className="w-60 animate-pulse"
        alt="Loading SOCCERBOTSTUDIO"
      />
    </div>
  );
}
