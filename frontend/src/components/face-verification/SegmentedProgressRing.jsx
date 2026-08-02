import { Check } from "lucide-react";

const SEGMENT_COUNT = 60;
const RADIUS = 92;
const CENTER = 110;
const SEGMENT_LENGTH = 10;
const STROKE_WIDTH = 8;

function polarToCartesian(angleDegrees, radius = RADIUS) {
  const angle = (angleDegrees - 90) * Math.PI / 180;
  return {
    x: CENTER + radius * Math.cos(angle),
    y: CENTER + radius * Math.sin(angle)
  };
}

function segmentPath(index) {
  const step = 360 / SEGMENT_COUNT;
  const start = polarToCartesian((index * step) + 1.4);
  const end = polarToCartesian((index * step) + SEGMENT_LENGTH);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${RADIUS} ${RADIUS} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export default function SegmentedProgressRing({ progress = 0, currentTargetProgress = 0, complete = false, error = false }) {
  const completedSegments = Math.floor(Math.max(0, Math.min(1, progress)) * SEGMENT_COUNT);
  const currentSegment = Math.min(SEGMENT_COUNT - 1, Math.max(0, Math.floor(Math.max(progress, currentTargetProgress) * SEGMENT_COUNT)));

  return (
    <svg className={`retela-scan-ring${complete ? " is-complete" : ""}${error ? " is-error" : ""}`} viewBox="0 0 220 220" aria-hidden="true">
      {Array.from({ length: SEGMENT_COUNT }).map((_, index) => {
        const segmentClass = [
          "retela-scan-ring-segment",
          index < completedSegments ? "is-done" : "",
          !complete && index === currentSegment ? "is-current" : ""
        ].filter(Boolean).join(" ");
        return (
          <path
            key={index}
            className={segmentClass}
            d={segmentPath(index)}
            pathLength="1"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
          />
        );
      })}
      {complete ? (
        <g className="retela-scan-check">
          <circle cx="110" cy="110" r="34" />
          <foreignObject x="82" y="82" width="56" height="56">
            <div className="retela-scan-check-icon">
              <Check size={38} />
            </div>
          </foreignObject>
        </g>
      ) : null}
    </svg>
  );
}
