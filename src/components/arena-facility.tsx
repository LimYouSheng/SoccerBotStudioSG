import { FACILITY_EDGES } from "./arena-geometry";
export function ArenaFacility() {
  return (
    <svg
      className="arena-facility"
      viewBox="0 0 1600 700"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="facility-panel-fill" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#284662" stopOpacity=".55" />
          <stop offset=".54" stopColor="#203e59" stopOpacity=".35" />
          <stop offset="1" stopColor="#102741" stopOpacity=".16" />
        </linearGradient>
        <linearGradient id="facility-rail" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#88cad8" stopOpacity=".5" />
          <stop offset="1" stopColor="#577e9d" stopOpacity=".12" />
        </linearGradient>
        <g id="facility-panel-bank">
          {FACILITY_EDGES.slice(0, -1).map(([x, top, bottom], i) => {
            const [next, nt, nb] = FACILITY_EDGES[i + 1];
            return (
              <path
                key={i}
                d={`M${x} ${top}L${next} ${nt}V${nb}L${x} ${bottom}Z`}
                fill="url(#facility-panel-fill)"
                stroke="#7aa9c8"
                strokeOpacity=".27"
                strokeWidth="1"
                opacity={1 - i * 0.105}
              />
            );
          })}
          <path
            d="M-100 70 L65 103 L205 164 L325 231 L425 270 L505 290 L567 302"
            fill="none"
            stroke="url(#facility-rail)"
            strokeWidth="2"
          />
          <path
            d="M-100 622 L65 601 L205 562 L325 510 L425 463 L505 430 L567 408"
            fill="none"
            stroke="url(#facility-rail)"
            strokeWidth="1.5"
          />
          <path
            d="M-100 37L65 78M-100 37L65 103M65 78V103"
            fill="none"
            stroke="#7b9cbd"
            strokeWidth=".8"
            opacity="0.250"
          />
          <path
            d="M65 70L205 139M65 70L205 164M205 139V164"
            fill="none"
            stroke="#7b9cbd"
            strokeWidth=".8"
            opacity="0.225"
          />
          <path
            d="M205 131L325 206M205 131L325 231M325 206V231"
            fill="none"
            stroke="#7b9cbd"
            strokeWidth=".8"
            opacity="0.200"
          />
          <path
            d="M325 198L425 245M325 198L425 270M425 245V270"
            fill="none"
            stroke="#7b9cbd"
            strokeWidth=".8"
            opacity="0.175"
          />
          <path
            d="M425 237L505 265M425 237L505 290M505 265V290"
            fill="none"
            stroke="#7b9cbd"
            strokeWidth=".8"
            opacity="0.150"
          />
          <path
            d="M505 257L567 277M505 257L567 302M567 277V302"
            fill="none"
            stroke="#7b9cbd"
            strokeWidth=".8"
            opacity="0.125"
          />
          <g fill="#79bfd0" opacity=".25">
            <path d="M97 210L168 241V244L97 213Z" />
            <path d="M243 261L302 288V290L243 263Z" />
            <path d="M355 300L395 316V318L355 302Z" />
          </g>
          <path
            d="M-80 667Q248 590 570 423M-80 691Q252 631 589 438"
            fill="none"
            stroke="#47768f"
            strokeWidth="1"
            opacity=".25"
          />
        </g>
      </defs>
      <use href="#facility-panel-bank" />
      <use
        href="#facility-panel-bank"
        transform="translate(1600 0) scale(-1 1)"
      />
    </svg>
  );
}
