"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Stage, Text } from "react-konva";
import { EventoSala, Silla, normalizeReservas } from "@/lib/dinner-room";

type DinnerRoomCanvasProps = {
  evento: EventoSala;
  selectedSillaId: string | null;
  currentAsistenteId: string;
  selectionLocked: boolean;
  onSelectSilla: (sillaId: string | null) => void;
};

const BASE_WIDTH = 760;
const BASE_HEIGHT = 420;
const TABLE_RADIUS = 58;
const CHAIR_DISTANCE = 104;
const CHAIR_RADIUS = 18;
const MOBILE_HIT_RADIUS = 30;

function getChairColor(
  silla: Silla,
  selectedSillaId: string | null,
  currentAsistenteId: string,
) {
  const reservas = normalizeReservas(silla.reservas);
  const reservaActual = reservas[0];

  if (selectedSillaId === silla.id) {
    return "#facc15";
  }

  if (reservaActual?.asistente_id === currentAsistenteId) {
    return "#0ea5e9";
  }

  if (reservaActual) {
    return "#ef4444";
  }

  return "#22c55e";
}

export default function DinnerRoomCanvas({
  evento,
  selectedSillaId,
  currentAsistenteId,
  selectionLocked,
  onSelectSilla,
}: DinnerRoomCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(BASE_WIDTH);

  useEffect(() => {
    function updateStageSize() {
      const nextWidth = containerRef.current?.clientWidth ?? BASE_WIDTH;
      setStageWidth(Math.max(320, Math.min(nextWidth, 920)));
    }

    updateStageSize();
    window.addEventListener("resize", updateStageSize);

    return () => {
      window.removeEventListener("resize", updateStageSize);
    };
  }, []);

  const scale = stageWidth / BASE_WIDTH;
  const stageHeight = BASE_HEIGHT * scale;

  const mesas = useMemo(
    () => [...evento.mesas].sort((a, b) => a.numero - b.numero),
    [evento.mesas],
  );

  function handleChairSelection(
    sillaId: string,
    sillaOcupada: boolean,
    sillaEsDelAsistente: boolean,
  ) {
    if (selectionLocked || sillaOcupada || sillaEsDelAsistente) {
      return;
    }

    onSelectSilla(selectedSillaId === sillaId ? null : sillaId);
  }

  return (
    <div
      ref={containerRef}
      className="overflow-hidden rounded-[28px] border border-stone-200 bg-[linear-gradient(180deg,_#fff,_#fafaf9)] [touch-action:manipulation]"
    >
      <Stage width={stageWidth} height={stageHeight}>
        <Layer>
          <Text
            x={24 * scale}
            y={18 * scale}
            text={`${evento.nombre} - ${evento.fecha}`}
            fontSize={18 * scale}
            fill="#44403c"
            fontStyle="600"
          />

          {mesas.map((mesa) => {
            const mesaX = mesa.pos_x * scale;
            const mesaY = mesa.pos_y * scale;
            const tableRadius = TABLE_RADIUS * scale;
            const chairDistance = CHAIR_DISTANCE * scale;
            const chairRadius = CHAIR_RADIUS * scale;

            return (
              <Group key={mesa.id}>
                <Circle
                  x={mesaX}
                  y={mesaY}
                  radius={tableRadius}
                  fill="#292524"
                  shadowColor="#000000"
                  shadowBlur={18 * scale}
                  shadowOpacity={0.12}
                />
                <Text
                  x={mesaX - 28 * scale}
                  y={mesaY - 12 * scale}
                  width={56 * scale}
                  align="center"
                  text={`Mesa ${mesa.numero}`}
                  fontSize={14 * scale}
                  fill="#fefce8"
                />

                {mesa.sillas.map((silla, index) => {
                  const reservas = normalizeReservas(silla.reservas);
                  const angle =
                    -Math.PI / 2 + (index * (Math.PI * 2)) / mesa.sillas.length;
                  const sillaX = mesaX + Math.cos(angle) * chairDistance;
                  const sillaY = mesaY + Math.sin(angle) * chairDistance;
                  const sillaOcupada = reservas.length > 0;
                  const sillaEsDelAsistente =
                    reservas[0]?.asistente_id === currentAsistenteId;
                  const sillaColor = getChairColor(
                    silla,
                    selectedSillaId,
                    currentAsistenteId,
                  );

                  return (
                    <Group
                      key={silla.id}
                      onClick={() =>
                        handleChairSelection(
                          silla.id,
                          sillaOcupada,
                          sillaEsDelAsistente,
                        )
                      }
                      onTap={() =>
                        handleChairSelection(
                          silla.id,
                          sillaOcupada,
                          sillaEsDelAsistente,
                        )
                      }
                    >
                      <Circle
                        x={sillaX}
                        y={sillaY}
                        radius={Math.max(chairRadius, MOBILE_HIT_RADIUS * scale)}
                        fill="rgba(0,0,0,0.001)"
                      />
                      <Circle
                        x={sillaX}
                        y={sillaY}
                        radius={chairRadius}
                        fill={sillaColor}
                        stroke={
                          selectedSillaId === silla.id ? "#a16207" : "#ffffff"
                        }
                        strokeWidth={selectedSillaId === silla.id ? 4 : 2}
                        shadowColor="#000000"
                        shadowBlur={10 * scale}
                        shadowOpacity={0.12}
                        listening={false}
                      />
                      <Text
                        x={sillaX - 10 * scale}
                        y={sillaY - 8 * scale}
                        width={20 * scale}
                        align="center"
                        text={String(silla.numero)}
                        fontSize={12 * scale}
                        fill="#111827"
                        listening={false}
                      />
                    </Group>
                  );
                })}
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
