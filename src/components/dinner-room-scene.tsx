"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls, PerspectiveCamera, Text } from "@react-three/drei";
import { MOUSE } from "three";

import DinnerRoomHall3D from "@/components/dinner-room-hall-3d";
import DinnerRoomPlan2D from "@/components/dinner-room-plan-2d";
import DinnerRoomTable3D from "@/components/dinner-room-table-3d";
import { EventoSala } from "@/lib/dinner-room";
import {
  ROOM_LAYOUT_HEIGHT,
  ROOM_LAYOUT_WIDTH,
  ROOM_WORLD_SCALE,
  getEventBounds,
  roomPointToWorld,
} from "@/lib/room-layout";

type DinnerRoomSceneProps = {
  evento: EventoSala;
  selectedSillaId: string | null;
  currentAsistenteId: string;
  selectionLocked: boolean;
  onSelectSilla: (sillaId: string | null) => void;
};

type ViewMode = "3d" | "2d";

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

function EventLabel({
  evento,
  zPosition,
}: {
  evento: EventoSala;
  zPosition: number;
}) {
  const roomWorldWidth = ROOM_LAYOUT_WIDTH * ROOM_WORLD_SCALE;

  return (
    <Text
      position={[0, 3.2, zPosition]}
      fontSize={0.5}
      color="#3f3f46"
      anchorX="center"
      anchorY="middle"
      maxWidth={roomWorldWidth * 0.7}
    >
      {`${evento.nombre} - ${evento.fecha}`}
    </Text>
  );
}

function SceneContent(props: DinnerRoomSceneProps) {
  const mesas = useMemo(
    () => [...props.evento.mesas].sort((a, b) => a.numero - b.numero),
    [props.evento.mesas],
  );
  const bounds = useMemo(() => getEventBounds(mesas), [mesas]);
  const roomWorldWidth = ROOM_LAYOUT_WIDTH * ROOM_WORLD_SCALE;
  const roomWorldDepth = ROOM_LAYOUT_HEIGHT * ROOM_WORLD_SCALE;
  const targetPoint = roomPointToWorld(bounds.centerX, bounds.centerY);
  const spread = Math.max(bounds.width * ROOM_WORLD_SCALE, bounds.height * ROOM_WORLD_SCALE);
  const cameraDistance = Math.min(Math.max(15, spread * 2.4), 28);

  return (
    <>
      <color attach="background" args={["#f6f1e8"]} />
      <fog attach="fog" args={["#f6f1e8", 24, 62]} />
      <ambientLight intensity={0.92} />
      <hemisphereLight intensity={0.58} color="#fff7ed" groundColor="#8b5e3c" />
      <directionalLight
        position={[10, 14, 8]}
        intensity={0.92}
        color="#fff7ed"
        castShadow
      />

      <PerspectiveCamera
        makeDefault
        position={[targetPoint.x, 13.5, targetPoint.z + cameraDistance]}
        fov={42}
      />
      <OrbitControls
        enablePan
        enableRotate
        enableZoom
        makeDefault
        dampingFactor={0.08}
        minDistance={8}
        maxDistance={52}
        minPolarAngle={0.22}
        maxPolarAngle={1.3}
        target={[targetPoint.x, 0.25, targetPoint.z]}
        mouseButtons={{
          LEFT: MOUSE.ROTATE,
          MIDDLE: MOUSE.DOLLY,
          RIGHT: MOUSE.PAN,
        }}
      />

      <DinnerRoomHall3D width={roomWorldWidth + 4} depth={roomWorldDepth + 4} />
      <EventLabel evento={props.evento} zPosition={-(roomWorldDepth / 2) + 1.8} />

      {mesas.map((mesa) => {
        const worldPosition = roomPointToWorld(mesa.pos_x, mesa.pos_y);

        return (
          <group key={mesa.id} position={[worldPosition.x, 0, worldPosition.z]}>
            <DinnerRoomTable3D
              mesaId={mesa.id}
              mesaNumero={mesa.numero}
              sillas={mesa.sillas}
              selectedSillaId={props.selectedSillaId}
              currentAsistenteId={props.currentAsistenteId}
              selectionLocked={props.selectionLocked}
              onSelectSilla={props.onSelectSilla}
            />
          </group>
        );
      })}

      <ContactShadows
        position={[0, -0.71, 0]}
        scale={56}
        blur={3.4}
        opacity={0.28}
        far={28}
      />
    </>
  );
}

export default function DinnerRoomScene(props: DinnerRoomSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(520);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);

  useEffect(() => {
    function updateSize() {
      const width = containerRef.current?.clientWidth ?? 1100;
      setHeight(Math.max(420, Math.min(width * 0.64, 760)));
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

  useEffect(() => {
    if (webglSupported === false) {
      setViewMode("2d");
    }
  }, [webglSupported]);

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

  const show3D = viewMode === "3d" && webglSupported;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-[28px] border border-stone-200 bg-[linear-gradient(180deg,_#ffffff,_#fafaf9)]"
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="pointer-events-auto absolute right-4 top-4 flex overflow-hidden rounded-full border border-stone-300 bg-white/92 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() => setViewMode("3d")}
            disabled={!webglSupported}
            className={`px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
              viewMode === "3d"
                ? "bg-stone-950 text-white"
                : "text-stone-700 hover:bg-stone-100 hover:text-stone-950"
            } ${!webglSupported ? "cursor-not-allowed opacity-45" : ""}`}
          >
            3D
          </button>
          <button
            type="button"
            onClick={() => setViewMode("2d")}
            className={`px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
              viewMode === "2d"
                ? "bg-stone-950 text-white"
                : "text-stone-700 hover:bg-stone-100 hover:text-stone-950"
            }`}
          >
            2D
          </button>
        </div>

        <div className="pointer-events-auto absolute bottom-4 left-4 max-w-md rounded-2xl border border-stone-200 bg-white/92 px-4 py-3 shadow-sm backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-700">
            {show3D ? "Controles 3D" : "Controles 2D"}
          </p>
          <p className="mt-1 text-xs leading-5 text-stone-600">
            {show3D
              ? "Arrastra con el boton izquierdo para girar, con el derecho para mover la camara y usa la rueda para acercar o alejar."
              : "Usa la rueda del raton para hacer zoom y arrastra para desplazarte por el plano."}
          </p>
        </div>

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
      ) : show3D ? (
        <Canvas dpr={[1, 1.75]} shadows gl={{ antialias: true }} eventPrefix="client">
          <Suspense fallback={null}>
            <SceneContent {...props} />
          </Suspense>
        </Canvas>
      ) : (
        <DinnerRoomPlan2D
          {...props}
          showCompatibilityMessage={webglSupported === false}
        />
      )}
    </div>
  );
}
