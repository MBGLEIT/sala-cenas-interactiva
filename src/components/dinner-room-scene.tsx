"use client";

import { ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls, PerspectiveCamera, Text } from "@react-three/drei";
import { MOUSE, TOUCH } from "three";

import DinnerRoomHall3D from "@/components/dinner-room-hall-3d";
import DinnerRoomPlan2D from "@/components/dinner-room-plan-2d";
import DinnerRoomTable3D from "@/components/dinner-room-table-3d";
import { EventoSala } from "@/lib/dinner-room";
import {
  ROOM_LAYOUT_HEIGHT,
  ROOM_LAYOUT_WIDTH,
  ROOM_WORLD_SCALE,
  getEventTitleFootprint,
  getProtectedEventBounds,
  roomPointToWorld,
} from "@/lib/room-layout";

type DinnerRoomSceneProps = {
  evento: EventoSala;
  selectedSillaId: string | null;
  currentAsistenteId: string;
  selectionLocked: boolean;
  onSelectSilla: (sillaId: string | null) => void;
  overlay?: ReactNode;
  touchMode?: boolean;
  defaultViewMode?: ViewMode;
  fullscreenBehavior?: "available" | "locked" | "hidden";
  requestFullscreenOnMount?: boolean;
  hide2DHeader?: boolean;
  touchGestureProfile?: "default" | "presencial";
  hideControlsLegend?: boolean;
  compactUi?: boolean;
};

type SceneContentProps = DinnerRoomSceneProps & {
  controlsRef: React.RefObject<any>;
  cameraRef: React.RefObject<any>;
};

type ViewMode = "3d" | "2d";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

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
  centerX,
  centerZ,
}: {
  evento: EventoSala;
  centerX: number;
  centerZ: number;
}) {
  const roomWorldWidth = ROOM_LAYOUT_WIDTH * ROOM_WORLD_SCALE;
  const footprint = getEventTitleFootprint(evento.nombre);

  return (
    <group position={[centerX, 0, centerZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.782, 0]} receiveShadow>
        <planeGeometry
          args={[
            footprint.safeWidth * ROOM_WORLD_SCALE,
            footprint.safeHeight * ROOM_WORLD_SCALE,
          ]}
        />
        <meshStandardMaterial color="#6f4f3a" transparent opacity={0.18} roughness={0.95} />
      </mesh>
      <Text
        position={[0, -0.772, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={footprint.worldFontSize}
        color="#efe3cb"
        anchorX="center"
        anchorY="middle"
        maxWidth={roomWorldWidth * footprint.maxWidthRatio}
        outlineWidth={0.024}
        outlineColor="#40261f"
      >
        {footprint.text}
      </Text>
    </group>
  );
}

function SceneContent(props: SceneContentProps) {
  const mesas = useMemo(
    () => [...props.evento.mesas].sort((a, b) => a.numero - b.numero),
    [props.evento.mesas],
  );
  const structureSignature = useMemo(
    () =>
      mesas
        .map((mesa) => `${mesa.numero}:${mesa.sillas.length}:${mesa.pos_x}:${mesa.pos_y}`)
        .sort()
        .join("|"),
    [mesas],
  );
  const protectedBounds = useMemo(
    () => getProtectedEventBounds(mesas, props.evento.nombre),
    [mesas, props.evento.nombre],
  );
  const roomWorldWidth = ROOM_LAYOUT_WIDTH * ROOM_WORLD_SCALE;
  const roomWorldDepth = ROOM_LAYOUT_HEIGHT * ROOM_WORLD_SCALE;
  const titleAnchor = roomPointToWorld(ROOM_LAYOUT_WIDTH / 2, ROOM_LAYOUT_HEIGHT / 2);
  const roomCenterX = ROOM_LAYOUT_WIDTH / 2;
  const roomCenterY = ROOM_LAYOUT_HEIGHT / 2;
  const nextTargetPoint = roomPointToWorld(roomCenterX, roomCenterY);
  const spread = Math.max(
    (Math.max(roomCenterX - protectedBounds.minX, protectedBounds.maxX - roomCenterX) * 2) *
      ROOM_WORLD_SCALE,
    (Math.max(roomCenterY - protectedBounds.minY, protectedBounds.maxY - roomCenterY) * 2) *
      ROOM_WORLD_SCALE,
  );
  const hallWidth = Math.max(
    Math.max(
      roomCenterX - protectedBounds.minX,
      protectedBounds.maxX - roomCenterX,
    ) * 2 * ROOM_WORLD_SCALE + 8,
    roomWorldWidth * 0.46,
  );
  const hallDepth = Math.max(
    Math.max(
      roomCenterY - protectedBounds.minY,
      protectedBounds.maxY - roomCenterY,
    ) * 2 * ROOM_WORLD_SCALE + 8,
    roomWorldDepth * 0.42,
  );
  const [sceneAnchor, setSceneAnchor] = useState(() => ({
    targetX: nextTargetPoint.x,
    targetZ: nextTargetPoint.z,
    hallWidth,
    hallDepth,
    cameraDistance: Math.min(Math.max(15, spread * 2.4), 28),
  }));
  const previousEventIdRef = useRef(props.evento.id);
  const previousStructureSignatureRef = useRef(structureSignature);

  useEffect(() => {
    const eventChanged = previousEventIdRef.current !== props.evento.id;
    const structureChanged =
      previousStructureSignatureRef.current !== structureSignature;

    if (eventChanged || structureChanged) {
      setSceneAnchor({
        targetX: nextTargetPoint.x,
        targetZ: nextTargetPoint.z,
        hallWidth,
        hallDepth,
        cameraDistance: Math.min(Math.max(15, spread * 2.4), 28),
      });
      previousEventIdRef.current = props.evento.id;
      previousStructureSignatureRef.current = structureSignature;
    }
  }, [hallDepth, hallWidth, nextTargetPoint.x, nextTargetPoint.z, props.evento.id, spread, structureSignature]);

  const targetPoint = { x: sceneAnchor.targetX, z: sceneAnchor.targetZ };
  const cameraDistance = sceneAnchor.cameraDistance;
  const boundsWorldWidth = Math.max(sceneAnchor.hallWidth - 8, 4.8);
  const boundsWorldDepth = Math.max(sceneAnchor.hallDepth - 8, 4.2);
  const panLimitX = boundsWorldWidth / 2 + Math.min(2.2, Math.max(1.1, boundsWorldWidth * 0.09));
  const panLimitZ = boundsWorldDepth / 2 + Math.min(2, Math.max(1, boundsWorldDepth * 0.09));

  function clampControlsToHall() {
    const controls = props.controlsRef.current;
    const camera = props.cameraRef.current;

    if (!controls || !camera) {
      return;
    }

    const nextTargetX = clamp(
      controls.target.x,
      targetPoint.x - panLimitX,
      targetPoint.x + panLimitX,
    );
    const nextTargetZ = clamp(
      controls.target.z,
      targetPoint.z - panLimitZ,
      targetPoint.z + panLimitZ,
    );

    const deltaX = nextTargetX - controls.target.x;
    const deltaZ = nextTargetZ - controls.target.z;

    if (deltaX !== 0 || deltaZ !== 0) {
      controls.target.x = nextTargetX;
      controls.target.z = nextTargetZ;
      camera.position.x += deltaX;
      camera.position.z += deltaZ;
      controls.update();
    }
  }

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
        ref={props.cameraRef}
        makeDefault
        position={[targetPoint.x, 13.5, targetPoint.z + cameraDistance]}
        fov={42}
      />
      <OrbitControls
        ref={props.controlsRef}
        enablePan
        enableRotate
        enableZoom={!(props.touchMode && props.touchGestureProfile === "presencial")}
        makeDefault
        dampingFactor={0.08}
        rotateSpeed={props.touchMode ? 0.72 : 1}
        panSpeed={props.touchMode ? 0.7 : 1}
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
        touches={
          props.touchMode
            ? props.touchGestureProfile === "presencial"
              ? {
                  ONE: TOUCH.PAN,
                  TWO: TOUCH.DOLLY_ROTATE,
                }
              : {
                  ONE: TOUCH.ROTATE,
                  TWO: TOUCH.DOLLY_PAN,
                }
            : undefined
        }
        onChange={clampControlsToHall}
      />

      <DinnerRoomHall3D
        width={sceneAnchor.hallWidth}
        depth={sceneAnchor.hallDepth}
        centerX={targetPoint.x}
        centerZ={targetPoint.z}
        eventName={props.evento.nombre}
      />
      <EventLabel
        evento={props.evento}
        centerX={titleAnchor.x}
        centerZ={titleAnchor.z}
      />

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
              touchMode={props.touchMode}
            />
          </group>
        );
      })}

      <ContactShadows
        position={[targetPoint.x, -0.71, targetPoint.z]}
        scale={Math.max(sceneAnchor.hallWidth, sceneAnchor.hallDepth) * 1.25}
        blur={3.4}
        opacity={0.28}
        far={28}
      />
    </>
  );
}

export default function DinnerRoomScene(props: DinnerRoomSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const [height, setHeight] = useState(520);
  const [viewMode, setViewMode] = useState<ViewMode>(props.defaultViewMode ?? "2d");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  const isPresencialTouch3D =
    props.touchMode && props.touchGestureProfile === "presencial" && viewMode === "3d";

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

  useEffect(() => {
    setViewMode(props.defaultViewMode ?? "2d");
  }, [props.defaultViewMode, props.evento.id]);

  useEffect(() => {
    if (!props.requestFullscreenOnMount || !containerRef.current) {
      return;
    }

    if (document.fullscreenElement === containerRef.current) {
      return;
    }

    void containerRef.current.requestFullscreen().catch(() => undefined);
  }, [props.requestFullscreenOnMount, props.evento.id]);

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

  function adjust3DZoom(direction: "in" | "out") {
    const controls = controlsRef.current;

    if (!controls) {
      return;
    }

    if (direction === "in") {
      controls.dollyOut(1.16);
    } else {
      controls.dollyIn(1.16);
    }

    controls.update();
  }

  const show3D = viewMode === "3d" && webglSupported;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-[linear-gradient(180deg,_#ffffff,_#fafaf9)] ${
        props.compactUi
          ? "h-[100dvh] w-full rounded-none border-0"
          : "rounded-[28px] border border-stone-200"
      }`}
      style={{ height: props.compactUi ? "100dvh" : isFullscreen ? "100vh" : height }}
    >
      <div className="pointer-events-none absolute inset-0 z-10">
        <div
          className={`pointer-events-auto absolute right-4 top-4 flex overflow-hidden rounded-full border border-stone-300 bg-white/92 shadow-sm backdrop-blur ${
            props.compactUi ? "scale-90 origin-top-right" : ""
          }`}
        >
          <button
            type="button"
            onClick={() => setViewMode("3d")}
            disabled={!webglSupported}
            className={`font-semibold uppercase tracking-[0.18em] transition ${
              props.compactUi ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-xs"
            } ${
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
            className={`font-semibold uppercase tracking-[0.18em] transition ${
              props.compactUi ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-xs"
            } ${
              viewMode === "2d"
                ? "bg-stone-950 text-white"
                : "text-stone-700 hover:bg-stone-100 hover:text-stone-950"
            }`}
          >
            2D
          </button>
        </div>

        {!props.hideControlsLegend ? (
          <div className="pointer-events-auto absolute bottom-4 left-4 max-w-md rounded-2xl border border-amber-200/80 bg-[linear-gradient(180deg,_rgba(255,251,235,0.98),_rgba(255,247,237,0.94))] px-4 py-3 shadow-[0_18px_40px_rgba(120,53,15,0.18)] ring-1 ring-white/70 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
              {show3D ? "Controles 3D" : "Controles 2D"}
            </p>
            <p className="mt-1 text-xs leading-5 text-stone-700">
              {show3D
                ? props.touchMode
                  ? props.touchGestureProfile === "presencial"
                    ? "Desliza con un dedo para desplazarte. Usa dos dedos para mover la camara y los botones para acercar o alejar."
                    : "Arrastra con un dedo para girar la sala. Usa dos dedos para mover y acercar la camara."
                  : "Arrastra con el boton izquierdo para girar, con el derecho para mover la camara y usa la rueda para acercar o alejar."
                : props.touchMode
                  ? "Arrastra para mover el plano y usa los controles grandes para acercar, alejar o centrar."
                  : "Usa la rueda del raton para hacer zoom y arrastra para desplazarte por el plano."}
            </p>
          </div>
        ) : null}

        {props.fullscreenBehavior === "available" ? (
          <div className="pointer-events-auto absolute bottom-4 right-4">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded-full border border-stone-300 bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-700 shadow-sm backdrop-blur transition hover:border-stone-950 hover:text-stone-950"
            >
              {isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
            </button>
          </div>
        ) : null}

        {props.fullscreenBehavior === "locked" && !isFullscreen ? (
          <div className="pointer-events-auto absolute bottom-4 right-4">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded-full bg-emerald-600 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-sm transition hover:bg-emerald-700"
            >
              Activar pantalla completa
            </button>
          </div>
        ) : null}

        {props.overlay ? (
          <div className="pointer-events-none absolute inset-0 z-20">
            {props.overlay}
          </div>
        ) : null}

        {isPresencialTouch3D ? (
          <div
            className={`pointer-events-none absolute right-4 ${
              props.selectedSillaId
                ? props.compactUi
                  ? "bottom-32 sm:bottom-36"
                  : "bottom-48 sm:bottom-52"
                : "bottom-4"
            } flex flex-col items-center gap-3`}
          >
            <button
              type="button"
              onClick={() => adjust3DZoom("in")}
              className={`pointer-events-auto inline-flex items-center justify-center rounded-full border border-stone-300 bg-white/95 font-semibold text-stone-800 shadow-sm backdrop-blur transition hover:border-stone-950 ${
                props.compactUi ? "h-12 w-12 text-xl" : "h-14 w-14 text-2xl"
              }`}
              aria-label="Acercar"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => adjust3DZoom("out")}
              className={`pointer-events-auto inline-flex items-center justify-center rounded-full border border-stone-300 bg-white/95 font-semibold text-stone-800 shadow-sm backdrop-blur transition hover:border-stone-950 ${
                props.compactUi ? "h-12 w-12 text-xl" : "h-14 w-14 text-2xl"
              }`}
              aria-label="Alejar"
            >
              -
            </button>
          </div>
        ) : null}
      </div>

      {webglSupported === null ? (
        <div className="flex h-full items-center justify-center text-sm text-stone-500">
          Preparando la sala...
        </div>
      ) : show3D ? (
        <Canvas dpr={[1, 1.75]} shadows gl={{ antialias: true }} eventPrefix="offset">
          <Suspense fallback={null}>
            <SceneContent {...props} controlsRef={controlsRef} cameraRef={cameraRef} />
          </Suspense>
        </Canvas>
      ) : (
        <DinnerRoomPlan2D
          {...props}
          showCompatibilityMessage={webglSupported === false}
          touchMode={props.touchMode}
          hideHeader={props.hide2DHeader}
          compactUi={props.compactUi}
        />
      )}
    </div>
  );
}
