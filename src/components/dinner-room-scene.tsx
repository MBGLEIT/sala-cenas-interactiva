"use client";

import { PointerEvent as ReactPointerEvent, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
        enableZoom
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
  const joystickPointerIdRef = useRef<number | null>(null);
  const joystickFrameRef = useRef<number | null>(null);
  const pinchDistanceRef = useRef<number | null>(null);
  const [joystickVector, setJoystickVector] = useState({ x: 0, y: 0 });
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

  useEffect(() => {
    if (!isPresencialTouch3D || !containerRef.current) {
      pinchDistanceRef.current = null;
      return;
    }

    const host = containerRef.current;

    function getTouchDistance(touches: TouchList) {
      if (touches.length < 2) {
        return null;
      }

      const first = touches[0];
      const second = touches[1];
      const deltaX = second.clientX - first.clientX;
      const deltaY = second.clientY - first.clientY;

      return Math.hypot(deltaX, deltaY);
    }

    function handleTouchStart(event: TouchEvent) {
      if (event.touches.length < 2) {
        pinchDistanceRef.current = null;
        return;
      }

      const distance = getTouchDistance(event.touches);

      if (distance === null) {
        return;
      }

      pinchDistanceRef.current = distance;
      event.preventDefault();
      event.stopPropagation();
    }

    function handleTouchMove(event: TouchEvent) {
      if (event.touches.length < 2) {
        pinchDistanceRef.current = null;
        return;
      }

      const controls = controlsRef.current;
      const currentDistance = getTouchDistance(event.touches);
      const previousDistance = pinchDistanceRef.current;

      if (!controls || currentDistance === null || previousDistance === null || previousDistance <= 0) {
        return;
      }

      const ratio = currentDistance / previousDistance;

      if (Math.abs(ratio - 1) < 0.01) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const scale = Math.min(Math.max(ratio, 0.92), 1.08);

      if (ratio > 1) {
        controls.dollyIn(scale);
      } else {
        controls.dollyOut(1 / scale);
      }

      controls.update();
      pinchDistanceRef.current = currentDistance;
      event.preventDefault();
      event.stopPropagation();
    }

    function resetPinchState() {
      pinchDistanceRef.current = null;
    }

    const activeTouchOptions: AddEventListenerOptions = { passive: false, capture: true };
    const captureOptions: AddEventListenerOptions = { capture: true };

    host.addEventListener("touchstart", handleTouchStart, activeTouchOptions);
    host.addEventListener("touchmove", handleTouchMove, activeTouchOptions);
    host.addEventListener("touchend", resetPinchState, captureOptions);
    host.addEventListener("touchcancel", resetPinchState, captureOptions);

    return () => {
      host.removeEventListener("touchstart", handleTouchStart, activeTouchOptions);
      host.removeEventListener("touchmove", handleTouchMove, activeTouchOptions);
      host.removeEventListener("touchend", resetPinchState, captureOptions);
      host.removeEventListener("touchcancel", resetPinchState, captureOptions);
      pinchDistanceRef.current = null;
    };
  }, [isPresencialTouch3D]);

  useEffect(() => {
    if (!isPresencialTouch3D) {
      setJoystickVector({ x: 0, y: 0 });
      return;
    }

    function tick() {
      const controls = controlsRef.current;

      if (controls) {
        const horizontal = joystickVector.x;
        const vertical = joystickVector.y;

        if (Math.abs(horizontal) > 0.02 || Math.abs(vertical) > 0.02) {
          controls.rotateLeft(horizontal * 0.032);
          controls.rotateUp(vertical * 0.024);
          controls.update();
        }
      }

      joystickFrameRef.current = window.requestAnimationFrame(tick);
    }

    joystickFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (joystickFrameRef.current !== null) {
        window.cancelAnimationFrame(joystickFrameRef.current);
      }

      joystickFrameRef.current = null;
    };
  }, [isPresencialTouch3D, joystickVector.x, joystickVector.y]);

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

  function updateJoystickPosition(
    event: ReactPointerEvent<HTMLDivElement>,
    pointerId: number,
  ) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const radius = bounds.width / 2;
    const rawX = event.clientX - bounds.left - centerX;
    const rawY = event.clientY - bounds.top - centerY;
    const distance = Math.hypot(rawX, rawY);
    const limitedDistance = Math.min(distance, radius);
    const angle = Math.atan2(rawY, rawX);
    const nextX = radius === 0 ? 0 : (Math.cos(angle) * limitedDistance) / radius;
    const nextY = radius === 0 ? 0 : (Math.sin(angle) * limitedDistance) / radius;

    joystickPointerIdRef.current = pointerId;
    setJoystickVector({
      x: clamp(nextX, -1, 1),
      y: clamp(nextY, -1, 1),
    });
  }

  function resetJoystick() {
    joystickPointerIdRef.current = null;
    setJoystickVector({ x: 0, y: 0 });
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
              ? props.touchMode
                ? props.touchGestureProfile === "presencial"
                  ? "Desliza con un dedo para desplazarte. Usa dos dedos para acercar o alejar y el joystick para girar la camara."
                  : "Arrastra con un dedo para girar la sala. Usa dos dedos para mover y acercar la camara."
                : "Arrastra con el boton izquierdo para girar, con el derecho para mover la camara y usa la rueda para acercar o alejar."
              : props.touchMode
                ? "Arrastra para mover el plano y usa los controles grandes para acercar, alejar o centrar."
                : "Usa la rueda del raton para hacer zoom y arrastra para desplazarte por el plano."}
          </p>
        </div>

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
              props.selectedSillaId ? "bottom-48 sm:bottom-52" : "bottom-4"
            } flex flex-col items-center gap-3`}
          >
            <div
              className="pointer-events-auto relative h-28 w-28 touch-none rounded-full border border-stone-300 bg-white/92 shadow-sm backdrop-blur"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                updateJoystickPosition(event, event.pointerId);
              }}
              onPointerMove={(event) => {
                if (joystickPointerIdRef.current !== event.pointerId) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                updateJoystickPosition(event, event.pointerId);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }

                resetJoystick();
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }

                resetJoystick();
              }}
            >
              <div className="absolute inset-[18px] rounded-full border border-stone-200" />
              <div className="absolute left-1/2 top-1/2 h-px w-16 -translate-x-1/2 -translate-y-1/2 bg-stone-200" />
              <div className="absolute left-1/2 top-1/2 h-16 w-px -translate-x-1/2 -translate-y-1/2 bg-stone-200" />
              <div
                className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border border-stone-400 bg-stone-950/90 shadow-sm transition-transform"
                style={{
                  transform: `translate(calc(-50% + ${joystickVector.x * 26}px), calc(-50% + ${joystickVector.y * 26}px))`,
                }}
              />
            </div>
            <span className="rounded-full border border-stone-300 bg-white/90 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-700 shadow-sm backdrop-blur">
              Giro camara
            </span>
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
        />
      )}
    </div>
  );
}
