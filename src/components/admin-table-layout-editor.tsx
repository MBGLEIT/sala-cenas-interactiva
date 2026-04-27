"use client";

import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";

import { Mesa } from "@/lib/dinner-room";

type AdminTableLayoutEditorProps = {
  mesas: Mesa[];
  selectedMesaId: string;
  onSelectMesa: (mesaId: string) => void;
  onMoveMesa: (mesaId: string, posX: number, posY: number) => Promise<void>;
  disabled?: boolean;
};

const VIEWBOX_WIDTH = 760;
const VIEWBOX_HEIGHT = 420;
const TABLE_RADIUS = 38;
const CHAIR_DISTANCE = 66;
const CHAIR_RADIUS = 9;

type Position = {
  pos_x: number;
  pos_y: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export default function AdminTableLayoutEditor({
  mesas,
  selectedMesaId,
  onSelectMesa,
  onMoveMesa,
  disabled = false,
}: AdminTableLayoutEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeMesaId, setActiveMesaId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, Position>>({});

  useEffect(() => {
    const nextPositions = Object.fromEntries(
      mesas.map((mesa) => [
        mesa.id,
        {
          pos_x: mesa.pos_x,
          pos_y: mesa.pos_y,
        },
      ]),
    );

    setPositions(nextPositions);
  }, [mesas]);

  const mesaById = useMemo(
    () => new Map(mesas.map((mesa) => [mesa.id, mesa])),
    [mesas],
  );

  function getPointFromEvent(event: PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();

    if (!rect) {
      return null;
    }

    const x = ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * VIEWBOX_HEIGHT;

    return {
      x: clamp(x, TABLE_RADIUS + 8, VIEWBOX_WIDTH - TABLE_RADIUS - 8),
      y: clamp(y, TABLE_RADIUS + 8, VIEWBOX_HEIGHT - TABLE_RADIUS - 8),
    };
  }

  function handlePointerDown(
    event: PointerEvent<SVGCircleElement>,
    mesaId: string,
  ) {
    if (disabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setActiveMesaId(mesaId);
    onSelectMesa(mesaId);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (disabled || !activeMesaId) {
      return;
    }

    const point = getPointFromEvent(event);

    if (!point) {
      return;
    }

    setPositions((current) => ({
      ...current,
      [activeMesaId]: {
        pos_x: Math.round(point.x),
        pos_y: Math.round(point.y),
      },
    }));
  }

  async function commitActiveMesaPosition() {
    if (!activeMesaId) {
      return;
    }

    const position = positions[activeMesaId];

    setActiveMesaId(null);

    if (!position) {
      return;
    }

    await onMoveMesa(activeMesaId, position.pos_x, position.pos_y);
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-stone-200 bg-[linear-gradient(180deg,_#ffffff,_#fafaf9)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
          Editor visual
        </p>
        <p className="text-sm leading-6 text-stone-600">
          Arrastra una mesa para colocarla en la sala.
        </p>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="h-auto w-full rounded-[22px] border border-stone-200 bg-stone-50 [touch-action:none]"
        onPointerMove={handlePointerMove}
        onPointerUp={commitActiveMesaPosition}
        onPointerLeave={commitActiveMesaPosition}
      >
        <rect
          x="0"
          y="0"
          width={VIEWBOX_WIDTH}
          height={VIEWBOX_HEIGHT}
          fill="#fafaf9"
        />

        {mesas.map((mesa) => {
          const currentPosition = positions[mesa.id] ?? {
            pos_x: mesa.pos_x,
            pos_y: mesa.pos_y,
          };
          const isSelected = selectedMesaId === mesa.id;

          return (
            <g key={mesa.id}>
              {mesa.sillas.map((silla, index) => {
                const angle =
                  -Math.PI / 2 + (index * (Math.PI * 2)) / mesa.sillas.length;
                const sillaX = currentPosition.pos_x + Math.cos(angle) * CHAIR_DISTANCE;
                const sillaY = currentPosition.pos_y + Math.sin(angle) * CHAIR_DISTANCE;

                return (
                  <circle
                    key={silla.id}
                    cx={sillaX}
                    cy={sillaY}
                    r={CHAIR_RADIUS}
                    fill="#d6d3d1"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                );
              })}

              <circle
                cx={currentPosition.pos_x}
                cy={currentPosition.pos_y}
                r={TABLE_RADIUS + 10}
                fill="transparent"
                onPointerDown={(event) => handlePointerDown(event, mesa.id)}
              />

              <circle
                cx={currentPosition.pos_x}
                cy={currentPosition.pos_y}
                r={TABLE_RADIUS}
                fill={isSelected ? "#92400e" : "#292524"}
                stroke={isSelected ? "#f59e0b" : "#44403c"}
                strokeWidth={isSelected ? 4 : 2}
                onPointerDown={(event) => handlePointerDown(event, mesa.id)}
              />

              <text
                x={currentPosition.pos_x}
                y={currentPosition.pos_y + 6}
                textAnchor="middle"
                fontSize="16"
                fontWeight="700"
                fill="#fefce8"
                pointerEvents="none"
              >
                {`Mesa ${mesa.numero}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
