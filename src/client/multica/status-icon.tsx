/** Multica 状态图形，使用 DSH 任务阶段。 */
import type {ReactNode} from "react";
import type {TaskStage} from "../../app/task-model.ts";
const CX = 7;
const CY = 7;
const OUTER_R = 6;
const FILL_R = 3.5;


function piePath(cx: number, cy: number, r: number, progress: number): string {
  const angle = 2 * Math.PI * progress;
  const endX = cx + r * Math.sin(angle);
  const endY = cy - r * Math.cos(angle);
  const largeArc = progress > 0.5 ? 1 : 0;
  return `M${cx},${cy} L${cx},${cy - r} A${r},${r} 0 ${largeArc},1 ${endX},${endY} Z`;
}

function ProgressCircle({
  progress,
  children,
}: {
  progress: number;
  children?: ReactNode;
}) {
  return (
    <>
      {}
      <circle
        cx={CX}
        cy={CY}
        r={OUTER_R}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeDasharray="3.14 0"
        strokeDashoffset={-0.7}
      />
      {}
      {progress === 1 ? (
        <circle cx={CX} cy={CY} r={OUTER_R} fill="currentColor" />
      ) : progress > 0 ? (
        <path d={piePath(CX, CY, FILL_R, progress)} fill="currentColor" />
      ) : null}
      {children}
    </>
  );
}


function BacklogIcon() {
  const count = 16;
  const dotR = 0.55;
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={i}
            cx={CX + OUTER_R * Math.cos(angle)}
            cy={CY + OUTER_R * Math.sin(angle)}
            r={dotR}
            fill="currentColor"
          />
        );
      })}
    </g>
  );
}

function TodoIcon() {
  return <ProgressCircle progress={0} />;
}

function InProgressIcon() {
  return <ProgressCircle progress={0.5} />;
}

function InReviewIcon() {
  return <ProgressCircle progress={0.75} />;
}

function PendingReleaseIcon() {
  return <ProgressCircle progress={0.875} />;
}

function DoneIcon() {
  return (
    <ProgressCircle progress={1}>
      <path
        d="M10.951 4.24896C11.283 4.58091 11.283 5.11909 10.951 5.45104L5.95104 10.451C5.61909 10.783 5.0809 10.783 4.74896 10.451L2.74896 8.45104C2.41701 8.11909 2.41701 7.5809 2.74896 7.24896C3.0809 6.91701 3.61909 6.91701 3.95104 7.24896L5.35 8.64792L9.74896 4.24896C10.0809 3.91701 10.6191 3.91701 10.951 4.24896Z"
        fill="white"
        stroke="none"
      />
    </ProgressCircle>
  );
}


function BlockedIcon() {
  return (
    <ProgressCircle progress={0}>
      <line
        x1={CX + FILL_R * Math.cos(Math.PI * 0.75)}
        y1={CY - FILL_R * Math.sin(Math.PI * 0.75)}
        x2={CX + FILL_R * Math.cos(-Math.PI * 0.25)}
        y2={CY - FILL_R * Math.sin(-Math.PI * 0.25)}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </ProgressCircle>
  );
}

function CancelledIcon() {
  return (
    <ProgressCircle progress={0}>
      <path
        d="M5 5 L9 9 M9 5 L5 9"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </ProgressCircle>
  );
}

const STATUS_RENDERERS = {draft:BacklogIcon, queued:TodoIcon, working:InProgressIcon, waiting:BlockedIcon, review:InReviewIcon, done:DoneIcon, cancelled:CancelledIcon};
export function StatusIcon({stage,className=""}:{stage:TaskStage;className?:string}){const Render=STATUS_RENDERERS[stage];return <svg viewBox="0 0 14 14" fill="none" aria-hidden="true" className={`size-3.5 shrink-0 st-status-${stage} ${className}`}><Render/></svg>}
