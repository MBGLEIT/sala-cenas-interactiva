"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  OrthographicCamera,
  OrbitControls,
  PerspectiveCamera,
  RoundedBox,
  Text,
} from "@react-three/drei";

import { EventoSala, Silla, normalizeReservas } from "@/lib/dinner-room";

type DinnerRoomSceneProps = {
  evento: EventoSala;
  selectedSillaId: string | null;
  currentAsistenteId: string;
  selectionLocked: boolean;
  onSelectSilla: (sillaId: string | null) => void;
};

const BASE_WIDTH = 760;
const BASE_HEIGHT = 420;
const ROOM_SCALE = 0.03;
const TABLE_RADIUS = 1.42;
const TABLE_HEIGHT = 0.22;
const CHAIR_DISTANCE = 2.5;
const HIT_RADIUS = 0.72;
type ViewMode = "3d" | "plan";

function browserSupportsWebGL() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const canvas = document.createElement("canvas");

    return Boolean(
      canvas.getContext("webgl2") ||
        canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
}

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

function TableLabel({
  position,
  text,
}: {
  position: [number, number, number];
  text: string;
}) {
  return (
    <Text
      position={position}
      fontSize={0.3}
      color="#fefce8"
      anchorX="center"
      anchorY="middle"
    >
      {text}
    </Text>
  );
}

function BallroomShell() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.78, 0]} receiveShadow>
        <planeGeometry args={[30, 20]} />
        <meshStandardMaterial color="#d8c7a0" roughness={0.95} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.76, 0]} receiveShadow>
        <planeGeometry args={[18, 10]} />
        <meshStandardMaterial color="#7f1d1d" roughness={0.88} metalness={0.08} />
      </mesh>

      <mesh position={[0, 3.2, -8.8]} receiveShadow>
        <boxGeometry args={[30, 8, 0.45]} />
        <meshStandardMaterial color="#f3ece1" roughness={0.92} />
      </mesh>

      <mesh position={[-14.6, 2.7, 0]} receiveShadow>
        <boxGeometry args={[0.45, 7, 18]} />
        <meshStandardMaterial color="#efe7d8" roughness={0.92} />
      </mesh>

      <mesh position={[14.6, 2.7, 0]} receiveShadow>
        <boxGeometry args={[0.45, 7, 18]} />
        <meshStandardMaterial color="#efe7d8" roughness={0.92} />
      </mesh>

      <mesh position={[0, 0.15, -8.45]} receiveShadow>
        <boxGeometry args={[30, 1.6, 0.8]} />
        <meshStandardMaterial color="#5b4636" roughness={0.9} />
      </mesh>

      {[-8.5, 0, 8.5].map((x) => (
        <group key={x} position={[x, 3.2, -8.55]}>
          <mesh>
            <boxGeometry args={[4.4, 3.4, 0.12]} />
            <meshStandardMaterial color="#d1a054" roughness={0.45} metalness={0.55} />
          </mesh>
          <mesh position={[0, 0, 0.09]}>
            <boxGeometry args={[3.7, 2.7, 0.08]} />
            <meshStandardMaterial color="#fff8dc" emissive="#ffe8a3" emissiveIntensity={0.28} />
          </mesh>
        </group>
      ))}

      {[-6, 0, 6].map((x) => (
        <group key={`lamp-${x}`} position={[x, 5.4, -5.4]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.08, 0.08, 1.1, 20]} />
            <meshStandardMaterial color="#b8860b" metalness={0.7} roughness={0.28} />
          </mesh>
          <mesh position={[0, -0.75, 0]}>
            <sphereGeometry args={[0.28, 24, 24]} />
            <meshStandardMaterial color="#fff4c2" emissive="#ffe8a3" emissiveIntensity={0.9} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function TableModel({ number }: { number: number }) {
  return (
    <group>
      <mesh castShadow position={[0, -0.5, 0]}>
        <cylinderGeometry args={[0.14, 0.22, 1.04, 20]} />
        <meshStandardMaterial color="#6b7280" roughness={0.55} metalness={0.45} />
      </mesh>

      <mesh castShadow receiveShadow position={[0, 0.02, 0]}>
        <cylinderGeometry
          args={[TABLE_RADIUS + 0.16, TABLE_RADIUS + 0.16, TABLE_HEIGHT, 56]}
        />
        <meshStandardMaterial color="#f8fafc" roughness={0.96} />
      </mesh>

      <mesh castShadow receiveShadow position={[0, 0.14, 0]}>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.08, 56]} />
        <meshStandardMaterial color="#e7e5e4" roughness={0.92} />
      </mesh>

      <mesh castShadow position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.2, 20]} />
        <meshStandardMaterial color="#d4af37" metalness={0.65} roughness={0.28} />
      </mesh>

      <mesh castShadow position={[0, 0.38, 0]}>
        <sphereGeometry args={[0.09, 20, 20]} />
        <meshStandardMaterial color="#7f1d1d" roughness={0.7} />
      </mesh>

      <TableLabel position={[0, 0.28, 0]} text={`Mesa ${number}`} />
    </group>
  );
}

function ChairModel({
  color,
  number,
  selected,
}: {
  color: string;
  number: number;
  selected: boolean;
}) {
  const frameColor = "#4b5563";

  return (
    <group>
      <RoundedBox
        args={[0.82, 0.12, 0.82]}
        radius={0.08}
        smoothness={4}
        position={[0, 0.12, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={color}
          roughness={0.42}
          metalness={0.12}
          emissive={selected ? "#7c2d12" : "#000000"}
          emissiveIntensity={selected ? 0.24 : 0}
        />
      </RoundedBox>

      <RoundedBox
        args={[0.86, 0.9, 0.16]}
        radius={0.06}
        smoothness={4}
        position={[0, 0.68, -0.3]}
        castShadow
      >
        <meshStandardMaterial color="#f5f5f4" roughness={0.6} metalness={0.06} />
      </RoundedBox>

      <RoundedBox
        args={[0.66, 0.64, 0.08]}
        radius={0.04}
        smoothness={4}
        position={[0, 0.68, -0.19]}
        castShadow
      >
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.08} />
      </RoundedBox>

      {[
        [-0.28, -0.23, -0.28],
        [0.28, -0.23, -0.28],
        [-0.28, -0.23, 0.28],
        [0.28, -0.23, 0.28],
      ].map((position, index) => (
        <mesh key={index} castShadow position={position as [number, number, number]}>
          <cylinderGeometry args={[0.045, 0.055, 0.7, 12]} />
          <meshStandardMaterial color={frameColor} roughness={0.65} metalness={0.22} />
        </mesh>
      ))}

      <Text
        position={[0, 0.19, 0.01]}
        fontSize={0.18}
        color="#111827"
        anchorX="center"
        anchorY="middle"
      >
        {String(number)}
      </Text>
    </group>
  );
}

function EventLabel({ evento }: { evento: EventoSala }) {
  return (
    <Text
      position={[0, 4.75, -8.2]}
      fontSize={0.48}
      color="#3f3f46"
      anchorX="center"
      anchorY="middle"
      maxWidth={14}
    >
      {`${evento.nombre} - ${evento.fecha}`}
    </Text>
  );
}

function PlanFallback({
  evento,
  selectedSillaId,
  currentAsistenteId,
  selectionLocked,
  onSelectSilla,
}: DinnerRoomSceneProps) {
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
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,_#ffffff,_#fafaf9)]">
      <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
            Vista compatible
          </p>
          <p className="mt-1 text-sm text-stone-600">
            Este navegador no admite 3D aqui. Mostramos el plano interactivo.
          </p>
        </div>
        <span className="rounded-full bg-stone-950 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white">
          2D
        </span>
      </div>

      <div className="flex-1 p-4">
        <svg
          viewBox={`0 0 ${BASE_WIDTH} ${BASE_HEIGHT}`}
          className="h-full w-full rounded-[24px] border border-stone-200 bg-stone-50"
        >
          <rect
            x="0"
            y="0"
            width={BASE_WIDTH}
            height={BASE_HEIGHT}
            rx="24"
            fill="#fafaf9"
          />
          <text
            x={BASE_WIDTH / 2}
            y="34"
            textAnchor="middle"
            fontSize="18"
            fontWeight="700"
            fill="#44403c"
          >
            {evento.nombre}
          </text>

          {evento.mesas.map((mesa) => (
            <g key={mesa.id}>
              {mesa.sillas.map((silla, index) => {
                const angle =
                  -Math.PI / 2 + (index * (Math.PI * 2)) / mesa.sillas.length;
                const chairDistance = 68;
                const sillaX = mesa.pos_x + Math.cos(angle) * chairDistance;
                const sillaY = mesa.pos_y + Math.sin(angle) * chairDistance;
                const reservas = normalizeReservas(silla.reservas);
                const sillaOcupada = reservas.length > 0;
                const sillaEsDelAsistente =
                  reservas[0]?.asistente_id === currentAsistenteId;
                const sillaColor = getChairColor(
                  silla,
                  selectedSillaId,
                  currentAsistenteId,
                );

                return (
                  <g key={silla.id}>
                    <circle
                      cx={sillaX}
                      cy={sillaY}
                      r="20"
                      fill="transparent"
                      onClick={() =>
                        handleChairSelection(
                          silla.id,
                          sillaOcupada,
                          sillaEsDelAsistente,
                        )
                      }
                      onPointerUp={() =>
                        handleChairSelection(
                          silla.id,
                          sillaOcupada,
                          sillaEsDelAsistente,
                        )
                      }
                    />
                    <circle
                      cx={sillaX}
                      cy={sillaY}
                      r="14"
                      fill={sillaColor}
                      stroke="#ffffff"
                      strokeWidth="3"
                    />
                    <text
                      x={sillaX}
                      y={sillaY + 4}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="700"
                      fill="#111827"
                    >
                      {silla.numero}
                    </text>
                  </g>
                );
              })}

              <circle
                cx={mesa.pos_x}
                cy={mesa.pos_y}
                r="42"
                fill="#292524"
                stroke="#57534e"
                strokeWidth="2"
              />
              <text
                x={mesa.pos_x}
                y={mesa.pos_y + 6}
                textAnchor="middle"
                fontSize="16"
                fontWeight="700"
                fill="#fefce8"
              >
                {`Mesa ${mesa.numero}`}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function SceneContent({
  evento,
  selectedSillaId,
  currentAsistenteId,
  selectionLocked,
  onSelectSilla,
  viewMode,
}: DinnerRoomSceneProps & { viewMode: ViewMode }) {
  const mesas = useMemo(
    () => [...evento.mesas].sort((a, b) => a.numero - b.numero),
    [evento.mesas],
  );
  const isPlanView = viewMode === "plan";

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
    <>
      <color attach="background" args={["#f6f1e8"]} />
      <fog attach="fog" args={["#f6f1e8", 11, 28]} />
      <ambientLight intensity={1.15} />
      <hemisphereLight intensity={0.8} color="#fff7ed" groundColor="#b45309" />
      <directionalLight
        position={[8, 11, 5]}
        intensity={1.35}
        color="#fff7ed"
        castShadow
      />
      <spotLight
        position={[-10, 14, 4]}
        angle={0.42}
        penumbra={0.5}
        intensity={0.9}
        color="#ffffff"
      />

      {viewMode === "3d" ? (
        <PerspectiveCamera makeDefault position={[0, 8.4, 13.4]} fov={38} />
      ) : (
        <OrthographicCamera
          makeDefault
          position={[0, 18, 0.01]}
          rotation={[-Math.PI / 2, 0, 0]}
          zoom={48}
        />
      )}
      <OrbitControls
        key={viewMode}
        enablePan={isPlanView}
        enableRotate={!isPlanView}
        minDistance={isPlanView ? 10 : 8}
        maxDistance={isPlanView ? 18 : 18}
        minZoom={38}
        maxZoom={66}
        minPolarAngle={isPlanView ? Math.PI / 2 : 0.24}
        maxPolarAngle={isPlanView ? Math.PI / 2 : 1.52}
        target={[0, 0.25, -0.8]}
      />

      <BallroomShell />
      <EventLabel evento={evento} />

      {mesas.map((mesa) => {
        const mesaX = (mesa.pos_x - BASE_WIDTH / 2) * ROOM_SCALE;
        const mesaZ = (mesa.pos_y - BASE_HEIGHT / 2) * ROOM_SCALE;

        return (
          <group key={mesa.id} position={[mesaX, 0, mesaZ]}>
            <TableModel number={mesa.numero} />

            {mesa.sillas.map((silla, index) => {
              const reservas = normalizeReservas(silla.reservas);
              const angle =
                -Math.PI / 2 + (index * (Math.PI * 2)) / mesa.sillas.length;
              const sillaX = Math.cos(angle) * CHAIR_DISTANCE;
              const sillaZ = Math.sin(angle) * CHAIR_DISTANCE;
              const sillaOcupada = reservas.length > 0;
              const sillaEsDelAsistente =
                reservas[0]?.asistente_id === currentAsistenteId;
              const sillaColor = getChairColor(
                silla,
                selectedSillaId,
                currentAsistenteId,
              );
              const rotationY = -angle;

              return (
                <group
                  key={silla.id}
                  position={[sillaX, 0, sillaZ]}
                  rotation={[0, rotationY, 0]}
                >
                  <mesh
                    onClick={() =>
                      handleChairSelection(
                        silla.id,
                        sillaOcupada,
                        sillaEsDelAsistente,
                      )
                    }
                    onPointerUp={() =>
                      handleChairSelection(
                        silla.id,
                        sillaOcupada,
                        sillaEsDelAsistente,
                      )
                    }
                    castShadow
                    position={[0, 0.08, 0]}
                  >
                    <cylinderGeometry args={[HIT_RADIUS, HIT_RADIUS, 0.3, 24]} />
                    <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
                  </mesh>

                  <ChairModel
                    color={sillaColor}
                    number={silla.numero}
                    selected={selectedSillaId === silla.id}
                  />
                </group>
              );
            })}
          </group>
        );
      })}

      <ContactShadows
        position={[0, -0.71, 0]}
        scale={26}
        blur={2.9}
        opacity={0.3}
        far={12}
      />
    </>
  );
}

export default function DinnerRoomScene(props: DinnerRoomSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(460);
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);

  useEffect(() => {
    function updateSize() {
      const width = containerRef.current?.clientWidth ?? 920;
      setHeight(Math.max(360, Math.min(width * 0.62, 620)));
    }

    updateSize();
    window.addEventListener("resize", updateSize);

    return () => {
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  useEffect(() => {
    setWebglSupported(browserSupportsWebGL());
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  async function toggleFullscreen() {
    if (!containerRef.current) {
      return;
    }

    if (document.fullscreenElement === containerRef.current) {
      await document.exitFullscreen();
      return;
    }

    await containerRef.current.requestFullscreen();
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-[28px] border border-stone-200 bg-[linear-gradient(180deg,_#ffffff,_#fafaf9)]"
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      <div className="pointer-events-none absolute inset-0 z-10">
        {webglSupported ? (
          <div className="pointer-events-auto absolute right-4 top-4 flex overflow-hidden rounded-full border border-stone-300 bg-white/92 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={() => setViewMode("3d")}
              className={`px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                viewMode === "3d"
                  ? "bg-stone-950 text-white"
                  : "text-stone-700 hover:bg-stone-100 hover:text-stone-950"
              }`}
            >
              3D
            </button>
            <button
              type="button"
              onClick={() => setViewMode("plan")}
              className={`px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                viewMode === "plan"
                  ? "bg-stone-950 text-white"
                  : "text-stone-700 hover:bg-stone-100 hover:text-stone-950"
              }`}
            >
              2D
            </button>
          </div>
        ) : null}

        <div className="pointer-events-auto absolute bottom-4 right-4">
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-full border border-stone-300 bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-700 shadow-sm backdrop-blur transition hover:border-stone-950 hover:text-stone-950"
          >
            {isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          </button>
        </div>
      </div>

      {webglSupported === null ? (
        <div className="flex h-full items-center justify-center text-sm text-stone-500">
          Preparando la sala...
        </div>
      ) : webglSupported ? (
        <Canvas dpr={[1, 1.75]} shadows gl={{ antialias: true }} eventPrefix="client">
          <Suspense fallback={null}>
            <SceneContent {...props} viewMode={viewMode} />
          </Suspense>
        </Canvas>
      ) : (
        <PlanFallback {...props} />
      )}
    </div>
  );
}
